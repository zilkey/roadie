/**
 * Import Ingrid's pitch log and distances from the "Venue Book" tab of her "Upcoming Shows" sheet, from the snapshot in
 * .booking-kit/venue-book-sheet.json (written by scripts/snapshot-venue-book.ts).
 *   tsx scripts/import-venue-book-sheet.ts [--dry-run] [--yes] [--artist=<slug>] [--report=<file.json>]
 *
 * The venues themselves came in from the claude.ai Venue Book tracker (import-booking-kit.ts, pulled 2026-10-23). This
 * tab is Ingrid's working copy of that tracker and has moved on since: eight breweries added at the top, an "E-mail"
 * column that is her pitch log, and a "Miles from Boulder" column. Decided with Jeff on 2026-10-25:
 *
 *   - "sent 10/23" (or a bare "10/23", which reads the same) is a pitch: status `pitched`, last contact that day, one
 *     comment "Sent message on 10/23/2026". The year is the capture's unless that would put the date in the future.
 *   - "booked" needs nothing: the show already exists from the tracker. A "booked" row with no show is reported.
 *   - "meh gig" is a venue note, not a pitch. Any other text in the column is reported, never guessed at.
 *   - Miles go on the venue as one line of the band's private notes ("58 miles from Boulder (Ingrid's distance
 *     calculation)"). Houses and festivals have no venue record, so their miles are deferred and said so.
 *   - A venue the sheet has and the app does not is created (`vbs-<slug>`, with its contact columns); a venue the app
 *     already has is matched by name and its contacts are NOT re-imported (the tracker import carried them).
 *
 * A pitch whose target is already on the Pitch List (the support-slot import made some) is reported, not duplicated.
 * Everything gets a fixed id (`vbs-*`), so a re-run finds its own records. All writes go through db.ts with via
 * "import" and one runId (Admin → History can undo it). Real Firestore needs --yes.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DocumentData } from "firebase-admin/firestore";
import { run, db, type Doc, type Writer } from "../src/server/db";
import { importCtx, newRunId } from "../src/server/ctx";
import { noteOf, writeNote } from "../src/server/venues";
import { slug, e164 } from "../src/schema/normalize";
import { email as emailSchema } from "../src/schema/common";
import { roleIn } from "../src/schema/users";
import { formatSurvey, note, tally, type Note, type Survey } from "./survey";
import { regionForCity, splitCity } from "./import-booking-kit";
import type { VenueBookRow, VenueBookSnapshot } from "./snapshot-venue-book";

/** Sheet type → venue type. Houses and festivals are not venues in the app (hosts are contacts; festivals their own record). */
const VENUE_TYPES: Record<string, string> = {
  "listening room": "listening", "cafe / listening room": "listening", "brewery / taproom": "brewery", "bar / club": "bar",
  "outdoor series": "outdoor", "farm / outdoor": "outdoor", "event space": "other", "library / community": "other",
  "listening": "listening", other: "other",
};
const NOT_A_VENUE = new Set(["house concert", "festival", "conference", "radio"]);
const MILES_MARK = "miles from Boulder";

/** What the E-mail column says, read once so the survey and the writes agree. */
export type PitchLog =
  | { kind: "none" } | { kind: "sent"; date: string; bare: boolean } | { kind: "booked" } | { kind: "note"; text: string } | { kind: "unknown"; text: string };

/**
 * "sent 10/23" → a pitch on 2026-10-23 (the capture's year, or the year before when that day has not come yet: a log
 * entry is never in the future). A bare "10/23" reads the same, flagged so the survey can say it was read that way.
 */
export function readPitchLog(text: string, fetchedAt: string): PitchLog {
  const t = text.trim();
  if (!t) return { kind: "none" };
  if (/^booked$/i.test(t)) return { kind: "booked" };
  if (/^meh gig$/i.test(t)) return { kind: "note", text: "Meh gig" };
  const m = t.match(/^(?:(sent)\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/i);
  if (!m) return { kind: "unknown", text: t };
  const [, sent, mm, dd, yy] = m;
  let year = yy ? (yy.length === 2 ? 2000 + +yy : +yy) : +fetchedAt.slice(0, 4);
  let date = `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  if (!yy && date > fetchedAt) { year -= 1; date = `${year}-${date.slice(5)}`; }
  return { kind: "sent", date, bare: !sent };
}

/** "10/23/2026", the way the sheet writes dates, for the comment. */
const usDate = (iso: string) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}/${iso.slice(0, 4)}`;

interface RowReport { row: number; name: string; venue?: { id: string; action: "matched" | "created" | "merged" }; pitch?: "created" | "already there" | "already on Pitch List"; miles?: "added" | "already there"; }
export interface VenueBookSheetReport {
  project: string; dryRun: boolean; runId: string; source: string; fetchedAt: string;
  artist?: { id: string; slug: string; name: string };
  rows: RowReport[]; notes: Note[];
  written: { collection: string; action: string; id: string }[];
}

const validEmail = (s: string) => emailSchema.safeParse(s.trim().toLowerCase()).success;
const lines = (...xs: (string | false | undefined | null)[]) => xs.filter((x): x is string => !!x && !!x.trim()).join("\n") || undefined;

export async function importVenueBookSheet(
  opts: { dryRun?: boolean; artist?: string; snapshot?: VenueBookSnapshot } = {},
): Promise<VenueBookSheetReport> {
  const snap = opts.snapshot
    ?? (JSON.parse(readFileSync(join(process.cwd(), ".booking-kit", "venue-book-sheet.json"), "utf8")) as VenueBookSnapshot);
  const runId = newRunId();
  const report: VenueBookSheetReport = {
    project: process.env.GCLOUD_PROJECT ?? "", dryRun: !!opts.dryRun, runId, source: snap.source, fetchedAt: snap.fetchedAt,
    rows: [], notes: [], written: [],
  };
  const { notes } = report;
  const record = (collection: string, action: string, id: string) => report.written.push({ collection, action, id });

  const artists = await db.list("artists");
  const artist = opts.artist ? artists.find((a) => a.slug === opts.artist) : artists.length === 1 ? artists[0] : undefined;
  if (!artist) return report;
  report.artist = { id: artist.id, slug: artist.slug as string, name: artist.name as string };

  const ctx = importCtx("import-venue-book-sheet", runId, artist.id);
  // One overlay for the whole dry run, so later rows see the venues earlier rows made (the shared pattern from
  // import-booking-kit.ts): without it a dry run reports pitches on venues that "do not exist".
  const overlay = new Map<string, DocumentData | null>();
  const unit = <T>(fn: (w: Writer) => Promise<T>) => run(ctx, fn, opts.dryRun ? { dryRun: true, overlay } : {});

  const users = await db.list("users");
  const isAdmin = (u: Doc) => roleIn(u, artist.id) === "admin";
  const assigneeId = users.find((u) => isAdmin(u) && /^jeff\b/i.test(String(u.name)))?.id ?? users.find(isAdmin)?.id;
  const cfg = (artist.configurations as { id: string; musicianIds: string[] }[] | undefined)?.find((c) => c.id === "full-band");

  // The app's venues by name. Names are how the sheet and the tracker agree (cities are spelled three ways), so the
  // name slug is the key; a name two live venues share cannot be matched and is reported.
  const venues = (await db.list("venues")).filter((v) => !v.deletedAt);
  const byName = new Map<string, Doc[]>();
  for (const v of venues) byName.set(slug(String(v.name)), [...(byName.get(slug(String(v.name))) ?? []), v]);
  const sources = [{ url: snap.source, checkedAt: snap.fetchedAt, note: "Venue Book tab, Ingrid's Upcoming Shows sheet" }];

  for (const r of snap.rows) {
    const out: RowReport = { row: r.row, name: r.name };
    report.rows.push(out);
    const where = `row ${r.row} ${r.name}`;
    const log = readPitchLog(r.pitchLog, snap.fetchedAt);
    const type = r.type.trim().toLowerCase();

    if (NOT_A_VENUE.has(type)) {
      // Nothing of this row's is a venue fact. Say what is not carried, so a house with miles does not look lost.
      if (r.miles) notes.push(note("deferred", "miles not kept: a house, festival or radio row has no venue record", where, `${r.miles} miles`));
      if (log.kind !== "none" && log.kind !== "booked") notes.push(note("unclean", "pitch log on a row with no venue record, so nothing was made", where, r.pitchLog));
      continue;
    }

    await unit(async (w) => {
      // ---------- the venue ----------
      const hits = byName.get(slug(r.name)) ?? [];
      if (hits.length > 1) {
        notes.push(note("unclean", "two venues in the app share this name, so the row could not be placed", where, hits.map((h) => h.id).join(", ")));
        return;
      }
      let venue = hits[0];
      if (!venue) {
        const { city, state } = r.city ? splitCity(r.city) : { city: "Unknown", state: "CO" };
        const region = regionForCity(city, state) ?? "boulder";
        if (!r.city || !regionForCity(city, state)) notes.push(note("decide", "city does not match any region, so one was guessed", where, `city "${r.city}" → region ${region}`));
        const vtype = VENUE_TYPES[type];
        if (!vtype) notes.push(note("decide", "sheet type is not one the app has, so the venue is typed \"other\"", where, `"${r.type}"`));
        const id = `vbs-${slug(r.name)}`;
        const res = await w.create("venues", { name: r.name, type: vtype ?? "other", address: { city, state }, region, sources }, { id });
        venue = (await w.get("venues", res.id))!;
        out.venue = { id: res.id, action: res.merged ? "merged" : "created" };
        record("venues", res.merged ? "merged into existing" : "created", res.id);
        if (res.merged) notes.push(note("decide", "venues: a record with this name and city already exists, so the two were merged", where, `kept ${res.id}, wanted ${id}`));
        byName.set(slug(r.name), [venue]);
        // Its contact columns, since no earlier import carried them.
        const emails = r.contactEmail.split(/[|\n]/).map((e) => e.trim().toLowerCase()).filter(Boolean);
        const phones = r.contactPhone.split(/[|\n]/).map((p) => p.trim()).filter(Boolean);
        if (r.contact || emails.length || phones.length) {
          const bad = [...emails.filter((e) => !validEmail(e)), ...phones.filter((p) => !/^\+[1-9]\d{6,14}$/.test(e164(p)))];
          if (bad.length) notes.push(note("unclean", "email or phone could not be parsed, kept as a note instead", where, bad.join(", ")));
          const c = await w.create("contacts", {
            name: r.contact.split("\n")[0].trim() || emails[0] || `${r.name} contact`,
            emails: emails.filter(validEmail), phones: phones.map(e164).filter((p) => /^\+[1-9]\d{6,14}$/.test(p)),
            notes: lines(r.contactNotes, bad.length > 0 && `Unparsed: ${bad.join(", ")}`), sources,
          }, { id: `vbs-${slug(r.name)}-c1` });
          record("contacts", c.merged ? "merged into existing" : "created", c.id);
          await writeNote(w, venue, artist.id, { contactIds: [c.id] });
        }
      } else {
        out.venue = { id: venue.id, action: "matched" };
      }

      // ---------- miles ----------
      if (r.miles) {
        const { fields } = await noteOf(w, venue, artist.id);
        if (fields.notes?.includes(MILES_MARK)) out.miles = "already there";
        else {
          await writeNote(w, venue, artist.id, { notes: lines(fields.notes, `${r.miles} ${MILES_MARK} (Ingrid's distance calculation)`) });
          out.miles = "added";
          record("venueNotes", "miles added", venue.id);
        }
      }

      // ---------- the pitch log ----------
      if (log.kind === "unknown") {
        notes.push(note("unclean", "E-mail column text not understood, so nothing was made from it", where, `"${log.text}"`));
      } else if (log.kind === "note") {
        const { fields } = await noteOf(w, venue, artist.id);
        if (!fields.notes?.includes(log.text)) {
          await writeNote(w, venue, artist.id, { notes: lines(fields.notes, log.text) });
          record("venueNotes", "note added", venue.id);
        }
        notes.push(note("deferred", "E-mail column kept as a venue note, not a pitch (Jeff, 2026-10-25)", where, `"${r.pitchLog}"`));
      } else if (log.kind === "booked") {
        const shows = (await w.query("shows", (q) => q.where("venue.id", "==", venue.id), { pending: !!opts.dryRun })).filter((s) => !s.deletedAt && s.venue?.id === venue.id);
        if (!shows.length) notes.push(note("unclean", "\"booked\" but the app has no show at this venue", where));
        else notes.push(note("deferred", "\"booked\": the show is already in the app, so no pitch was made", where, shows.map((s) => s.date).sort().join(", ")));
      } else if (log.kind === "sent") {
        if (log.bare) notes.push(note("decide", "bare date in the E-mail column, read as \"sent\" that day (Jeff, 2026-10-25)", where, `"${r.pitchLog}" → ${log.date}`));
        const id = `vbs-${slug(r.name)}`;
        if (await w.get("pitches", id)) { out.pitch = "already there"; record("pitches", "already there", id); return; }
        const open = (await w.query("pitches", (q) => q.where("target.id", "==", venue.id), { pending: !!opts.dryRun }))
          .find((p) => p.target?.id === venue.id && p.target?.kind === "venue" && !p.deletedAt);
        if (open) {
          out.pitch = "already on Pitch List"; record("pitches", "target already on Pitch List", open.id);
          notes.push(note("unclean", "target is already on the Pitch List under another pitch, so no pitch was made", where, `kept ${open.id}`));
          return;
        }
        await w.create("pitches", {
          target: { kind: "venue", id: venue.id, name: String(venue.name) }, status: "pitched", artistId: artist.id,
          pitchedAs: cfg?.id, personnel: cfg?.musicianIds ?? [], assigneeId, showIds: [],
          lastContactAt: new Date(`${log.date}T12:00:00-06:00`), sources,
        }, { id });
        await w.create(`pitches/${id}/activity`, { type: "status", toStatus: "pitched", text: "Imported from the Venue Book sheet" });
        await w.create(`pitches/${id}/comments`, { authorId: assigneeId ?? w.ctx.uid, body: `Sent message on ${usDate(log.date)}` });
        out.pitch = "created"; record("pitches", "created", id);
      }
    });
  }
  return report;
}

/** The survey Jeff signs off on. The new venues and the pitches are what matter, so they lead the counts. */
export function venueBookSheetSurvey(r: VenueBookSheetReport): Survey {
  const pitched = r.rows.filter((x) => x.pitch === "created").length;
  return {
    title: "Venue Book sheet (pitch log and miles)", project: r.project, dryRun: r.dryRun, runId: r.runId,
    source: `${r.rows.length} venue rows from the Venue Book tab, captured ${r.fetchedAt}${r.artist ? `, for ${r.artist.name}` : ""}`,
    clean: tally(r.written), notes: r.notes,
    totals: {
      "venues matched": r.rows.filter((x) => x.venue?.action === "matched").length,
      "venues created": r.rows.filter((x) => x.venue?.action === "created").length,
      "pitches created": pitched,
      "miles added": r.rows.filter((x) => x.miles === "added").length,
    },
  };
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await importVenueBookSheet({ dryRun: flag("dry-run"), artist: arg("artist") });
  if (!r.artist) throw new Error(arg("artist") ? `No artist with slug ${arg("artist")}` : "Say which artist with --artist=<slug>.");
  console.log(formatSurvey(venueBookSheetSurvey(r)));
  if (!r.dryRun) console.log(`\nRun ${r.runId} -- undo it from Admin → History.`);
  const out = arg("report");
  if (out) { writeFileSync(out, JSON.stringify(r, null, 2) + "\n"); console.log(`Report: ${out}`); }
}

if (process.argv[1]?.endsWith("import-venue-book-sheet.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
