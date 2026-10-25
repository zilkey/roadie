/**
 * One-time import of the band's rehearsal and show history (the Songs tab's columns M..X: one column per rehearsal
 * or show, a ✅ in each row the song was played) from the snapshot in .booking-kit/song-list.json.
 *   tsx scripts/import-rehearsal-history.ts [--dry-run] [--yes] [--artist=<slug>] [--report=<file.json>]
 *
 * scripts/import-song-list.ts deliberately left these columns (story 27 → story 18): they belong in `rehearsals` and
 * `setlists`, which already exist in the schema. It reported a ✅ count per column, and those counts are this
 * import's acceptance test -- see COLUMNS below, where each one is written down next to what the column becomes.
 *
 * The sheet alone can't say what these columns are. Three things come from Jeff (2026-10-24) rather than the grid:
 *   - column M "Doghouse" is a place, not a date; its date is 2026-06-28.
 *   - the 10/3, 10/16 and 10/17 columns are SHOWS, not rehearsals, so they become setlists on shows that exist.
 *   - who was at each rehearsal, which the sheet never records.
 * They are data, not logic, so they live in one table at the top of this file where they can be checked against the
 * sheet by eye.
 *
 * Fixed ids (rehearsal-<date>, setlist-<showId>), so a re-run updates instead of duplicating. All writes go through
 * db.ts with via "import" and one runId (Admin → History can undo it). Real Firestore needs --yes.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DocumentData } from "firebase-admin/firestore";
import { run, db, type Doc, type Writer } from "../src/server/db";
import { importCtx, newRunId } from "../src/server/ctx";
import { formatSurvey, note, tally, type Bucket, type Note, type Survey } from "./survey";
import { cleanTitle } from "./import-song-list";
import type { SongListSnapshot } from "./snapshot-song-list";

/** Column A: the song title, the only column outside the M..X block this import reads. */
const COL_TITLE = 0;

/**
 * What each history column is, with the ✅ count the song-list import reported on 2026-10-25.
 *
 * `ticks` is an assertion, not a hint: a column whose count has drifted from this table means the sheet changed
 * under the snapshot, and the import says so rather than carrying a number nobody has checked.
 *
 * The three `show` columns are columns whose songs belong to a show that already exists in the app. Only 10/3 has
 * any ✅ -- the other two are empty, which is why they are listed here but import nothing (see EMPTY_SHOWS).
 */
interface ColumnSpec {
  /** Zero-based column index in the snapshot's values grid. */
  col: number;
  /** The header as the sheet writes it, checked against the snapshot before anything is imported. */
  header: string;
  kind: "rehearsal" | "show";
  /** ISO date. For every column but M this is the header parsed; M ("Doghouse") has no date in the sheet. */
  date: string;
  /** The ✅ count the song-list import reported, as this import's acceptance test. */
  ticks: number;
}

const COLUMNS: ColumnSpec[] = [
  // M is the one column headed by a place rather than a date. Jeff: the date is 6/28/26.
  { col: 12, header: "Doghouse", kind: "rehearsal", date: "2026-06-28", ticks: 7 },
  { col: 13, header: "7/26/26", kind: "rehearsal", date: "2026-07-26", ticks: 4 },
  { col: 14, header: "8/11/26", kind: "rehearsal", date: "2026-08-11", ticks: 2 },
  { col: 15, header: "9/15/26", kind: "rehearsal", date: "2026-09-15", ticks: 8 },
  { col: 16, header: "9/22/26", kind: "rehearsal", date: "2026-09-22", ticks: 4 },
  { col: 17, header: "9/28/26", kind: "rehearsal", date: "2026-09-28", ticks: 4 },
  { col: 18, header: "9/29/26", kind: "rehearsal", date: "2026-09-29", ticks: 5 },
  // 10/3 is headed as a plain date like a rehearsal, but it is the Denver Porchfest show. Jeff, 2026-10-24.
  { col: 19, header: "10/3/26", kind: "show", date: "2026-10-03", ticks: 14 },
  { col: 20, header: "10/4/26", kind: "rehearsal", date: "2026-10-04", ticks: 5 },
  { col: 21, header: "10/13/26", kind: "rehearsal", date: "2026-10-13", ticks: 0 },
  { col: 22, header: "10/16/26 Show", kind: "show", date: "2026-10-16", ticks: 0 },
  { col: 23, header: "10/17/26 Show", kind: "show", date: "2026-10-17", ticks: 0 },
];

/**
 * A rehearsal with no column in the sheet. 10/20 happened after the snapshot was taken and is the first rehearsal
 * with Emma, so the personnel is the whole point of it; the songs weren't recorded and the list is left empty.
 */
const EXTRA_REHEARSALS: { date: string; why: string }[] = [
  { date: "2026-10-20", why: "not in the sheet; added from Jeff's list (2026-10-24), the first rehearsal with Emma" },
];

/**
 * Who was at each rehearsal, by email (musicians are matched by email, as scripts/seed-real.ts does -- a name is
 * not an id and two people can share one). From Jeff, 2026-10-24; the sheet does not record attendance.
 *
 * Only rehearsals appear here. A setlist has no personnel field, so the 10/3 line Jeff gave with the others has
 * nowhere to land: who played the Porchfest show is the show's own business, not the setlist's.
 */
const INGRID = "ingrid@band.example";
const JEFF = "jeff@zilkey.com";
const DAVID = "bass@band.example";
const ERIC = "drums@band.example";
const EMMA = "guitar@band.example";
const QUARTET = [INGRID, JEFF, DAVID, ERIC];

const PERSONNEL: Record<string, string[]> = {
  "2026-06-28": QUARTET,
  "2026-07-26": QUARTET,
  "2026-08-11": QUARTET,
  "2026-09-15": QUARTET,
  "2026-09-22": QUARTET,
  "2026-09-28": QUARTET,
  "2026-09-29": QUARTET,
  "2026-10-04": QUARTET,
  "2026-10-13": QUARTET,
  "2026-10-20": [...QUARTET, EMMA],
};

/**
 * The two show columns with no ✅ at all. Both shows are real, already in the app, and both dates are past, so an
 * empty setlist on them would be a claim that nothing was played. Jeff, 2026-10-24: ignore them.
 *
 * They stay in COLUMNS so the column-count check still covers all twelve and the report can say out loud that they
 * were read and skipped -- a column silently absent from a report is the way data goes missing unnoticed.
 */
const EMPTY_SHOWS = new Set(["2026-10-16", "2026-10-17"]);

/** The mark that means "we played this". Anything non-empty counts; the sheet uses ✅ throughout. */
const isTick = (s: string) => !!s.trim();

/** "Doghouse" -> the rehearsal location the band means by it (Eric's gas sheet has the address). */
const DOGHOUSE = { name: "Dog House", address: "1 Example Way, Lafayette, CO" };

export interface RehearsalHistoryReport {
  project: string; dryRun: boolean; runId: string; source: string; sheet: string; fetchedAt: string;
  artist?: { id: string; slug: string; name: string };
  columns: {
    col: string; header: string; kind: "rehearsal" | "show"; date: string;
    /** The ✅ actually counted in the snapshot, against `expected` from the table above. */
    ticks: number; expected: number;
    /** The doc this column became, when it became one. */
    id?: string;
    action?: "created" | "updated" | "unchanged" | "skipped";
    /** Resolved personnel, as names, for the report. */
    personnel?: string[];
    songs: { songId: string; title: string }[];
    issues: string[];
  }[];
  /** People named in PERSONNEL that no musician record matches: the import can't invent them. */
  unknownPeople: string[];
}

type ColumnReport = RehearsalHistoryReport["columns"][number];

const colLetter = (c: number) => (c < 26 ? String.fromCharCode(65 + c) : `A${String.fromCharCode(65 + c - 26)}`);

export async function importRehearsalHistory(
  opts: { dryRun?: boolean; artist?: string; snapshot?: SongListSnapshot } = {},
): Promise<RehearsalHistoryReport> {
  const snap = opts.snapshot
    ?? (JSON.parse(readFileSync(join(process.cwd(), ".booking-kit", "song-list.json"), "utf8")) as SongListSnapshot);
  const runId = newRunId();
  const report: RehearsalHistoryReport = {
    project: process.env.GCLOUD_PROJECT ?? "", dryRun: !!opts.dryRun, runId,
    source: snap.source, sheet: snap.sheet, fetchedAt: snap.fetchedAt,
    columns: [], unknownPeople: [],
  };

  const artists = await db.list("artists");
  const artist = opts.artist ? artists.find((a) => a.slug === opts.artist) : artists.length === 1 ? artists[0] : undefined;
  if (!artist) return report;
  report.artist = { id: artist.id, slug: artist.slug as string, name: artist.name as string };

  const ctx = importCtx("import-rehearsal-history", runId, artist.id);
  // One overlay for the whole dry run, so a dry run's dedupe sees its own pending writes (the shared pattern from
  // import-booking-kit.ts and import-song-list.ts).
  const overlay = new Map<string, DocumentData | null>();
  const unit = <T>(fn: (w: Writer) => Promise<T>) => run(ctx, fn, opts.dryRun ? { dryRun: true, overlay } : {});

  // ---------- the people ----------
  // Matched by email, like scripts/seed-real.ts: a musician record's name is not an id. A person named in the
  // personnel table with no record is reported rather than skipped silently -- a rehearsal missing a player is a
  // quiet wrong answer, and `personnel` is required, so a half-filled list must be visible.
  const musicians = await db.list("musicians");
  const byEmail = new Map<string, Doc>();
  for (const m of musicians) {
    const e = (m.email as string | undefined)?.toLowerCase();
    if (e) byEmail.set(e, m);
  }
  const missingPeople = new Set<string>();
  const resolve = (emails: string[]) => {
    const ids: string[] = [], names: string[] = [];
    for (const e of emails) {
      const m = byEmail.get(e.toLowerCase());
      if (m) { ids.push(m.id); names.push(m.name as string); }
      else missingPeople.add(e);
    }
    return { ids, names };
  };

  // ---------- the songs each column marks ----------
  // Songs are looked up by the id the song-list import fixed (song-<slug(title)>) and by title, so a ✅ on a row
  // whose song didn't import is reported rather than dropped.
  const songs = await db.list("songs");
  const byId = new Map(songs.map((s) => [s.id, s]));
  const byTitle = new Map(songs.map((s) => [(s.title as string).trim().toLowerCase(), s]));
  const cell = (r: number, c: number) => (snap.values[r]?.[c] ?? "").trim();

  const header = snap.values[0] ?? [];
  const songsIn = (spec: ColumnSpec, issues: string[]) => {
    const out: { songId: string; title: string }[] = [];
    for (let r = 1; r < snap.values.length; r++) {
      if (!isTick(cell(r, spec.col))) continue;
      const raw = cell(r, COL_TITLE);
      // The song-list import strips a trailing "(cover)"/"(chart)" before it stores the title and builds the id, so
      // the same cleaning has to happen here or "Luckiest Man (cover)" never finds the song called "Luckiest Man".
      const title = cleanTitle(raw);
      // Row 2's title cell is a date serial Sheets ate ("Feb 17"), so the title there can't find the song; its id
      // can. The song-list import's slug is the link between the two.
      const slugged = `song-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
      const song = byTitle.get(title.toLowerCase()) ?? byId.get(slugged);
      if (!song) {
        issues.push(`row ${r + 1} is marked but no song matches "${raw || "(blank title cell)"}" -- import the song list first, or check the title`);
        continue;
      }
      out.push({ songId: song.id, title: song.title as string });
    }
    return out;
  };

  // ---------- the columns ----------
  for (const spec of COLUMNS) {
    const issues: string[] = [];
    const head = (header[spec.col] ?? "").trim();
    // The column mapping above is positional and carries hand-entered facts (M's date, which columns are shows), so
    // it is checked against the sheet before it is trusted: a column that has moved would otherwise import one
    // rehearsal's songs under another's date.
    if (head !== spec.header) {
      issues.push(`column ${colLetter(spec.col)} is headed "${head}", not "${spec.header}" -- the sheet has changed since this importer was written`);
    }
    const found = songsIn(spec, issues);
    const out: ColumnReport = {
      col: colLetter(spec.col), header: spec.header, kind: spec.kind, date: spec.date,
      ticks: snap.values.slice(1).filter((r) => isTick(r[spec.col] ?? "")).length,
      expected: spec.ticks, songs: found, issues,
    };
    report.columns.push(out);
    if (out.ticks !== out.expected) {
      issues.push(`${out.ticks} song(s) marked, but story 18 counted ${out.expected} on 2026-10-25 -- the sheet has changed since the snapshot`);
    }
    // A header that doesn't match means this column is no longer the thing the table says it is, and every fact
    // below (its date, whether it's a show) is then a guess. Stop rather than write it somewhere wrong.
    if (head !== spec.header) { out.action = "skipped"; continue; }

    if (spec.kind === "show") {
      if (EMPTY_SHOWS.has(spec.date)) {
        out.action = "skipped";
        issues.push("no songs marked, and the show already happened: an empty setlist would claim nothing was played (Jeff, 2026-10-24)");
        continue;
      }
      await writeSetlist(unit, spec, out, issues);
      continue;
    }

    const { ids, names } = resolve(PERSONNEL[spec.date] ?? []);
    out.personnel = names;
    if (!PERSONNEL[spec.date]) issues.push(`nobody is listed for ${spec.date}; imported with an empty personnel list`);
    await writeRehearsal(unit, spec.date, out, ids, found, spec.col === 12 ? DOGHOUSE : undefined);
  }

  // ---------- rehearsals with no column ----------
  for (const extra of EXTRA_REHEARSALS) {
    const issues = [extra.why];
    const { ids, names } = resolve(PERSONNEL[extra.date] ?? []);
    const out: ColumnReport = {
      col: "--", header: extra.date, kind: "rehearsal", date: extra.date,
      ticks: 0, expected: 0, personnel: names, songs: [], issues,
    };
    report.columns.push(out);
    await writeRehearsal(unit, extra.date, out, ids, [], undefined);
  }

  report.unknownPeople = [...missingPeople].sort();
  return report;
}

/** A rehearsal, at the fixed id `rehearsal-<date>` so a re-run updates its own doc rather than adding a second. */
async function writeRehearsal(
  unit: <T>(fn: (w: Writer) => Promise<T>) => Promise<T>,
  date: string,
  out: ColumnReport,
  personnel: string[],
  songs: { songId: string; title: string }[],
  location: { name: string; address: string } | undefined,
) {
  const id = `rehearsal-${date}`;
  out.id = id;
  const input = { date, personnel, songs, ...(location ? { location } : {}) };
  await unit(async (w) => {
    const have = await w.get("rehearsals", id);
    const same = have && !have.deletedAt
      && have.date === date
      && JSON.stringify(have.personnel ?? []) === JSON.stringify(personnel)
      && JSON.stringify(have.songs ?? []) === JSON.stringify(songs)
      && JSON.stringify(have.location ?? null) === JSON.stringify(location ?? null);
    out.action = !have ? "created" : same ? "unchanged" : "updated";
    if (!have) await w.create("rehearsals", input, { id });
    else if (!same) {
      if (have.deletedAt) await w.restore("rehearsals", id);
      await w.update("rehearsals", id, input);
    }
  });
}

/**
 * A setlist on the show that happened that day, at the fixed id `setlist-<showId>`.
 *
 * The songs are in sheet order, which is alphabetical by title -- it is NOT the order they were played. The report
 * says so, because a setlist's whole shape invites being read as a running order.
 */
async function writeSetlist(
  unit: <T>(fn: (w: Writer) => Promise<T>) => Promise<T>,
  spec: ColumnSpec,
  out: ColumnReport,
  issues: string[],
) {
  await unit(async (w) => {
    const shows = await w.query("shows", (q) => q.where("date", "==", spec.date));
    if (!shows.length) {
      // A date with no show is a flag, not a guess: inventing the show would put a gig in the app that nobody booked.
      out.action = "skipped";
      issues.push(`no show found on ${spec.date}, so there is nothing to hang a setlist on -- import the shows first`);
      return;
    }
    if (shows.length > 1) {
      out.action = "skipped";
      issues.push(`${shows.length} shows on ${spec.date} (${shows.map((s) => s.id).join(", ")}); which one played this set is a guess, so nothing was written`);
      return;
    }
    const show = shows[0];
    const id = `setlist-${show.id}`;
    out.id = id;
    issues.push(`songs are in sheet order (alphabetical), which is not the order they were played`);
    const items = out.songs.map((s) => ({ type: "song" as const, songId: s.songId, title: s.title }));
    // A show has no title field: it is named by its venue, or by the place a venue-less show happens at.
    const venue = (show.venue as { name?: string } | undefined)?.name
      ?? (show.place as { city?: string } | undefined)?.city;
    const input = { name: [spec.date, venue].filter(Boolean).join(" "), showId: show.id, items };
    const have = await w.get("setlists", id);
    const same = have && !have.deletedAt
      && have.name === input.name && have.showId === input.showId
      && JSON.stringify(have.items ?? []) === JSON.stringify(items);
    out.action = !have ? "created" : same ? "unchanged" : "updated";
    if (!have) await w.create("setlists", input, { id });
    else if (!same) {
      if (have.deletedAt) await w.restore("setlists", id);
      await w.update("setlists", id, input);
    }
  });
}

/**
 * The rehearsal-history survey. It leads with the per-column counts, because those are story 18's acceptance test
 * and the one thing that can't be checked after the fact: a column imported under the wrong date looks perfectly
 * fine in the app.
 */
export function rehearsalHistorySurvey(r: RehearsalHistoryReport): Survey {
  const notes: Note[] = [];
  if (!r.artist) {
    notes.push(note("unclean", "NO ARTIST: there is nothing to import into", "", "run stories 01-04 first, or pass --artist=<slug>"));
  }
  for (const e of r.unknownPeople) {
    notes.push(note("unclean", "a person listed for a rehearsal has no musician record, so they are missing from its personnel",
      e, "add them in People, or fix the email in PERSONNEL"));
  }
  for (const c of r.columns) {
    const where = `column ${c.col} ${c.header}`;
    for (const issue of c.issues) {
      const bucket: Bucket = /has changed|no song matches|no show found|which one played/.test(issue) ? "unclean"
        : /would claim nothing was played|not in the sheet|nobody is listed/.test(issue) ? "decide"
        : "deferred";
      const reason = issue
        .replace(/"[^"]*"/g, "a value")
        .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "a date")
        .replace(/\b\d+\b/g, "N")
        .trim();
      notes.push(note(bucket, reason, where, issue));
    }
    if (c.action === "updated") {
      notes.push(note("overwrite", `a ${c.kind} already there would be updated`, where, c.id));
    }
  }

  const rehearsals = r.columns.filter((c) => c.kind === "rehearsal");
  const setlists = r.columns.filter((c) => c.kind === "show");
  return {
    title: "Rehearsal and show history",
    project: r.project, dryRun: r.dryRun, runId: r.runId,
    source: `${r.columns.length} columns from the ${r.sheet} tab (captured ${r.fetchedAt})`,
    clean: tally(r.columns.filter((c) => c.action && c.action !== "skipped")
      .map((c) => ({ collection: c.kind === "show" ? "setlists" : "rehearsals", action: c.action! }))),
    notes,
    totals: {
      artist: r.artist ? `${r.artist.name} (${r.artist.slug})` : "NONE -- nothing can be imported",
      // The per-column counts, which are what story 18 checks itself against.
      "songs per column": r.columns
        .map((c) => `${c.col === "--" ? c.header : c.col} ${c.songs.length}${c.ticks !== c.expected ? ` (expected ${c.expected}!)` : ""}`)
        .join(", "),
      rehearsals: `${rehearsals.length} columns, ${rehearsals.filter((c) => c.action && c.action !== "skipped").length} written`,
      setlists: `${setlists.length} show columns, ${setlists.filter((c) => c.action && c.action !== "skipped").length} written`,
      "songs placed": r.columns.reduce((n, c) => n + c.songs.length, 0),
      skipped: r.columns.filter((c) => c.action === "skipped").map((c) => c.col === "--" ? c.header : c.col).join(", ") || "none",
    },
  };
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await importRehearsalHistory({ dryRun: flag("dry-run"), artist: arg("artist") });
  console.log(formatSurvey(rehearsalHistorySurvey(r)));
  const out = arg("report");
  if (out) { writeFileSync(out, JSON.stringify({ ...r, survey: rehearsalHistorySurvey(r) }, null, 2) + "\n"); console.log(`Report: ${out}`); }
  if (!r.dryRun && r.columns.length) console.log(`\nRun ${r.runId} -- undo it from Admin → History.`);
  if (!r.artist) throw new Error("No artist found: nothing was imported.");
}

if (process.argv[1]?.endsWith("import-rehearsal-history.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
