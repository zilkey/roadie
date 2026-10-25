/**
 * Import the setlists of the fall 2026 shows from their tabs in the song-list sheet ("Ingrid Avison Band - Song List,
 * Shows"), from the snapshot in .booking-kit/show-setlists.json written by
 *   tsx scripts/snapshot-setlists.ts --sheet=1lc16Ajq-2LHH46zG1Acmc9mmm6lZH8Ac3fncxi_-Vno \
 *     --values=<payload.json> --out=.booking-kit/show-setlists.json
 * where the payload is one values range per tab in TABS (values.get echoes the range, which is where the title comes from).
 *   tsx scripts/import-show-setlists.ts [--dry-run] [--yes] [--artist=<slug>] [--report=<file.json>]
 *
 * Unlike the Set Lists sheet (import-setlists.ts) these tabs share one layout, a header row (Song, Key, Tempo, Time,
 * Seconds, Ingrid, Jeff, Notes, Transition, ...) and a song per row down to the first blank row. What is below that blank
 * row is totals, and the odd song parked under them (a cover on Denver Porchfest, Time Traveling Cowboy on Trident) that
 * was not in the set: it is reported, never read. So is a column with no header (Jamestown's "x" marks) and the copy of
 * the set Jamestown keeps off to the right.
 *
 * Which show each tab is, is Jeff's mapping (2026-10-25), by show id: the tab titles carry no dates. The show must exist
 * and its date must be the one in the id, or nothing is written. setlists/{showId} is created or replaced, so a re-run
 * updates instead of duplicating; a setlist already on the show that differs is an "overwrite" line in the survey.
 *
 * Per song: Key fills `key`, Seconds fills `lengthSec`, and the per-song words (Notes, who plays what, the transition into
 * the song, the after-show note) go in `note`. Tempo and the transition seconds have no place on a setlist item and are
 * not read. A row "BREAK" is a break. All writes go through db.ts with via "import" and one runId (Admin → History).
 */
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DocumentData } from "firebase-admin/firestore";
import type { z } from "zod";
import { run, db, type Doc, type Writer } from "../src/server/db";
import { importCtx, newRunId } from "../src/server/ctx";
import type { SetlistItem } from "../src/schema/setlists";
import { formatSurvey, note, tally, type Bucket, type Note, type Survey } from "./survey";
import { cleanTitle } from "./import-song-list";
import type { SetlistsSnapshot } from "./snapshot-setlists";

type Item = z.infer<typeof SetlistItem>;

/** Tab title exactly as the sheet spells it -> the show it is the setlist of. */
export const TABS: { tab: string; showId: string }[] = [
  { tab: "Warped Fest Setlist", showId: "vb-grossen-bart-2026-09-20" },
  { tab: "Denver Porchfest '26", showId: "vb-porchfest-denver-2026-10-03" },
  { tab: "Jamestown Merc '26", showId: "vb-jamestown-merc-2026-10-16" },
  { tab: "Trident '26", showId: "vb-trident-2026-10-17" },
];

/** Abbreviations the tabs use for songs (lowercase) -> the song's title. */
export const ALIASES: Record<string, string> = { hwsf: "Happy We're Still Fighting", iud: "The IUD Song" };

export interface Issue { bucket: Bucket; reason: string; detail?: string }
export interface TabReport {
  tab: string; showId: string;
  action?: "created" | "updated" | "unchanged" | "skipped";
  items: Item[];
  songs: number;
  unmatched: { row: number; title: string }[];
  issues: Issue[];
}
export interface ShowSetlistsReport {
  project: string; dryRun: boolean; runId: string; source: string; fetchedAt: string;
  artist?: { id: string; slug: string; name: string };
  tabs: TabReport[];
  issues: Issue[];
}

const cell = (row: string[] | undefined, c: number) => (c < 0 ? "" : (row?.[c] ?? "").trim());
const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s*&\s*/g, " and ").replace(/\s+/g, " ").trim();
const BREAK = /^[-–—=*\s]*(set\s*\d+|break|intermission)\b/i;
const colLetter = (c: number) => (c < 26 ? String.fromCharCode(65 + c) : `A${String.fromCharCode(65 + c - 26)}`);
/** JSON with sorted keys: Firestore hands maps back in its own key order, and unchanged must mean unchanged. */
const canon = (v: unknown): string => JSON.stringify(v, (_, x) =>
  x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
/** "3:10" -> 190. */
const mmss = (s: string) => { const m = s.match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : undefined; };

/** One parsed row: a song still to be looked up, or a break. */
export interface Line { row: number; kind: "song" | "break"; title: string; key?: string; lengthSec?: number; note?: string }

/**
 * A tab's grid -> its running order. Columns are found by header name, so the tabs' small differences (Notes is missing on
 * two, Trident adds "NOTE from show") need no per-tab code. The set is row 2 down to the first blank row.
 */
export function parseShowTab(values: string[][]): { lines: Line[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const head = (values[0] ?? []).map((h) => h.trim());
  const at = (re: RegExp) => head.findIndex((h) => re.test(h));
  const c = {
    song: at(/^songs?$/i), key: at(/^key$/i), seconds: at(/^seconds$/i), time: at(/^time$/i),
    ingrid: at(/^ingrid$/i), jeff: at(/^jeff$/i), notes: at(/^notes?$/i), transition: at(/^transition$/i), fromShow: at(/^note from show$/i),
  };
  if (c.song < 0) return { lines: [], issues: [{ bucket: "unclean", reason: "the tab has no Song column in row 1, so nothing was read" }] };
  const used = new Set(Object.values(c).filter((i) => i >= 0));

  let end = 1;
  while (end < values.length && values[end].some((v) => v.trim())) end++;
  const set = values.slice(1, end);

  const lines: Line[] = [];
  set.forEach((r, i) => {
    const row = i + 2;
    const title = cell(r, c.song);
    if (!title) return;
    if (BREAK.test(title)) { lines.push({ row, kind: "break", title: title.replace(/^[-–—=*\s]+|[-–—=*\s]+$/g, "") || "Break" }); return; }
    const parts = [
      cell(r, c.notes),
      cell(r, c.ingrid) && `Ingrid: ${cell(r, c.ingrid)}`,
      cell(r, c.jeff) && `Jeff: ${cell(r, c.jeff)}`,
      cell(r, c.transition) && `Transition: ${cell(r, c.transition)}`,
      cell(r, c.fromShow) && `From the show: ${cell(r, c.fromShow)}`,
    ].filter(Boolean);
    const secs = Number(cell(r, c.seconds));
    const lengthSec = Number.isInteger(secs) && secs > 0 ? secs : mmss(cell(r, c.time));
    lines.push({
      row, kind: "song", title,
      ...(cell(r, c.key) ? { key: cell(r, c.key) } : {}),
      ...(lengthSec ? { lengthSec } : {}),
      ...(parts.length ? { note: parts.join("; ") } : {}),
    });
  });

  // What was not read, said out loud: columns with no header inside the set, and anything under the first blank row.
  const stray = new Map<number, string>();
  set.forEach((r) => r.forEach((v, i) => { if (v.trim() && !head[i] && !stray.has(i)) stray.set(i, v.trim()); }));
  if (stray.size) {
    issues.push({ bucket: "deferred", reason: "a column with no header was not read", detail: [...stray].map(([i, v]) => `${colLetter(i)}: "${v}"`).join("; ") });
  }
  const unused = head.filter((h, i) => h && !used.has(i));
  if (unused.length) issues.push({ bucket: "deferred", reason: "columns with no place on a setlist item were not read", detail: unused.join(", ") });
  const below = values.slice(end).map((r, i) => ({ r, row: end + i + 1 })).filter(({ r }) => r.some((v) => v.trim()));
  if (below.length) {
    const first = below[0];
    issues.push({
      bucket: "deferred", reason: "rows under the set (after its first blank row) were not read",
      detail: `${below.length} row(s) from row ${first.row} "${first.r.find((v) => v.trim())!.trim()}"`,
    });
  }
  return { lines, issues };
}

export async function importShowSetlists(
  opts: { dryRun?: boolean; artist?: string; snapshot?: SetlistsSnapshot } = {},
): Promise<ShowSetlistsReport> {
  const snap = opts.snapshot
    ?? (JSON.parse(readFileSync(join(process.cwd(), ".booking-kit", "show-setlists.json"), "utf8")) as SetlistsSnapshot);
  const runId = newRunId();
  const report: ShowSetlistsReport = {
    project: process.env.GCLOUD_PROJECT ?? "", dryRun: !!opts.dryRun, runId,
    source: snap.source, fetchedAt: snap.fetchedAt, tabs: [], issues: [],
  };

  const artists = await db.list("artists");
  const artist = opts.artist ? artists.find((a) => a.slug === opts.artist) : artists.length === 1 ? artists[0] : undefined;
  if (!artist) return report;
  report.artist = { id: artist.id, slug: artist.slug as string, name: artist.name as string };

  const ctx = importCtx("import-show-setlists", runId, artist.id);
  // One overlay for the whole dry run, so a dry run's dedupe sees its own pending writes.
  const overlay = new Map<string, DocumentData | null>();
  const unit = <T>(fn: (w: Writer) => Promise<T>) => run(ctx, fn, opts.dryRun ? { dryRun: true, overlay } : {});

  // Songs by title, then by alias. "(cover)"/"(chart)" come off as the song-list import takes them off; any other
  // trailing parenthetical ("The Bliss (Ingrid Solo)") is a direction, so it goes in the note if the rest finds a song.
  const songs = (await db.list("songs")).filter((s) => !s.artistId || s.artistId === artist.id);
  const byTitle = new Map(songs.map((s) => [norm(s.title as string), s]));
  const lookup = (t: string) => byTitle.get(norm(t)) ?? (ALIASES[norm(t)] ? byTitle.get(norm(ALIASES[norm(t)])) : undefined);
  const find = (raw: string): { song?: Doc; title: string; extra?: string } => {
    const title = cleanTitle(raw);
    const song = lookup(title);
    if (song) return { song, title };
    const paren = title.match(/^(.+?)\s*\(([^)]+)\)$/);
    const bare = paren && lookup(paren[1]);
    return bare ? { song: bare, title: paren[1], extra: paren[2].trim() } : { title };
  };

  const tabsByTitle = new Map(snap.tabs.map((t) => [t.title, t]));
  for (const spec of TABS) {
    const issues: Issue[] = [];
    const out: TabReport = { tab: spec.tab, showId: spec.showId, items: [], songs: 0, unmatched: [], issues };
    report.tabs.push(out);
    const tab = tabsByTitle.get(spec.tab);
    if (!tab) {
      out.action = "skipped";
      issues.push({ bucket: "unclean", reason: "a mapped tab is not in the snapshot -- renamed, or the snapshot is old" });
      continue;
    }
    const parsed = parseShowTab(tab.values);
    issues.push(...parsed.issues);
    for (const l of parsed.lines) {
      if (l.kind === "break") { out.items.push({ type: "break", title: l.title }); continue; }
      const { song, title, extra } = find(l.title);
      if (!song) {
        out.unmatched.push({ row: l.row, title: l.title });
        issues.push({ bucket: "decide", reason: "a song title matches no song, kept as an item with no songId", detail: `row ${l.row} "${l.title}"` });
      }
      const noteText = [extra, l.note].filter(Boolean).join("; ");
      out.items.push({
        type: "song", ...(song ? { songId: song.id } : {}), title: song ? (song.title as string) : title,
        ...(l.lengthSec ? { lengthSec: l.lengthSec } : {}), ...(l.key ? { key: l.key } : {}), ...(noteText ? { note: noteText } : {}),
      });
      out.songs++;
    }
    if (!out.songs) {
      out.action = "skipped";
      issues.push({ bucket: "unclean", reason: "the tab has no songs, so no setlist was written" });
      continue;
    }

    await unit(async (w) => {
      const show = await w.get("shows", spec.showId);
      const date = spec.showId.slice(-10);
      if (!show || show.deletedAt || (show.artistId && show.artistId !== artist.id)) {
        out.action = "skipped";
        issues.push({ bucket: "unclean", reason: "the mapped show is not in the app, so nothing was written", detail: spec.showId });
        return;
      }
      if (show.date !== date) {
        out.action = "skipped";
        issues.push({ bucket: "unclean", reason: "the mapped show's date is not the date in its id, so nothing was written", detail: `${spec.showId} is on ${show.date}` });
        return;
      }
      const have = await w.get("setlists", spec.showId);
      const same = have && !have.deletedAt && canon(have.items ?? []) === canon(out.items);
      out.action = !have ? "created" : same ? "unchanged" : "updated";
      if (!have) await w.create("setlists", { items: out.items }, { id: spec.showId });
      else if (!same) {
        if (have.deletedAt) await w.restore("setlists", spec.showId);
        await w.update("setlists", spec.showId, { items: out.items });
      }
      if (have && !same && !have.deletedAt) {
        issues.push({ bucket: "overwrite", reason: "a setlist already on the show is replaced", detail: `${(have.items as unknown[] ?? []).length} item(s) -> ${out.items.length}` });
      }
    });
  }
  return report;
}

export function showSetlistsSurvey(r: ShowSetlistsReport): Survey {
  const notes: Note[] = [];
  if (!r.artist) notes.push(note("unclean", "NO ARTIST: there is nothing to import into", "", "pass --artist=<slug>"));
  for (const i of r.issues) notes.push(note(i.bucket, i.reason, "", i.detail));
  for (const t of r.tabs) for (const i of t.issues) notes.push(note(i.bucket, i.reason, `${t.tab} -> ${t.showId}`, i.detail));
  const written = r.tabs.filter((t) => t.action && t.action !== "skipped");
  return {
    title: "Show setlists",
    project: r.project, dryRun: r.dryRun, runId: r.runId,
    source: `${TABS.length} tabs of ${r.source} (captured ${r.fetchedAt})`,
    clean: tally(written.map((t) => ({ collection: "setlists", action: t.action! }))),
    notes,
    totals: {
      artist: r.artist ? `${r.artist.name} (${r.artist.slug})` : "NONE -- nothing can be imported",
      "tabs": `${r.tabs.length}, ${written.length} written, ${r.tabs.filter((t) => t.action === "skipped").length} skipped`,
      "songs placed": r.tabs.reduce((n, t) => n + t.songs, 0),
      "no song matched": r.tabs.reduce((n, t) => n + t.unmatched.length, 0),
      "songs per tab": r.tabs.map((t) => `${t.tab} ${t.songs}`).join(", "),
    },
  };
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await importShowSetlists({ dryRun: flag("dry-run"), artist: arg("artist") });
  console.log(formatSurvey(showSetlistsSurvey(r)));
  const out = arg("report");
  if (out) { writeFileSync(out, JSON.stringify({ ...r, survey: showSetlistsSurvey(r) }, null, 2) + "\n"); console.log(`Report: ${out}`); }
  if (!r.dryRun && r.tabs.some((t) => t.action && t.action !== "skipped" && t.action !== "unchanged")) console.log(`\nRun ${r.runId} -- undo it from Admin → History.`);
  if (!r.artist) throw new Error("No artist found: nothing was imported.");
}

if (process.argv[1]?.endsWith("import-show-setlists.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
