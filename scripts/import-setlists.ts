/**
 * One-time import of the band's setlists (the "Set Lists" spreadsheet: one tab per show) from the snapshot in
 * .booking-kit/setlists.json, written by scripts/snapshot-setlists.ts.
 *   tsx scripts/import-setlists.ts [--dry-run] [--yes] [--artist=<slug>] [--report=<file.json>]
 *
 * Story 19. The tab titles are NOT the mapping: they spell venues five ways, carry wrong dates, and one of them is a
 * show that is not in the app yet. The mapping below is the work product of a session with Jeff on 2026-10-24 and is
 * data, so it lives in the private map (.booking-kit/setlists-map.json, tabs) where it can be checked against the sheet by eye. A re-capture must not "fix" it back.
 *
 * A mapped tab becomes setlists/{showId}, the document id IS the show id, so a re-run updates instead of duplicating.
 * The show is found BY DATE, never by venue name (the titles disagree with the booking sheet about names, and the
 * booking sheet is what made the shows). The same date can have two shows -- two shows can share one date, each with its own tab -- so an entry may pin a `showId`; the pin is still checked against what the date
 * finds, so a pin cannot invent a show. Everything the importer cannot place is a report line, never a guess:
 *   - no show on the date, or several and no pin: nothing is written;
 *   - two tabs claiming one show: the second is not written (the twin-tab show is the one decided exception, below);
 *   - a song title no song matches: kept as an item with no songId (so the running order stays whole) AND reported.
 *
 * Unlike story 18's alphabetical ✅ columns, this IS the running order: row order is preserved.
 *
 * Tab layouts are not uniform (parseTab): a song per row in column A; a leading header row with Capo/Notes/Ingrid/Jeff
 * columns, which is kept per song rather than flattened to titles; and `twoUp`, two songs per row. Reading the
 * second of those as "title, note" silently halves a setlist, which is the failure the layout detection guards.
 *
 * Capo is not a key: `SetlistItem.key` is the song's key, and "Capo 3" says nothing about it, so a capo lands in `note`
 * ("Capo 3"). A tab with an actual Key column fills `key`.
 *
 * Fixed ids throughout (the show id for setlists; the mapped venue id and show id for the one venue and
 * show this import creates). All writes go through db.ts with via "import" and one runId (Admin → History can undo it).
 * Real Firestore needs --yes. Run `npm run import:booking` and the song-list import first: the shows and songs come
 * from them.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DocumentData } from "firebase-admin/firestore";
import type { z } from "zod";
import { run, db, type Doc, type Writer } from "../src/server/db";
import { importCtx, newRunId } from "../src/server/ctx";
import { noteOf, writeNote } from "../src/server/venues";
import type { SetlistItem } from "../src/schema/setlists";
import { formatSurvey, note, tally, type Bucket, type Note, type Survey } from "./survey";
import { cleanTitle } from "./import-song-list";
import type { SetlistsSnapshot } from "./snapshot-setlists";

type Item = z.infer<typeof SetlistItem>;

/** The spreadsheet the tabs come from, kept on the venue this import creates as where the facts came from. */
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1sRT4H6pU7uq9s-_NFMSyzotGQdmB9UAXbVEtL868GBM/edit";

interface TabSpec {
  /** The tab title exactly as the sheet spells it (checked against the snapshot: a renamed tab is reported, not skipped). */
  tab: string;
  /** The show's real date. This is what the show is found by, whatever the title says. */
  date: string;
  /** The story's show name. For the report only: the match is on date, never on this. */
  show: string;
  /** Pin one of several shows on the same date. Must be among the shows the date finds. */
  showId?: string;
  /** The layout can't be told from the grid alone; see parseTab. */
  layout?: "twoUp";
  /** A twin of another tab for the same show whose contents lost: read, counted, and set aside (the twin-tab show). */
  setAside?: { by: string; why: string };
  /** The one show this import creates, and the facts to create it with. */
  /** The one show this import creates (`"creates": true` in the map's row); loadSetlistsMap swaps in the facts. */
  creates?: Mixtape;
}

/** The show and venue the one tab-created show is made from. Fixed ids, so a re-run finds them instead of adding a second. */
interface Mixtape {
  venueId: string;
  showId: string;
  date: string;
  billing: string;
  venue: { name: string; type: "other"; region: "boulder"; address: { street: string; city: string; state: string; zip: string } };
  /** A load-in note is band-private, so it goes on the venue's notes (venueNotes), where a load-in note lives. */
  loadInNotes: string;
  times: { loadIn: string; soundcheck: string; doors: string; showStart: string };
  /** The schema has no end time or billing field; the show's first band comment is where the sheet's words about it go. */
  comment: string;
}

/** One stretch of one column: the whole column, or rows `from`..`to` inclusive, as a person counts sheet rows. */
interface Segment { col: number; from?: number; to?: number }

/**
 * What to read from a tab that holds more than one list, decided by hand on a triage page and transcribed from the
 * decisions it saved -- not re-derived here, because the grid cannot tell a running order from a pool of alternates and
 * that judgement is the whole content of the table.
 *
 * `cols` is read IN ORDER, each segment down its column, and the segments are joined end to end: that is what picking
 * A and C on a two-set tab means. `breakBetween` puts a break item at each seam, for the tabs whose columns are
 * Set 1 and Set 2. `skip: true` is a tab decided to have no single running order worth keeping.
 *
 * A row range comes from a note like "A1:27": those tabs are a setlist with gear, timings or a second draft below it,
 * and the range is where the songs stop. Without a range the whole column is read.
 */
interface Decision { tab: string; cols?: Segment[]; breakBetween?: boolean; skip?: true; note?: string }

type RawTab = Omit<TabSpec, "creates"> & { creates?: true };

/**
 * The private mapping, from .booking-kit/setlists-map.json (gitignored: it names hosts, venues and addresses, and this
 * repo is public). Four tables plus the created show:
 *   tabs      every tab that maps to a show: the tab title exactly as the sheet spells it, the show's real date, a label
 *             for the report, and optionally a pinned showId, a layout hint, a setAside, and a `note` saying why.
 *   excluded  tabs that are not setlists: read and skipped, listed in the survey so none goes missing unnoticed.
 *   decided   the hand-picked columns and row ranges per tab.
 *   aliases   tab title (lowercase) -> song title or id, for abbreviations the song list can't match on its own.
 *   mixtape   the facts of the one show the import creates (the tab row with `"creates": true`).
 */
export interface SetlistsMap {
  mixtape: Mixtape;
  tabs: TabSpec[];
  excluded: { tab: string; why: string }[];
  decided: Decision[];
  aliases: Record<string, string>;
}

const MAP_PATH = join(process.cwd(), ".booking-kit", "setlists-map.json");

/** Read the private map; a missing file is an error that names the path, never an empty mapping. */
export function loadSetlistsMap(path = MAP_PATH): SetlistsMap {
  let text: string;
  try { text = readFileSync(path, "utf8"); }
  catch (e) {
    throw new Error(`The setlists mapping is missing: ${path} (private, gitignored; restore it from the backup of .booking-kit/). ${e instanceof Error ? e.message : e}`);
  }
  const raw = JSON.parse(text) as Omit<SetlistsMap, "tabs"> & { tabs: RawTab[] };
  return { ...raw, tabs: raw.tabs.map(({ creates, ...t }) => (creates ? { ...t, creates: raw.mixtape } : t)) };
}


/** "decided": not guessed at all -- the segments Jeff picked on the triage page were read literally. */
export type Layout = "single" | "headered" | "twoUp" | "ambiguous" | "decided";

export interface Issue { bucket: Bucket; reason: string; detail?: string }

export interface TabReport {
  tab: string; date: string; show: string;
  /** The show this became the setlist of, when it became one (also the setlist's id). */
  id?: string;
  action?: "created" | "updated" | "unchanged" | "skipped" | "set aside";
  layout?: Layout;
  /** In sheet order. Unmatched titles are here too, with no songId. */
  items: Item[];
  /** Rows of the tab that held no song, a header or nothing at all. */
  songs: number; breaks: number;
  /** Titles no song matched, with their 1-based sheet row. Also kept in `items`. */
  unmatched: { row: number; title: string }[];
  issues: Issue[];
}

export interface SetlistsReport {
  project: string; dryRun: boolean; runId: string; source: string; fetchedAt: string;
  artist?: { id: string; slug: string; name: string };
  tabs: TabReport[];
  /** Every excluded tab, whether the snapshot had it, and how many non-blank rows were read and thrown away. */
  excluded: { tab: string; why: string; found: boolean; rows: number }[];
  /** Snapshot tabs that are in neither table: new since the mapping session, so nobody has decided about them. */
  unknownTabs: string[];
  /** What was done about the Mixtape venue and show. */
  mixtape?: { venue: "created" | "unchanged" | "merged"; show: "created" | "unchanged"; comment: "created" | "unchanged" };
  issues: Issue[];
}

const isBlank = (s: string | undefined) => !(s ?? "").trim();
const cellAt = (row: string[], c: number) => (row[c] ?? "").trim();
/** Lowercase, one space, straight quotes: what titles are compared on. */
/**
 * A title reduced to what two people spelling the same song would agree on: case, curly quotes, and "&" for "and"
 * ("You & Me" in a tab is "You and Me" in the song list). This is spelling, not a guess about which song was meant,
 * so it is safe to apply to every title rather than listing each pair in the alias table.
 */
const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s*&\s*/g, " and ").replace(/\s+/g, " ").trim();
const slugOf = (t: string) => `song-${t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
/** JSON with sorted keys: Firestore hands maps back in its own key order, and unchanged must mean unchanged. */
const canon = (v: unknown): string => JSON.stringify(v, (_, x) =>
  x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

const HEADER_A = /^(songs?|song title|title|set ?list)$/i;
const HEADER_X = /^(capo|notes?|key|ingrid|jeff|comments?)$/i;
/**
 * A heading that names a GROUP of songs rather than a column of facts: the mood pools ("Upbeat/faster Songs", "chill",
 * "Ballad", "Grief"), and the "Main"/"Alt" pair on Winter Walkabout. Only consulted on the first row of a column Jeff
 * picked -- inside a setlist these words would be songs, and one of them nearly is ("The Bliss" is not in here).
 */
const POOL_HEAD = /^(upbeat|faster|upbeat\/faster( songs)?|chill|ballad( ?\/ ?contemplative)?|grief|break-?up|cover|covers|main|alt|alternates|order|old sets:?|slower\/sadder|sad girl songs|slow and mellow|misc|faster\/upbeat|type|rehearse|both|attentive|loud)$/i;
/** A title that is a marker in the running order, not a song: "---- Break ----", "Set 2". */
const BREAK = /^[-–—=*\s]*(set\s*\d+|break|intermission)\b/i;
/** "Jeff Checklist": gear and to-dos pasted under a setlist. Nothing from this row down is a song. */
const CHECKLIST = /checklist\b/i;
/**
 * A packing checkbox: the gear rows under several setlists are `Martin 1/4" | TRUE`, and not all of them have a
 * "... Checklist" heading above them to cut at (East Simpson's 31 songs are followed by 20 such rows with no heading).
 * TRUE/FALSE in the second cell is what makes a row gear rather than a song, so that is what this looks for.
 */
const CHECKBOX = /^(true|false)$/i;
/**
 * A parenthetical that names who a cover is by, as the tabs write it: "(Dolly Parton)", "(The Wood Brothers)",
 * "(Unknown)". Title Case words, or the bare "Unknown" -- as against a stage direction ("stillness", "end on C",
 * "acoustic; upright", "with solo"), which is lowercase or holds a non-name word.
 */
const COVER_BY = /^(unknown|(the\s+)?([A-Z][\w.'-]*)(\s+(and|&|[A-Z][\w.'-]*))*)$/;
/** A song length or tempo, the two things an unlabelled numeric column next to a setlist turns out to hold: "3:25", "85", "85bpm". */
const DURATION = /^\d{1,3}(:\d{2})?\s*(bpm)?$/i;
/** A time of day: the load-in and doors schedule several tabs keep below the songs ("4:00 PM", "5:40 pm"). */
const CLOCK = /^\d{1,2}:\d{2}\s*(am|pm)$/i;
const colLetter = (c: number) => (c < 26 ? String.fromCharCode(65 + c) : `A${String.fromCharCode(65 + c - 26)}`);

interface Line { row: number; raw: string; kind: "song" | "break"; key?: string; note?: string }

/**
 * A title cell as the sheet writes it. A trailing "?" means "maybe" ("Friends?") and a trailing "(80)" is a number
 * nobody has told us the meaning of; both are kept in the note rather than lost, and neither stays in the title, so the
 * song can still be found.
 *
 * A whole cell of "(or <song>)" is the alternative the band might play instead of the row above it (one house-show tab,
 * row 13 is "       (or Mother)" under Long Forgotten Body). Jeff, 2026-10-25: that names the song Mother, so the
 * parentheses come off and "or" is carried in the note -- the item is that song, marked as the alternative it is.
 */
function readTitle(raw: string): { title: string; notes: string[] } {
  let t = raw.trim();
  const notes: string[] = [];
  const alt = t.match(/^\(\s*or\s+(.+?)\s*\)$/i);
  if (alt) { notes.push("or"); t = alt[1].trim(); }
  for (let i = 0; i < 2; i++) {
    const num = t.match(/\s*(\(\d+\))\s*$/);
    if (num) { notes.push(num[1]); t = t.slice(0, num.index).trim(); }
    if (/\?$/.test(t)) { notes.push("maybe"); t = t.replace(/\s*\?+$/, "").trim(); }
  }
  // A trailing parenthetical that is a direction, not part of the name: "The Ride (stillness)", "IYSWH (end on C)",
  // "Animal (acoustic; upright)". The words go in the note and the song is still found. A parenthetical that names an
  // ARTIST is left alone -- "Jolene (Dolly Parton)" is how the tabs write a cover, and those stay unlinked by Jeff's
  // decision, so stripping it would only turn a clearly-labelled cover into a title that looks like a missing original.
  const paren = t.match(/^(.+?)\s*\(([^)]+)\)$/);
  if (paren && !COVER_BY.test(paren[2])) { notes.push(paren[2].trim()); t = paren[1].trim(); }
  return { title: t, notes };
}

/**
 * A tab Jeff has decided: read the segments he picked, in the order he picked them, and nothing else.
 *
 * This is the other half of parseTab. parseTab guesses a layout and refuses anything ambiguous; once a person has said
 * which column IS the running order, there is nothing left to guess, so the grid is read literally. Everything the
 * decision does not name is left out -- and counted, so the report can say how much of the tab was passed over rather
 * than letting a column of alternates vanish without a word.
 *
 * `from`/`to` are sheet row numbers as a person reads them (1-based, inclusive), which is how Jeff wrote them ("A1:27").
 * Blank cells inside a segment are skipped, not treated as the end of it: several of these columns have gaps.
 */
export function parseDecided(values: string[][], dec: Decision): { lines: Line[]; issues: Issue[]; passedOver: number } {
  const issues: Issue[] = [];
  const lines: Line[] = [];
  const taken = new Set<string>();

  for (const [i, seg] of (dec.cols ?? []).entries()) {
    // The seam between two picked columns, where Jeff asked for one. Only BETWEEN them: a break at the very top would
    // claim the set opened with an interval. Where the column heads itself "Set 2" that row becomes the break on its
    // own (below), so none is synthesised here -- otherwise the two-set tabs, which label both columns, get two in a row.
    const headsItself = BREAK.test(cellAt(values[(seg.from ?? 1) - 1] ?? [], seg.col));
    if (dec.breakBetween && i > 0 && !headsItself) lines.push({ row: 0, raw: `Set ${i + 1}`, kind: "break" });
    const from = seg.from ?? 1;
    const to = seg.to ?? values.length;
    let found = 0;
    for (let row = from; row <= Math.min(to, values.length); row++) {
      const raw = cellAt(values[row - 1] ?? [], seg.col);
      if (isBlank(raw)) continue;
      // A column heading caught inside a picked range is not a song. Jeff's ranges start at row 1 because that is where
      // the songs look like they start; on the tabs that do have a header there ("Song", "Main", "Upbeat/faster Songs")
      // reading it literally would put the word "Song" in six setlists. Only row `from` can be one, and it is reported.
      if (row === from && (HEADER_A.test(raw) || HEADER_X.test(raw) || POOL_HEAD.test(raw))) {
        issues.push({ bucket: "deferred", reason: "the first row of a picked column is a heading, not a song", detail: `${colLetter(seg.col)}${row} "${raw}"` });
        taken.add(`${row},${seg.col}`);
        continue;
      }
      // A marker inside a picked column stays a marker, not a song (Set 1, ---- Break ----) -- except at the very top
      // of the very first column, where "Set 1" labels the column rather than announcing an interval before note one.
      if (BREAK.test(raw)) {
        const opening = i === 0 && !lines.length;
        if (opening) issues.push({ bucket: "deferred", reason: "a leading set label was read as a heading, not a break", detail: `${colLetter(seg.col)}${row} "${raw}"` });
        else lines.push({ row, raw, kind: "break" });
        taken.add(`${row},${seg.col}`);
        continue;
      }
      lines.push({ row, raw, kind: "song" });
      taken.add(`${row},${seg.col}`);
      found++;
    }
    if (!found) {
      issues.push({
        bucket: "unclean", reason: "a picked column holds no songs in the rows picked",
        detail: `${colLetter(seg.col)}${seg.from ?? ""}${seg.to ? `:${seg.to}` : ""}`,
      });
    }
  }

  // What the decision left behind, so the report can say it out loud.
  let passedOver = 0;
  values.forEach((r, i) => r.forEach((v, c) => { if (!isBlank(v) && !taken.has(`${i + 1},${c}`)) passedOver++; }));
  return { lines, issues, passedOver };
}

/**
 * One tab's grid -> the lines of a running order, before any song is looked up.
 *
 * Only a tab with exactly ONE list in it is parsed. The real tabs are messier than "a song per row in column A": songs
 * scattered across columns A, B, G, U..X, mood-grouped pools (`upbeat`, `Ballad`), `alternates`, `old sets:`, two drafts
 * of one setlist a couple of blank rows apart. None of those is a running order, and writing one as if it were is the
 * silent wrong answer this import exists to avoid. So a tab with a second column of text or a second block comes back
 * `ambiguous`, with what was found (which columns, what they were headed), and NO setlist is written for it.
 *
 * What is parsed: a leading header row (Song / Capo / Notes / Key / Ingrid / Jeff) is a header, and each column keeps its
 * meaning per song; `twoUp` is two songs per row (the story says so, so the tab is marked, not guessed); everything
 * from a "... Checklist" row down is not read (a twin-tab show has Jeff's gear list under its ten songs).
 */
export function parseTab(values: string[][], hint: { twoUp?: boolean }): { layout: Layout; lines: Line[]; issues: Issue[] } {
  const issues: Issue[] = [];
  let rows = values.map((r, i) => ({ r, row: i + 1 })).filter(({ r }) => !r.every((c) => isBlank(c)));
  // Gear, packing lists and timings pasted under a setlist. Cut at a "... Checklist" heading, or -- where there is no
  // heading -- at the first of a run of TRUE/FALSE checkbox rows, which is what East Simpson's 20 gear rows look like.
  // Only a run counts: one stray TRUE is not a packing list, and cutting a real setlist short is worse than reading a
  // row of gear. Everything after the cut is reported, never silently dropped.
  const checkboxRun = rows.findIndex(({ r }, i) =>
    CHECKBOX.test(cellAt(r, 1)) && CHECKBOX.test(cellAt(rows[i + 1]?.r ?? [], 1)) && CHECKBOX.test(cellAt(rows[i + 2]?.r ?? [], 1)));
  const heading = rows.findIndex(({ r }) => CHECKLIST.test(cellAt(r, 0)));
  const cut = heading >= 0 && checkboxRun >= 0 ? Math.min(heading, checkboxRun) : Math.max(heading, checkboxRun);
  if (cut >= 0) {
    const why = cut === heading ? "a Checklist heading" : "a run of TRUE/FALSE checkboxes: gear, not songs";
    issues.push({ bucket: "deferred", reason: `rows under ${why} were not read`, detail: `${rows.length - cut} row(s) from row ${rows[cut].row} "${cellAt(rows[cut].r, 0)}"` });
    rows = rows.slice(0, cut);
  }

  const handBack = (why: string, detail: string) => ({
    layout: "ambiguous" as Layout, lines: [] as Line[],
    issues: [...issues, { bucket: "decide" as Bucket, reason: `a tab holds more than one list, so no setlist was written: ${why}`, detail }],
  });
  // What each column holds, for Jeff: "B: 'upbeat' (9 cells)".
  const describe = (from: number) => {
    const cols = new Map<number, string[]>();
    for (const { r } of rows) r.forEach((v, c) => { if (c >= from && !isBlank(v)) cols.set(c, [...(cols.get(c) ?? []), v.trim()]); });
    return [...cols.entries()].map(([c, vs]) => `${colLetter(c)}: "${vs[0]}" (${vs.length} cell${vs.length === 1 ? "" : "s"})`).join("; ");
  };

  const first = rows[0]?.r;
  const a0 = first ? cellAt(first, 0) : "";
  const others = first ? first.slice(1).filter((c) => !isBlank(c)) : [];
  const hasHeader = !!first && (HEADER_A.test(a0) || (!a0 && others.length > 0 && others.every((c) => HEADER_X.test(c.trim()))));
  const body = hasHeader ? rows.slice(1) : rows;

  // A second block: two or more blank rows, then more. One blank row is spacing and is skipped.
  //
  // What follows the gap decides what this is. The Mixtape tab is a draft, two blank rows, then a SECOND DRAFT that
  // re-lists songs -- two running orders in one tab, and picking either would be inventing a setlist. But most gapped
  // tabs are a finished setlist followed by something that is plainly not songs: gear with TRUE/FALSE boxes, load-in
  // times ("4:00 PM"), durations, a "to rehearse" column. Dropping 23 real setlists to guard against the Mixtape case
  // costs far more than it saves, so the tail is cut when nothing in it could be a song title, and handed back when it
  // could. Either way it is reported.
  for (let i = 1; i < rows.length; i++) {
    const gap = rows[i].row - rows[i - 1].row - 1;
    if (gap < 2) continue;
    const tail = rows.slice(i);
    const songish = tail.filter(({ r }) => {
      const a = cellAt(r, 0);
      return a && !CHECKBOX.test(cellAt(r, 1)) && !DURATION.test(a) && !CLOCK.test(a) && !BREAK.test(a);
    });
    if (songish.length) {
      return handBack("a second block", `${gap} blank rows before row ${rows[i].row} "${cellAt(rows[i].r, 0) || "(column A blank)"}"`);
    }
    issues.push({
      bucket: "deferred", reason: "rows after a gap were not read: none of them is a song title",
      detail: `${tail.length} row(s) from row ${rows[i].row} "${cellAt(rows[i].r, 0) || "(column A blank)"}"`,
    });
    rows = rows.slice(0, i);
    break;
  }

  if (hasHeader) {
    const head = first!;
    const headed = new Set(head.map((v, c) => (isBlank(v) ? -1 : c)).filter((c) => c >= 0));
    // An unheaded column of plain durations is a timing column the header row never got round to labelling
    // (a twin-tab show keeps "3:25" in F under a blank header). Ten clean songs should not be handed back over
    // it, so those columns are noted and skipped. Anything else unheaded is still a second list we refuse to guess at.
    const timing = new Set<number>();
    for (const c of body.flatMap(({ r }) => r.map((_, i) => i))) {
      if (headed.has(c) || timing.has(c)) continue;
      const vs = body.map(({ r }) => cellAt(r, c)).filter((v) => !isBlank(v));
      if (vs.length && vs.every((v) => DURATION.test(v))) timing.add(c);
    }
    if (timing.size) {
      issues.push({
        bucket: "deferred", reason: "an unheaded column of times was not read",
        detail: [...timing].map((c) => `${colLetter(c)}: "${body.map(({ r }) => cellAt(r, c)).find((v) => !isBlank(v))}"`).join("; "),
      });
    }
    const stray = body.some(({ r }) => r.some((v, c) => !isBlank(v) && !headed.has(c) && !timing.has(c)));
    if (stray) return handBack("text under columns that have no header", describe(0));
    // Capo and Notes (and Key) have a home; any other column (Ingrid, Jeff) keeps its header as a label, because what it
    // means -- who sings it, who plays what -- is not ours to decide.
    const lines: Line[] = [];
    for (const { r, row } of body) {
      const parts: string[] = [];
      let key: string | undefined;
      for (let c = 1; c < r.length; c++) {
        const v = cellAt(r, c), h = cellAt(head, c);
        if (!v) continue;
        if (/^key$/i.test(h)) key = v;
        else if (/^capo$/i.test(h)) parts.push(/capo/i.test(v) ? v : `Capo ${v}`);
        else if (/^(notes?|comments?)$/i.test(h)) parts.push(v);
        else parts.push(`${h}: ${v}`);
      }
      const title = cellAt(r, 0);
      if (!title) {
        // Stage banter on a row of its own. It is part of the running order, so it stays, as a break.
        if (parts.length) lines.push({ row, raw: parts.join("; "), kind: "break" });
        continue;
      }
      lines.push({ row, raw: title, kind: BREAK.test(title) ? "break" : "song", ...(key ? { key } : {}), ...(parts.length ? { note: parts.join("; ") } : {}) });
    }
    return { layout: "headered", lines, issues };
  }

  if (hint.twoUp) {
    if (rows.some(({ r }) => r.slice(2).some((v) => !isBlank(v)))) return handBack("text beyond the two song columns", describe(2));
    // Two columns of titles, read DOWN the first and then DOWN the second (Jeff, 2026-10-25). Column A is the whole
    // first part of the set and column B carries on from its bottom -- not a row of two songs played back to back.
    // Reading across instead interleaves the set into an order the band never played, which is invisible afterwards
    // because every individual title is still right.
    const lines: Line[] = [];
    for (const c of [0, 1]) {
      for (const { r, row } of rows) {
        const t = cellAt(r, c);
        if (t) lines.push({ row, raw: t, kind: BREAK.test(t) ? "break" : "song" });
      }
    }
    return { layout: "twoUp", lines, issues };
  }

  // Headerless, so a song per row in column A -- and nothing else. Text in any other column is a second list, a pool of
  // alternates, or a note whose meaning we would be guessing.
  if (rows.some(({ r }) => r.slice(1).some((v) => !isBlank(v)))) return handBack("text beyond column A", describe(0));
  const lines: Line[] = rows.map(({ r, row }) => {
    const t = cellAt(r, 0);
    return { row, raw: t, kind: BREAK.test(t) ? "break" as const : "song" as const };
  });
  return { layout: "single", lines, issues };
}

export async function importSetlists(
  /**
   * `decided` replaces Jeff's triage decisions for one run. Only the tests pass it: they exercise parseTab's own
   * guessing on tabs that the real decisions table now answers outright, and a test that silently read the production
   * decisions would be testing the data instead of the code.
   */
  opts: { dryRun?: boolean; artist?: string; snapshot?: SetlistsSnapshot; decided?: Decision[]; map?: SetlistsMap } = {},
): Promise<SetlistsReport> {
  const snap = opts.snapshot
    ?? (JSON.parse(readFileSync(join(process.cwd(), ".booking-kit", "setlists.json"), "utf8")) as SetlistsSnapshot);
  // Loaded here, not at import time, so importing this module (the unit tests) never reads .booking-kit/. Tests pass `map`.
  const map = opts.map ?? loadSetlistsMap();
  const TABS = map.tabs, EXCLUDED = map.excluded, ALIASES = map.aliases;
  const runId = newRunId();
  const report: SetlistsReport = {
    project: process.env.GCLOUD_PROJECT ?? "", dryRun: !!opts.dryRun, runId,
    source: snap.source, fetchedAt: snap.fetchedAt, tabs: [], excluded: [], unknownTabs: [], issues: [],
  };

  const artists = await db.list("artists");
  const artist = opts.artist ? artists.find((a) => a.slug === opts.artist) : artists.length === 1 ? artists[0] : undefined;
  if (!artist) return report;
  report.artist = { id: artist.id, slug: artist.slug as string, name: artist.name as string };

  const ctx = importCtx("import-setlists", runId, artist.id);
  // One overlay for the whole dry run, so a dry run's dedupe sees its own pending writes (the shared pattern from
  // import-booking-kit.ts and import-song-list.ts).
  const overlay = new Map<string, DocumentData | null>();
  const unit = <T>(fn: (w: Writer) => Promise<T>) => run(ctx, fn, opts.dryRun ? { dryRun: true, overlay } : {});

  // ---------- the songs ----------
  // Looked up the way import-rehearsal-history.ts does it: by title after cleanTitle, then by the id the song-list import
  // fixed (song-<slug>), then through the map's aliases. These tabs are lowercase and abbreviated far past the song list, so
  // a real miss rate is expected, and a miss is reported, never dropped.
  const songs = await db.list("songs");
  const songById = new Map(songs.map((s) => [s.id, s]));
  const songByTitle = new Map(songs.map((s) => [norm(s.title as string), s]));
  const aliasIssues: Issue[] = [];
  const find = (raw: string): Doc | undefined => {
    const title = cleanTitle(raw);
    const direct = songByTitle.get(norm(title)) ?? songById.get(slugOf(title));
    if (direct) return direct;
    const target = ALIASES[norm(title)];
    return target ? songById.get(target) ?? songByTitle.get(norm(target)) : undefined;
  };
  for (const [from, to] of Object.entries(ALIASES)) {
    if (!songById.get(to) && !songByTitle.get(norm(to))) {
      aliasIssues.push({ bucket: "unclean", reason: "an alias points at a song that is not in the song list", detail: `"${from}" -> "${to}"` });
    }
  }
  report.issues.push(...aliasIssues);

  // ---------- the tabs the snapshot has ----------
  const tabsByTitle = new Map(snap.tabs.map((t) => [t.title, t]));
  const mapped = new Set(TABS.map((t) => t.tab));
  const excluded = new Set(EXCLUDED.map((e) => e.tab));
  for (const e of EXCLUDED) {
    const t = tabsByTitle.get(e.tab);
    report.excluded.push({ tab: e.tab, why: e.why, found: !!t, rows: t ? t.values.filter((r) => r.some((c) => !isBlank(c))).length : 0 });
  }
  report.unknownTabs = snap.tabs.map((t) => t.title).filter((t) => !mapped.has(t) && !excluded.has(t));

  const decidedByTab = new Map((opts.decided ?? map.decided).map((d) => [d.tab, d]));

  // The show each written tab claimed, so two tabs can never quietly overwrite one setlist.
  const claimed = new Map<string, string>();

  for (const spec of TABS) {
    const issues: Issue[] = [];
    const out: TabReport = { tab: spec.tab, date: spec.date, show: spec.show, items: [], songs: 0, breaks: 0, unmatched: [], issues };
    report.tabs.push(out);
    // Mixtape's show and venue are Jeff's facts, not the tab's: they are made even if the tab then turns out to hold two
    // drafts and gets no setlist, so the show is in the app either way.
    if (spec.creates) report.mixtape = await unit((w) => ensureMixtape(w, artist, spec.creates!, snap.fetchedAt));
    // Tabs are found by title, never by position in snapshot.tabs: the Sheets API returns tabs in the spreadsheet's order,
    // not the order they were asked for, and a title taken from the wrong index puts one show's songs on another.
    const tab = tabsByTitle.get(spec.tab);
    if (!tab) {
      out.action = "skipped";
      issues.push({ bucket: "unclean", reason: "a mapped tab is not in the snapshot -- renamed, or the snapshot is old" });
      continue;
    }

    // A tab Jeff decided on the triage page is read exactly as he said; everything else goes through parseTab, which
    // guesses the layout and refuses what it cannot tell apart.
    const decided = decidedByTab.get(spec.tab);
    if (decided?.skip) {
      out.action = "skipped";
      out.layout = "ambiguous";
      issues.push({ bucket: "deferred", reason: "Jeff decided this tab has no single running order to keep (2026-10-25)" });
      continue;
    }
    const parsed = decided
      ? { ...parseDecided(tab.values, decided), layout: "decided" as Layout }
      : parseTab(tab.values, { twoUp: spec.layout === "twoUp" });
    out.layout = parsed.layout;
    issues.push(...parsed.issues);
    if (decided) {
      const picked = (decided.cols ?? [])
        .map((s) => `${colLetter(s.col)}${s.from ?? ""}${s.to ? `:${s.to}` : ""}`).join(" + ");
      issues.push({
        bucket: "deferred", reason: "read as Jeff picked it on the triage page (2026-10-25)",
        detail: `${picked}${decided.breakBetween ? ", break between" : ""}`
          + ("passedOver" in parsed && parsed.passedOver ? `; ${parsed.passedOver} other cell(s) in the tab not read` : ""),
      });
    }
    for (const l of parsed.lines) {
      if (l.kind === "break") {
        out.items.push({ type: "break", title: l.raw.replace(/^[-\u2013\u2014=*\s]+|[-\u2013\u2014=*\s]+$/g, "") || "Break", ...(l.note ? { note: l.note } : {}) });
        out.breaks++;
        continue;
      }
      const { title, notes } = readTitle(l.raw);
      const song = find(title);
      if (!song) out.unmatched.push({ row: l.row, title: l.raw });
      const noteText = [...notes, ...(l.note ? [l.note] : [])].join("; ");
      out.items.push({
        type: "song", ...(song ? { songId: song.id } : {}), title: song ? (song.title as string) : cleanTitle(title),
        ...(l.key ? { key: l.key } : {}), ...(noteText ? { note: noteText } : {}),
      });
      out.songs++;
    }
    if (parsed.layout === "ambiguous") { out.action = "skipped"; continue; }
    for (const u of out.unmatched) {
      issues.push({ bucket: "decide", reason: "a song title matches no song, kept as an item with no songId", detail: `row ${u.row} "${u.title}"` });
    }

    if (spec.setAside) {
      out.action = "set aside";
      issues.push({ bucket: "deferred", reason: "a twin tab was set aside", detail: `${out.songs} song(s) not imported; ${spec.setAside.why}` });
      continue;
    }
    if (!out.items.length) {
      // An empty setlist on a show in the past is a claim that nothing was played.
      out.action = "skipped";
      issues.push({ bucket: "unclean", reason: "a mapped tab has no songs, so no setlist was written" });
      continue;
    }

    await unit(async (w) => {
      // The show: Mixtape's was made above; every other one is found by date.
      let showId: string;
      if (spec.creates) showId = spec.creates.showId;
      else {
        const found = (await w.query("shows", (q) => q.where("date", "==", spec.date))).filter((s) => !s.artistId || s.artistId === artist.id);
        let pick: Doc | undefined;
        if (spec.showId) {
          pick = found.find((s) => s.id === spec.showId);
          if (!pick) {
            out.action = "skipped";
            issues.push({ bucket: "unclean", reason: "no show found for a pinned show id on that date", detail: `${spec.showId} on ${spec.date}; found ${found.map((s) => s.id).join(", ") || "none"}` });
            return;
          }
        } else if (!found.length) {
          // A date with no show is a flag, not a guess: inventing the show would put a gig in the app nobody booked.
          out.action = "skipped";
          issues.push({ bucket: "unclean", reason: "no show found on that date -- import the shows first", detail: spec.date });
          return;
        } else if (found.length > 1) {
          out.action = "skipped";
          issues.push({ bucket: "unclean", reason: "several shows on that date, so which one played this set is a guess; nothing was written", detail: `${spec.date}: ${found.map((s) => s.id).join(", ")}` });
          return;
        } else pick = found[0];
        showId = pick.id;
      }
      const by = claimed.get(showId);
      if (by && by !== spec.tab) {
        out.action = "skipped";
        issues.push({ bucket: "unclean", reason: "two tabs map to the same show, so the second was not written", detail: `${spec.tab} and ${by} -> ${showId}` });
        return;
      }
      claimed.set(showId, spec.tab);

      // A show's setlist lives at setlists/{showId}: the document id is the show id.
      out.id = showId;
      const have = await w.get("setlists", showId);
      const same = have && !have.deletedAt && canon(have.items ?? []) === canon(out.items);
      out.action = !have ? "created" : same ? "unchanged" : "updated";
      if (!have) await w.create("setlists", { items: out.items }, { id: showId });
      else if (!same) {
        if (have.deletedAt) await w.restore("setlists", showId);
        await w.update("setlists", showId, { items: out.items });
      }
    });
  }

  return report;
}

/**
 * Mixtape's venue and show, at their fixed ids. Where either is already there (a re-run, or Jeff added it by hand) it
 * is left alone: this only fills a gap. The venue dedupes on matchKey, so a room already in the directory under
 * another id is merged into rather than duplicated, and the show then points at the id that survived.
 */
async function ensureMixtape(
  w: Writer, artist: Doc, m: Mixtape, fetchedAt: string,
): Promise<NonNullable<SetlistsReport["mixtape"]>> {
  let venueAction: "created" | "unchanged" | "merged" = "unchanged";
  let venueId = m.venueId;
  if (!(await w.get("venues", venueId))) {
    const r = await w.create("venues", {
      ...m.venue, sources: [{ url: SHEET_URL, checkedAt: fetchedAt, note: "Set Lists spreadsheet, Mixtape 10.23 tab; facts from Jeff, 2026-10-24" }],
    }, { id: venueId });
    venueId = r.id;
    venueAction = r.merged ? "merged" : "created";
  }
  const venue = (await w.get("venues", venueId))!;
  const { fields } = await noteOf(w, venue, artist.id);
  if (!fields.loadInNotes) await writeNote(w, venue, artist.id, { loadInNotes: m.loadInNotes });

  const have = await w.get("shows", m.showId);
  if (!have) {
    const a = m.venue.address;
    await w.create("shows", {
      date: m.date, status: "played", kind: "venue",
      venue: { id: venueId, name: String(venue.name), address: `${a.street}, ${a.city}, ${a.state} ${a.zip}`, city: a.city },
      times: m.times, artistId: artist.id,
      // Who played is not on the tab. Personnel is required, so it is empty rather than guessed.
      personnel: [], sound: { provider: "venueProvided" },
      needs: { poster: false, backline: false, merch: false }, checklists: [], docs: [], listings: {},
    }, { id: m.showId });
  }
  let comment: "created" | "unchanged" = "unchanged";
  if (!(await w.query(`shows/${m.showId}/comments`, (q) => q.limit(1), { pending: true })).length) {
    await w.create(`shows/${m.showId}/comments`, { authorId: w.ctx.uid, body: m.comment, audience: "band" });
    comment = "created";
  }
  return { venue: venueAction, show: have ? "unchanged" : "created", comment };
}

/**
 * The setlists survey. "Needs a decision" leads with the song titles nothing matched, because that is where the risk is;
 * the excluded tabs and the set-aside the twin-tab show twin go under "deferred" so that nothing looks lost later.
 */
export function setlistsSurvey(r: SetlistsReport): Survey {
  const notes: Note[] = [];
  if (!r.artist) {
    notes.push(note("unclean", "NO ARTIST: there is nothing to import into", "", "run stories 01-04 first, or pass --artist=<slug>"));
  }
  for (const i of r.issues) notes.push(note(i.bucket, i.reason, "aliases", i.detail));
  for (const t of r.tabs) {
    for (const i of t.issues) notes.push(note(i.bucket, i.reason, `${t.tab} (${t.date})`, i.detail));
    if (t.action === "updated") notes.push(note("overwrite", "a setlist already on the show would be replaced", `${t.tab} (${t.date})`, t.id));
  }
  for (const e of r.excluded) {
    notes.push(note("deferred", "a tab that is not a setlist, read and skipped", e.tab, `${e.found ? `${e.rows} row(s)` : "not in the snapshot"}: ${e.why}`));
  }
  for (const t of r.unknownTabs) {
    notes.push(note("decide", "a tab in the snapshot is in neither the mapping nor the excluded list, so it was not imported", t));
  }
  if (r.mixtape) {
    notes.push(note("deferred", "the Mixtape show was created with no personnel: the tab does not say who played", "Mixtape 10.23", "add them on the show"));
  }

  const written = r.tabs.filter((t) => t.action && t.action !== "skipped" && t.action !== "set aside");
  const clean = tally([
    ...written.map((t) => ({ collection: "setlists", action: t.action! })),
    ...(r.mixtape ? [
      { collection: "venues", action: r.mixtape.venue },
      { collection: "shows", action: r.mixtape.show },
    ] : []),
  ]);
  const placed = r.tabs.filter((t) => t.action !== "set aside").reduce((n, t) => n + t.songs, 0);
  const unmatched = r.tabs.filter((t) => t.action !== "set aside").reduce((n, t) => n + t.unmatched.length, 0);
  return {
    title: "Setlists",
    project: r.project, dryRun: r.dryRun, runId: r.runId,
    source: `${r.tabs.length} mapped tabs and ${r.excluded.length} excluded (captured ${r.fetchedAt})`,
    clean, notes,
    totals: {
      artist: r.artist ? `${r.artist.name} (${r.artist.slug})` : "NONE -- nothing can be imported",
      "tabs mapped": `${r.tabs.length}, ${written.length} written, ${r.tabs.filter((t) => t.action === "set aside").length} set aside, ${r.tabs.filter((t) => t.action === "skipped").length} skipped`,
      "tabs excluded": `${r.excluded.length}, ${r.excluded.filter((e) => e.found).length} read and skipped`,
      "songs placed": placed,
      "no song matched": unmatched,
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
  const r = await importSetlists({ dryRun: flag("dry-run"), artist: arg("artist") });
  console.log(formatSurvey(setlistsSurvey(r)));
  const out = arg("report");
  if (out) { writeFileSync(out, JSON.stringify({ ...r, survey: setlistsSurvey(r) }, null, 2) + "\n"); console.log(`Report: ${out}`); }
  if (!r.dryRun && r.tabs.length) console.log(`\nRun ${r.runId} -- undo it from Admin → History.`);
  if (!r.artist) throw new Error("No artist found: nothing was imported.");
}

if (process.argv[1]?.endsWith("import-setlists.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
