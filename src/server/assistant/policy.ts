/**
 * What Roadie may do. The limits live here, in code, not in the prompt: a command that is not eligible is never offered
 * to the model and is refused again at run time. One place to read, one place to change.
 */
import { registry } from "../commands/registry";
import type { Role } from "../ctx";
import { formatCents } from "@/lib/money";

/** Commands Roadie never gets (spec: "What Roadie won't do"). Prefix entries end in a dot. */
export const EXCLUDED: readonly string[] = [
  "users.",           // invites, access, roles
  "mcpTokens.",       // AI keys (commands removed; guard against future re-addition)
  "google.",          // connecting someone's own Google account is an access change only they make
  "artists.create",   // making a band; the rest of band settings (links, lineups, custom fields) is open, but see refusal()
  "assistant.",       // Roadie's own prefs
  "drafts.",          // personal scratch, nothing to hand an assistant
  "history.myRuns",   // Roadie sees only its own thread's runs, through history.undoRun
  "pitches.checkReplies", // reads the band's mail: Roadie never reads email
  "stats.importCsv",  // bulk import of someone's file
  "shows.setChecklists", // replaces every list at once; the granular checklist commands do the same safely
];
/** Under an excluded prefix but fine: adding a Band Member (a name on a roster) grants no sign-in or access, unlike the rest of users.*. */
const ALLOWED_DESPITE_PREFIX: readonly string[] = ["users.addToBand"];
export const isExcluded = (name: string) => !ALLOWED_DESPITE_PREFIX.includes(name) && EXCLUDED.some((e) => (e.endsWith(".") ? name.startsWith(e) : name === e));

/** Said when Roadie is asked to rename the band or change its URL. Also what the canned script answers. */
export const BAND_SETTINGS = "Sorry, you have to change the band name and URL yourself, on the General settings page. Want me to take you there?";
const DRIVE_SETTINGS = "Sorry, the Drive folder is an integration setting you have to change yourself, on the General settings page. Want me to take you there?";
/** Refused in code, whole call, even mixed with allowed fields: artists.update that touches the name, URL or Drive folder. */
export function refusal(name: string, input: unknown): string | undefined {
  if (name !== "artists.update") return undefined;
  const patch = ((input as { patch?: Record<string, unknown> } | null)?.patch ?? {}) as Record<string, unknown>;
  if ("name" in patch || "slug" in patch) return BAND_SETTINGS;
  if ("driveFolderId" in patch || "rehearsalFolderId" in patch || "chartsFolderId" in patch || "demosFolderId" in patch || "songwritingFolderId" in patch) return DRIVE_SETTINGS;
  return undefined;
}

/** Commands that always ask first: they send, pay or move money, leave the app, or delete, archive or cancel. */
export const ALWAYS_CONFIRM: readonly string[] = [
  "pitches.sendEmail", "availability.ask", "availability.remind",                      // sends
  "expenses.setPaidBack", "expenses.payPerson", "showDeals.setIncome",                                          // money
  "shows.cancel", "shows.drop", "shows.setStatus", "shows.sync", "shows.calendar", "rehearsals.calendar", // cancels, leaves the app
  "files.shareWithBand", "files.copyToBand", "drive.fix",                              // changes Drive sharing
  "stagePlots.shareLink", "stagePlots.shareOff",                                          // makes a public link; kills the one the engineer has
  "stats.pull",                                                                          // calls out
  "musicians.archive", "musicians.removeFromBand",                                      // someone leaves the band
  "artists.removeSongField", "artists.removeShowField",                                  // deletes every value
  "fans.markSynced",                                                                     // marks addresses as done in Bandzoogle for good (fans.remove asks too: *.remove)
  "venues.mergeInto",                                                                    // moves every band's shows, pitches and notes, then archives a room
];
/** venues.update fields that are the SHARED room (every band sees them); the rest (loadInNotes, notes, contactIds, promoterIds) are the band's own. */
const PRIVATE_VENUE_FIELDS = ["loadInNotes", "notes", "contactIds", "promoterIds"];
/** A venues.update that changes the shared room reaches every band that uses Roadie: it asks first. */
export const sharedVenueFields = (input: unknown): string[] =>
  Object.keys(((input as { patch?: Record<string, unknown> } | null)?.patch ?? {})).filter((k) => !PRIVATE_VENUE_FIELDS.includes(k));
/** `*.remove` archives or deletes something. */
const isRemove = (name: string) => name.endsWith(".remove");

/** More than this many records in one ask needs a yes. */
export const BULK_LIMIT = 5;
/** Commands whose array input is the content of one record (a checklist, a setlist), not a list of records. */
const ONE_RECORD_LISTS = new Set(["shows.setChecklists", "shows.setFields", "shows.setExpenses", "rehearsals.setExpenses", "showDeals.setIncome", "checklistTemplates.create", "checklistTemplates.update", "checklistTemplates.reorder", "setlistTemplates.update", "setlistTemplates.create", "setlists.setItems", "setlists.seed", "artists.update", "rehearsals.create", "rehearsals.update", "rehearsals.importSetlist", "songs.create", "files.attach", "stagePlots.updateInputs", "stagePlots.reorderInputs", "stagePlots.move", "stagePlots.addItems", "stagePlots.removeItems", "stagePlots.setMonitors"]);

/** Reads never ask, whatever they are given. */
const READ_ONLY = new Set(["checklistTemplates.list", "records.get", "records.list", "shows.list", "search", "availability.check", "bandsintown.reconcile", "stats.movement", "stats.current", "pitches.needingFollowUp", "songs.missingFiles", "receipts.search", "drive.search", "expenses.estimateGas", "geo.autocomplete", "people.list", "help.explain", "setlists.printLink", "setlists.printPrefs", "stagePlots.list", "stagePlots.get", "stagePlots.staleShows", "stagePlots.engineerLink", "fans.list", "fans.counts", "fans.near", "fans.newSince", "fans.forBandzoogle", "shows.calendarPreview", "rehearsals.calendarPreview"]);

/** Commands that only read. Everything else may write (the taint rule in tools.ts asks first for all of them). */
export const isReadOnly = (name: string) => READ_ONLY.has(name);

/** True when `name` with this input must not run without the person's yes. TODO: count touched records after a dry run instead of guessing from the input. */
export function needsConfirm(name: string, input: unknown): boolean {
  if (ALWAYS_CONFIRM.includes(name) || isRemove(name)) return true;
  if (name === "venues.update" && sharedVenueFields(input).length) return true;
  const o = (input ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (name === "shows.update" && (o.patch?.status !== undefined || o.patch?.publishToBandsintown !== undefined)) return true; // cancels, or lists on / takes off Bandsintown
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
type Before = Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
/** A venue field as readable text for old → new. */
function fmtField(k: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "none";
  const o = v as Record<string, unknown>;
  if (k === "address" && typeof v === "object") return [o.street, o.city, o.state, o.zip].filter(Boolean).join(", ");
  if (k === "sound" && typeof v === "object") return `${o.provider === "venueProvided" ? "venue provides sound" : o.provider === "bandProvided" ? "band brings sound" : o.provider}${o.notes ? ` (${o.notes})` : ""}`;
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}
const SUMMARY: Record<string, (i: Record<string, any>, before?: Before) => string> = { // eslint-disable-line @typescript-eslint/no-explicit-any
  "shows.update": (i) => {
    const p = (i.patch ?? {}) as Record<string, unknown>, l = i.label ? ` ${i.label}` : " the show";
    const out: string[] = [];
    if (p.status !== undefined) out.push(`Change the show${i.label ? ` ${i.label}` : ""} to ${p.status}${p.reason ? ` (${p.reason})` : ""}`);
    if (p.publishToBandsintown !== undefined) out.push(p.publishToBandsintown ? `List${l} on Bandsintown` : `Take${l} off Bandsintown`);
    return out.join("; ");
  },
  "shows.calendar": (i) => (i.on ? `Put the show${i.label ? ` ${i.label}` : ""} on the band calendar and invite the band` : `Take the show${i.label ? ` ${i.label}` : ""} off the band calendar`),
  "rehearsals.calendar": (i) => (i.on ? "Put the rehearsal on the band calendar and invite everyone coming" : "Take the rehearsal off the band calendar"),
  "musicians.archive": (i) => `Archive ${i.label ?? "this person"}: they leave the band and lose their sign-in for this band`,
  "musicians.removeFromBand": (i) => `Take ${i.label ?? "this person"} out of the band (they keep their sign-in)`,
  "artists.removeSongField": () => "Delete the song field: every song loses its value",
  "artists.removeShowField": () => "Delete the show field: every show loses its value",
  "shows.cancel": (i) => `Cancel the show${i.label ? ` ${i.label}` : ""}${i.reason ? ` (${i.reason})` : ""}`,
  "shows.drop": (i) => `Drop the show${i.label ? ` ${i.label}` : ""}${i.reason ? ` (${i.reason})` : ""}`,
  "shows.setStatus": (i) => `Change the show${i.label ? ` ${i.label}` : ""} to ${i.status}${i.reason ? ` (${i.reason})` : ""}`,
  "expenses.setPaidBack": (i) => (i.paid === false ? "Mark an expense as not paid back" : "Mark an expense as paid back"),
  "expenses.payPerson": (_i, before) => `Pay ${before?.person ?? "them"}${before?.total ? ` ${formatCents(before.total)}` : " back"}`,
  "showDeals.setIncome": (i) => `Set the show's income${Array.isArray(i.income) ? ` (${dollars((i.income as { amount: number }[]).reduce((n, l) => n + l.amount, 0))} in all)` : ""}`,
  "pitches.sendEmail": () => "Send an email from your Gmail",
  "availability.ask": () => "Ask musicians if they can play (sends an email)",
  "fans.markSynced": (i) => (i.group ? `Mark every fan in "${i.group}" as added to Bandzoogle: they won't be offered again` : `Mark ${Array.isArray(i.ids) ? i.ids.length : "these"} fans as added to Bandzoogle: they won't be offered again`),
  "fans.remove": () => "Delete this fan and their history for good (it can't be undone)",
  "availability.remind": () => "Email a reminder to musicians who haven't answered",
  "stagePlots.shareLink": (i) => `${i.rotate ? "Make a new" : "Turn on the"} public engineer link${i.label ? ` for the stage plot ${i.label}` : ""}: anyone with it can see the plot, no login${i.rotate ? " (the old link stops working)" : ""}`,
  "stagePlots.remove": (i) => `Archive the stage plot${i.label ? ` ${i.label}` : ""}: its engineer link stops working and shows that picked it are cleared`,
  "stagePlots.shareOff": (i) => `Turn off the engineer link${i.label ? ` for the stage plot ${i.label}` : ""}: the link already sent stops working`,
  "venues.mergeInto": () => "Merge a duplicate venue into another one for EVERY band: shows, pitches and notes move, and the duplicate is archived",
  "venues.update": (i, before) => {
    const patch = (i.patch ?? {}) as Record<string, unknown>;
    const diffs = sharedVenueFields(i).map((k) => `${k}: ${fmtField(k, before?.[k])} → ${fmtField(k, patch[k])}`);
    return `Change the shared room${i.label ? ` ${i.label}` : ""} for every band that uses Roadie (${diffs.join("; ")})`;
  },
};
/** What the confirm card says. `label` is a human name for the record (Roadie adds it from what it looked up). */
export function summarize(name: string, input: unknown, label?: string, before?: Before): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const base = SUMMARY[name]?.({ ...i, ...(label ? { label } : {}) }, before);
  if (base) return base;
  const [kind, verb] = name.split(".");
  const what = label ? `${kind} ${label}` : kind;
  return verb === "remove" ? `Archive ${what}` : `Run ${name}${label ? ` on ${label}` : ""}`;
}
