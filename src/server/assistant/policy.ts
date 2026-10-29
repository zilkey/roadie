/**
 * What Roadie may do. The limits live here, in code, not in the prompt: a command that is not eligible is never offered
 * to the model and is refused again at run time. One place to read, one place to change.
 */
import { registry } from "../commands/registry";
import type { Role } from "../ctx";
import { formatCents, INCOME_LABEL, METHOD_LABEL, PROJECT_KIND_LABEL } from "@/lib/money";
import { ALBUM_KIND_LABEL } from "@/lib/albums";

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
  "email.signature",  // reads the admin's Gmail settings: Roadie never reads email
  "email.link", "email.sync", "email.thread", "email.search", "email.people", // the same: they read threads from Gmail
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
  "pitches.sendEmail", "email.send", "availability.ask", "availability.remind",                      // sends
  "expenses.setPaidBack", "expenses.payPerson",                                                              // money
  "income.add", "income.update", "income.setReceived", "payouts.add", "payouts.update", "payouts.markPaid",   // money in and out (*.remove asks too)
  "projects.create", "projects.update", "projects.close", "projects.reopen",                                 // what the money is for
  "shows.cancel", "shows.drop", "shows.setStatus", "shows.sync", "shows.calendar", "rehearsals.calendar", // cancels, leaves the app
  "files.shareWithBand", "files.copyToBand", "drive.fix", "albums.files.copyToFolder",   // changes Drive sharing
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
const ONE_RECORD_LISTS = new Set(["shows.setChecklists", "shows.setFields", "shows.setExpenses", "rehearsals.setExpenses", "checklistTemplates.create", "checklistTemplates.update", "checklistTemplates.reorder", "setlistTemplates.update", "setlistTemplates.create", "setlists.setItems", "setlists.seed", "artists.update", "rehearsals.create", "rehearsals.update", "rehearsals.importSetlist", "songs.create", "files.attach", "albums.create", "albums.tracks.add", "albums.tracks.update", "albums.tracks.reorder", "albums.files.attach", "albums.files.copyToFolder", "stagePlots.updateInputs", "stagePlots.reorderInputs", "stagePlots.move", "stagePlots.addItems", "stagePlots.removeItems", "stagePlots.setMonitors"]);

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

type Before = Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
/** A venue field as readable text for old → new. */
export function fmtField(k: string, v: unknown): string {
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
  "expenses.payPerson": (i, before) => `Pay ${before?.person ?? "them"}${before?.total ? ` ${formatCents(before.total)}` : " back"}${i.method ? ` (${METHOD_LABEL[i.method] ?? i.method})` : ""}`,
  // Money: the card reads like the sentence the person said. `before` carries the names the tool looked up (person, project, show) and, for a record named by id, its fields.
  "expenses.add": (i, b) => {
    const proj = b?.project ?? "the project", amt = formatCents(Number(i.amount) || 0);
    return i.userId && i.payBack !== false && b?.person ? `We owe ${b.person} ${amt} for ${i.what} (pay back, ${proj})` : `Put ${amt} ${i.what} on ${proj}`;
  },
  "income.add": (i, b) => {
    const amt = formatCents(Number(i.amount) || 0), cat = INCOME_LABEL[i.category]?.toLowerCase() ?? i.category;
    return i.receivedAt ? `${i.from} paid us ${amt} (${cat}${i.method ? `, ${METHOD_LABEL[i.method] ?? i.method}` : ""}, ${b?.project ?? "the project"})` : `${i.from} owes us ${amt} (${cat}, owed)`;
  },
  "income.update": (i, b) => `Change the ${b?.from ? `${b.from} ` : ""}income${b?.amount ? ` of ${formatCents(b.amount)}` : ""}: ${Object.keys(i.patch ?? {}).join(", ")}`,
  "income.setReceived": (i, b) => `Mark ${b?.from ?? "the"} income${b?.amount ? ` of ${formatCents(b.amount)}` : ""} as received${i.receivedAt ? ` on ${i.receivedAt}` : ""}${i.method ? ` (${METHOD_LABEL[i.method] ?? i.method})` : ""}`,
  "income.remove": (_i, b) => `Remove the ${b?.from ? `${b.from} ` : ""}income${b?.amount ? ` of ${formatCents(b.amount)}` : ""}`,
  "payouts.add": (i, b) => {
    const amt = formatCents(Number(i.amount) || 0), who = b?.person ?? "them", why = b?.show ? `the ${b.show} show` : i.what ?? "the band";
    return i.paidAt ? `We paid ${who} ${amt} for ${why}${i.method ? ` (${METHOD_LABEL[i.method] ?? i.method})` : ""}` : `We owe ${who} ${amt} for ${why}`;
  },
  "payouts.update": (i, b) => `Change what we ${b?.paidAt ? "paid" : "owe"} ${b?.person ?? "them"}${b?.amount ? ` (${formatCents(b.amount)})` : ""}: ${Object.keys(i.patch ?? {}).join(", ")}`,
  "payouts.markPaid": (i, b) => `We paid ${b?.person ?? "them"}${b?.amount ? ` ${formatCents(b.amount)}` : ""}${b?.what ? ` for ${b.what}` : ""} (${METHOD_LABEL[i.method] ?? i.method})${i.paidAt ? ` on ${i.paidAt}` : ""}`,
  "payouts.remove": (_i, b) => `Remove what we ${b?.paidAt ? "paid" : "owe"} ${b?.person ?? "them"}${b?.amount ? ` (${formatCents(b.amount)})` : ""}`,
  "projects.create": (i) => `Start the ${PROJECT_KIND_LABEL[i.kind]?.toLowerCase() ?? i.kind} project ${i.name}${i.isDefault ? ", as the default" : ""}`,
  "projects.update": (i, b) => `Change ${b?.name ? `the project ${b.name}` : "the project"}: ${Object.keys(i.patch ?? {}).join(", ")}`,
  "projects.close": (_i, b) => `Close ${b?.name ? `the project ${b.name}` : "the project"}: nothing new can be put on it`,
  "projects.reopen": (_i, b) => `Reopen ${b?.name ? `the project ${b.name}` : "the project"}`,
  "albums.create": (i) => `Start the ${ALBUM_KIND_LABEL[i.kind as keyof typeof ALBUM_KIND_LABEL]?.toLowerCase() ?? "album"} ${i.title}${i.budget ? ` (budget ${formatCents(i.budget)})` : ""}, with its own money project${i.setlistId || i.songIds?.length ? " and a tracklist" : ""}`,
  "albums.remove": (i) => `Archive the album${i.label ? ` ${i.label}` : ""} with its tracks and files; its project is closed`,
  "albums.tracks.add": (i, b) => `Put ${i.setlistId ? "a setlist's songs" : `${Array.isArray(i.songIds) ? i.songIds.length : "some"} song${Array.isArray(i.songIds) && i.songIds.length === 1 ? "" : "s"}`} on the album${b?.title ? ` ${b.title}` : ""}`,
  "albums.files.approve": (i, b) => (i.approved ? `Sign off ${b?.title ?? "the mix"}: the track moves on` : `Take back the sign-off on ${b?.title ?? "the mix"}`),
  "pitches.sendEmail": () => "Send an email from your Gmail",
  "email.send": () => "Send an email from your Gmail",
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
/** True when the command has its own card headline (cancel, pay, send...): those cards need no field rows. */
export const hasSummary = (name: string) => name in SUMMARY;
/** What the confirm card says. `label` is a human name for the record (Roadie adds it from what it looked up). */
export function summarize(name: string, input: unknown, label?: string, before?: Before): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const base = SUMMARY[name]?.({ ...i, ...(label ? { label } : {}) }, before);
  if (base) return base;
  const [kind, verb] = name.split(".");
  const what = label ? `${kind} ${label}` : kind;
  if (verb === "remove") return `Archive ${what}`;
  // The card lists the fields underneath, so the headline only says what kind of change it is.
  const one = kind.replace(/(ch|sh|ss|x)es$/, "$1").replace(/s$/, "");
  if (verb === "create" || verb === "add") return `Add ${typeof i.name === "string" ? `the ${one} ${i.name}` : `a ${one}`}`;
  if (verb === "update") return `Update ${label ?? `the ${one}`}`;
  return `Run ${name}${label ? ` on ${label}` : ""}`;
}
