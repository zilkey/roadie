/**
 * What Roadie may do. The limits live here, in code, not in the prompt: a command that is not eligible is never offered
 * to the model and is refused again at run time. One place to read, one place to change.
 */
import { registry } from "../commands/registry";
import type { Role } from "../ctx";

/** Commands Roadie never gets (spec: "What Roadie won't do"). Prefix entries end in a dot. */
export const EXCLUDED: readonly string[] = [
  "users.",           // invites, access, roles
  "mcpTokens.",       // AI keys (commands removed; guard against future re-addition)
  "artists.",         // settings, feature switches, creating or changing the band
  "assistant.",       // Roadie's own prefs
  "drafts.",          // personal scratch, nothing to hand an assistant
  "history.myRuns",   // Roadie sees only its own thread's runs, through history.undoRun
  "pitches.checkReplies", // reads the band's mail: Roadie never reads email
  "stats.importCsv",  // bulk import of someone's file
];
export const isExcluded = (name: string) => EXCLUDED.some((e) => (e.endsWith(".") ? name.startsWith(e) : name === e));

/** Commands that always ask first: they send, pay or move money, leave the app, or delete, archive or cancel. */
export const ALWAYS_CONFIRM: readonly string[] = [
  "pitches.sendEmail", "availability.ask", "availability.remind",                      // sends
  "expenses.setPaidBack", "showDeals.setIncome",                                          // money
  "shows.cancel", "shows.drop", "shows.setStatus", "shows.sync", "shows.calendar",                          // cancels, leaves the app
  "files.shareWithBand", "files.copyToBand", "drive.fix",                              // changes Drive sharing
  "stats.pull",                                                                          // calls out
  "venues.mergeInto",                                                                    // moves every band's shows, pitches and notes, then archives a room
];
/** venues.update fields that are the SHARED room (every band sees them); the rest (loadInNotes, notes, contactIds, promoterIds) are the band's own. */
const PRIVATE_VENUE_FIELDS = ["loadInNotes", "notes", "contactIds", "promoterIds"];
/** A venues.update that changes the shared room reaches every band that uses Band Tracker: it asks first. */
export const sharedVenueFields = (input: unknown): string[] =>
  Object.keys(((input as { patch?: Record<string, unknown> } | null)?.patch ?? {})).filter((k) => !PRIVATE_VENUE_FIELDS.includes(k));
/** `*.remove` archives or deletes something. */
const isRemove = (name: string) => name.endsWith(".remove");

/** More than this many records in one ask needs a yes. */
export const BULK_LIMIT = 5;
/** Commands whose array input is the content of one record (a checklist, a setlist), not a list of records. */
const ONE_RECORD_LISTS = new Set(["shows.setChecklists", "shows.setExpenses", "showDeals.setIncome", "setlists.update", "setlists.create", "artists.update", "rehearsals.create", "rehearsals.update", "songs.create", "files.attach"]);

/** Reads never ask, whatever they are given. */
const READ_ONLY = new Set(["records.get", "records.list", "shows.list", "search", "availability.check", "bandsintown.reconcile", "stats.movement", "stats.current", "pitches.needingFollowUp", "songs.missingFiles", "receipts.search", "drive.search"]);

/** True when `name` with this input must not run without the person's yes. TODO: count touched records after a dry run instead of guessing from the input. */
export function needsConfirm(name: string, input: unknown): boolean {
  if (ALWAYS_CONFIRM.includes(name) || isRemove(name)) return true;
  if (name === "venues.update" && sharedVenueFields(input).length) return true;
  if (READ_ONLY.has(name) || ONE_RECORD_LISTS.has(name)) return false;
  const walk = (v: unknown, depth: number): boolean => {
    if (Array.isArray(v)) return v.length > BULK_LIMIT || (depth < 2 && v.some((x) => walk(x, depth + 1)));
    if (v && typeof v === "object" && depth < 2) return Object.values(v).some((x) => walk(x, depth + 1));
    return false;
  };
  return walk(input, 0);
}

/** Commands Roadie is offered for this role: in the registry, allowed for the role, not excluded. */
export function eligibleCommands(role: Role) {
  return Object.values(registry).filter((c) => !isExcluded(c.name) && c.roles.includes(role));
}
export const isEligible = (name: string, role: Role) => !!registry[name] && !isExcluded(name) && registry[name].roles.includes(role);

// ---------- one-line summaries ----------

const dollars = (cents: unknown) => (typeof cents === "number" ? `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}` : "");
const SUMMARY: Record<string, (i: Record<string, unknown>) => string> = {
  "shows.cancel": (i) => `Cancel the show${i.label ? ` ${i.label}` : ""}${i.reason ? ` (${i.reason})` : ""}`,
  "shows.drop": (i) => `Drop the show${i.label ? ` ${i.label}` : ""}${i.reason ? ` (${i.reason})` : ""}`,
  "shows.setStatus": (i) => `Change the show${i.label ? ` ${i.label}` : ""} to ${i.status}${i.reason ? ` (${i.reason})` : ""}`,
  "expenses.setPaidBack": (i) => (i.paid === false ? "Mark an expense as not paid back" : "Mark an expense as paid back"),
  "showDeals.setIncome": (i) => `Set the show's income${Array.isArray(i.income) ? ` (${dollars((i.income as { amount: number }[]).reduce((n, l) => n + l.amount, 0))} in all)` : ""}`,
  "pitches.sendEmail": () => "Send an email from your Gmail",
  "availability.ask": () => "Ask musicians if they can play (sends an email)",
  "availability.remind": () => "Email a reminder to musicians who haven't answered",
  "venues.mergeInto": () => "Merge a duplicate venue into another one for EVERY band: shows, pitches and notes move, and the duplicate is archived",
  "venues.update": (i) => `Change the shared room${i.label ? ` ${i.label}` : ""} (${sharedVenueFields(i).join(", ")}) for every band that uses Band Tracker`,
};
/** What the confirm card says. `label` is a human name for the record (Roadie adds it from what it looked up). */
export function summarize(name: string, input: unknown, label?: string): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const base = SUMMARY[name]?.({ ...i, ...(label ? { label } : {}) });
  if (base) return base;
  const [kind, verb] = name.split(".");
  const what = label ? `${kind} ${label}` : kind;
  return verb === "remove" ? `Archive ${what}` : `Run ${name}${label ? ` on ${label}` : ""}`;
}
