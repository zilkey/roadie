/**
 * One-time import of the 23 originals that the band's setlists play but the Songs tab never listed, from the snapshot in
 * .booking-kit/setlists.json (gitignored, public repo). A sibling of scripts/import-song-list.ts, which made the Songs
 * tab's 41, and scripts/import-rehearsal-history.ts.
 *   tsx scripts/import-setlist-songs.ts [--dry-run] [--yes] [--artist=<slug>] [--report=<file.json>]
 *
 * Why it exists: scripts/import-setlists.ts links a setlist item to a song only when the title finds one, so an original
 * with no song record lands as plain text with no `songId` -- "Walk With Me" is on 26 setlists and links to nothing. This
 * creates those records (SONGS below), so the next setlists run links them. Run this first, then import-setlists again.
 *
 * COVERS ARE DELIBERATELY NOT CREATED. A cover that is not already in the Songs tab keeps its setlist items as plain,
 * unlinked text. That is Jeff's explicit instruction (2026-10-25), and it is how import-setlists.ts already behaves; do
 * not "fix" it by adding the covers here. The list below is originals only, which is why `writers` is never set.
 *
 * Metadata is harvested, never invented. About twenty of the 82 tabs carry real per-song columns (`Song | Ingrid | Jeff |
 * BPM | Capo | Key | Notes`, the same with column A blank, a bare `Song | Capo | Notes`, or `Song | Min | Sec`), and a song's
 * key, tempo, length and the three custom fields are taken from them when a tab states one. A tab is read only when
 * column A of its header row is blank or "Song", because that is what ties a row to the song named in it. Tabs that look
 * like metadata but fail that test are reported under `decide` and not read. Wild Edge_10.10.25 is the clearest case: its
 * Type/Ingrid/Jeff/Key block repeats the Jamestown tab's block one row out of step with the song list (Jamestown's
 * "Take it Easy" row is Wild Edge's "Pace of Trust" row; "Witch" sits beside Type "Cover"), so reading it would hang
 * other songs' facts on these ones.
 *
 * The tabs are working documents for different gigs, so they disagree: two tabs giving a song different keys is a fact
 * about the tabs, not an invitation to pick the nicer one. A value is used only when every tab that states it agrees.
 * Otherwise the field stays unset and the disagreement goes to `decide` with both values and the tabs they came from --
 * a silently chosen key is the one failure this import must not have, because it looks exactly like data. That includes
 * "Electric" vs "Electric Guitar": no vocabulary is merged. A song with only a title is a correct outcome; it is an
 * `idea`. Never read: the Notes column (stage banter and per-gig reminders), and any tentative cell ("Acoustic?", "?",
 * "-") or misplaced one (a capo typed into an Ingrid cell), which are reported and left out.
 *
 * The custom fields are the artist's existing `songFields` definitions, looked up by label ("Ingrid Plays", "Jeff Plays",
 * "Capo") and reused; a value is written against the field id, never the label. A missing definition is created the way
 * import-song-list.ts creates one, and the report says so.
 *
 * A song that already exists is left alone and reported `unchanged`. The Songs tab's 41 are the source of truth for the
 * songs they hold; this import only fills gaps. One of the 22 already existing, with different content than this would
 * write, is surprising, so it is said out loud under `decide`. (Its own earlier output matches and is quietly unchanged,
 * which is what makes a second run a no-op.)
 *
 * Fixed ids (song-<slug(title)>), so a re-run updates instead of duplicating. All writes go through db.ts with via
 * "import" and one runId (Admin → History can undo it). Real Firestore needs --yes.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DocumentData } from "firebase-admin/firestore";
import { run, db, type Writer } from "../src/server/db";
import { importCtx, newRunId } from "../src/server/ctx";
import { slug } from "../src/schema/normalize";
import { formatSurvey, note, tally, type Bucket, type Note, type Survey } from "./survey";
import type { SetlistsSnapshot } from "./snapshot-setlists";

/**
 * The songs to create, all originals. `setlists` is how many setlist tabs name the song, measured 2026-10-25: it is
 * here so the list is justified rather than arbitrary, and nothing reads it. `aliases` are the other spellings the tabs
 * use for the same song, because the metadata tabs abbreviate and the harvest has to find a song under any of them.
 */
export interface SongSpec { title: string; setlists: number; aliases?: string[] }

export const SONGS: SongSpec[] = [
  { title: "My Kinda Love", setlists: 29 },
  { title: "Walk With Me", setlists: 26 },
  { title: "Saturn", setlists: 26 },
  { title: "Clarity", setlists: 24 },
  // Jeff, 2026-10-25: a real song, and it gets added. Two tabs write it IIAAL.
  { title: "If It's All About Love", setlists: 23, aliases: ["IIAAL"] },
  { title: "Friends", setlists: 21 },
  { title: "Over and Over", setlists: 20 },
  { title: "American Dynasty", setlists: 18, aliases: ["AmDy"] },
  { title: "Flowers", setlists: 18 },
  { title: "Jesus, Peter", setlists: 16 },
  { title: "Hungry Ghosts", setlists: 13 },
  { title: "Run On Sentence", setlists: 12, aliases: ["RunOnSentence"] },
  { title: "Cathy", setlists: 12 },
  { title: "The Fallout", setlists: 7 },
  { title: "If You're Still With Her", setlists: 6, aliases: ["IYSWH"] },
  { title: "Get Up Again", setlists: 5 },
  // Jeff, 2026-10-25: ONE song. The tabs also write it "Santa Claus" and "santa = silver fox"; all three are this song,
  // and there is no separate "Santa Claus" record.
  { title: "Santa is a Silver Fox", setlists: 2, aliases: ["Santa Claus", "santa = silver fox"] },
  { title: "Up In the Clouds", setlists: 2 },
  // Jeff, 2026-10-25: an original (the tabs also write it "Morphine"), not a cover. It had been misclassified as one, so
  // `writers` stays unset like every other song here.
  { title: "Morphine Smile", setlists: 2, aliases: ["Morphine"] },
  { title: "Witch", setlists: 1 },
  { title: "Why Do I Stay", setlists: 1 },
  { title: "For Crying Out Loud", setlists: 1 },
  // Jeff, 2026-10-25: a real song, despite reading like a note to self. Two setlists (7.11.26 and
  // 9.19.25) both play it, and before this it was reported as a stray title on an otherwise clean setlist.
  { title: "The Fart Song", setlists: 2 },
];

/** The artist's song fields this import can fill, in the order import-song-list.ts created them (so the table reads alike). */
const FIELD_LABELS = ["Ingrid Plays", "Jeff Plays", "Capo"] as const;
type FieldLabel = (typeof FIELD_LABELS)[number];

/** What a harvested value is called: the three Song columns, then the custom-field labels. */
type HarvestField = "key" | "bpm" | "lengthSec" | FieldLabel;

/** Titles are compared with case, punctuation, spaces and a parenthetical dropped: "Jesus peter", "RunOnSentence", "high road?". */
export const norm = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, "");

/** One value a tab states for a song. */
export interface Observation { field: HarvestField; value: string; tab: string; row: number }

type Role = "bpm" | "key" | "capo" | "ingrid" | "jeff" | "time" | "min" | "sec" | "blank";

/** What a header cell means. The tabs spell these a few ways ("BPM", "Capo*", "Ingrid Plays"); anything else (Notes, Type) is not read. */
function roleOf(header: string): Role | undefined {
  const h = header.trim().toLowerCase();
  if (!h) return "blank";
  if (/^(bpm|tempo)$/.test(h)) return "bpm";
  if (h === "key") return "key";
  if (/^capo\*?$/.test(h)) return "capo";
  if (/^ingrid( plays)?$/.test(h)) return "ingrid";
  if (/^jeff( plays)?$/.test(h)) return "jeff";
  if (/^(time|length|duration)$/.test(h)) return "time";
  // Mercury Cafe and Chautauqua give the length as two columns, Min and Sec, instead of 3:25.
  if (/^(min|mins|minutes)$/.test(h)) return "min";
  if (/^(sec|secs|seconds)$/.test(h)) return "sec";
  return undefined;
}

/** How many columns of a tab's header row mean something, whatever column A says: the test for "this looks like metadata". */
function recognised(row: string[]): number {
  return row.slice(1).filter((c) => { const r = roleOf(c); return r && r !== "blank"; }).length;
}

/** A header row has a blank or "Song" in column A and at least one recognised column after it. Looked for in the first rows only. */
function findHeader(values: string[][]): { row: number; roles: Map<number, Role> } | undefined {
  for (let r = 0; r < Math.min(values.length, 6); r++) {
    if (!/^(|songs?|title|set \d*)$/i.test((values[r][0] ?? "").trim())) continue;
    const roles = new Map<number, Role>();
    let real = 0;
    for (let c = 1; c < values[r].length; c++) {
      const role = roleOf(values[r][c] ?? "");
      if (!role) continue;
      roles.set(c, role);
      if (role !== "blank") real++;
    }
    // Two Min columns (or two Sec) mean two lists side by side; which pair belongs to the song in column A isn't certain.
    for (const pair of ["min", "sec"] as const) {
      const cols = [...roles].filter(([, role]) => role === pair).map(([c]) => c);
      if (cols.length > 1) for (const c of cols) { roles.delete(c); real--; }
    }
    if (real > 0) return { row: r, roles };
  }
  return undefined;
}

type Cell = { ok: string } | { tentative: string } | { unreadable: string } | undefined;

/**
 * An instrument spelled the way the band's own Songs tab spells it.
 *
 * The setlist tabs write one instrument several ways -- "Piano" and "Keys", "Electric" and "Electric Guitar",
 * "Acoustic" and "Acoustic Guitar" -- and left alone those read as 6 of the 13 disagreements this import reports,
 * burying the handful of real ones. The Songs tab settles the vocabulary rather than this importer guessing it:
 * across its 41 songs Jeff's column is "Keys" 25 times and never "Piano", and both columns use the bare "Electric"
 * and "Acoustic", never the "... Guitar" forms (measured 2026-10-25). So this is the band's existing convention,
 * applied; an instrument that is not one of those is kept exactly as written.
 */
function instrument(v: string): string {
  const base = v.trim().replace(/\s+/g, " ");
  if (/^(piano|keys|keyboard)$/i.test(base)) return "Keys";
  if (/^electric( guitar)?$/i.test(base)) return "Electric";
  if (/^acoustic( guitar)?$/i.test(base)) return "Acoustic";
  if (/^(upright|upright bass)$/i.test(base)) return "Upright Bass";
  if (/^bass( guitar)?$/i.test(base)) return "Bass";
  return base;
}

/** One cell in a recognised column, as a value in the form the song stores, or why it isn't one. */
function readCell(role: Role, raw: string): { field: HarvestField; cell: Cell } | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  switch (role) {
    case "bpm": {
      const m = /^(\d{2,3})\s*(?:bpm)?$/i.exec(v);
      return { field: "bpm", cell: m && Number(m[1]) >= 30 && Number(m[1]) <= 300 ? { ok: String(Number(m[1])) } : { unreadable: v } };
    }
    case "key":
      // "A E Bm" is a real entry (a song that changes key), so a run of chord names is accepted and kept as written.
      return { field: "key", cell: /^[A-G][#b♯♭]?(?:m|min|maj|M)?(?:\s+[A-G][#b♯♭]?(?:m|min|maj|M)?)*$/.test(v) ? { ok: v } : { unreadable: v } };
    case "capo": {
      const m = /^(?:capo\s*)?(\d{1,2})$/i.exec(v);
      return { field: "Capo", cell: m ? { ok: String(Number(m[1])) } : { unreadable: v } };
    }
    case "ingrid":
    case "jeff": {
      const field = role === "ingrid" ? "Ingrid Plays" : "Jeff Plays";
      // A capo typed into an instrument column ("Run On Sentence | Capo 6" on Jamestown Merc, "Flowers | Capo 1" on Trade
      // and Post 1) is a cell in the wrong place, not an instrument. The same tabs repeat the song on the next row with
      // the capo in its own column, so nothing is lost by not reading it.
      if (/\bcapo\b|^\d+$/i.test(v)) return { field, cell: { unreadable: v } };
      // "n/a" means that person plays no instrument on the song, as in import-song-list.ts. "-", "?" and "Acoustic?" say
      // nothing yet, so they are not evidence of anything and are not written.
      if (/^n\/a$/i.test(v)) return { field, cell: { ok: "none" } };
      if (/^[-?x]$/i.test(v) || v.endsWith("?")) return { field, cell: { tentative: v } };
      return { field, cell: { ok: instrument(v) } };
    }
    case "min":
    case "sec":
      return undefined; // a pair, read together in harvest()
    case "time":
    case "blank": {
      const m = /^(\d{1,2}):([0-5]\d)$/.exec(v);
      if (m) return { field: "lengthSec", cell: { ok: String(Number(m[1]) * 60 + Number(m[2])) } };
      // A labelled time column holding something else is worth saying; an unlabelled column holding something else is
      // just some other column (the headers on these tabs are not always filled in).
      return role === "time" ? { field: "lengthSec", cell: { unreadable: v } } : undefined;
    }
  }
}

export interface Harvest {
  /** Every value stated, by the song's title. */
  observed: Map<string, Observation[]>;
  /** Tentative or unreadable cells, which are reported and not used. */
  skipped: { title: string; tab: string; row: number; field: HarvestField; value: string; why: "tentative" | "unreadable" }[];
  /** The tabs that had a recognisable header, with the columns found in it. */
  tabs: { tab: string; headerRow: number; columns: string[]; songs: number }[];
  /** Tabs that look like they hold metadata but were not read, and why. Said out loud: these were the richest-looking tabs. */
  unread: { tab: string; reason: string; detail: string }[];
}

/** Titles and aliases to the song they name, so a tab's cell finds its song. Two songs sharing a spelling would be a bug here. */
export function titleIndex(): Map<string, string> {
  const index = new Map<string, string>();
  for (const s of SONGS) {
    for (const name of [s.title, ...(s.aliases ?? [])]) {
      const k = norm(name);
      if (index.has(k) && index.get(k) !== s.title) throw new Error(`"${name}" names both "${index.get(k)}" and "${s.title}"`);
      index.set(k, s.title);
    }
  }
  return index;
}

/** Walk every tab that has a header, and collect what its rows state about the songs above. Pure: nothing is written. */
export function harvest(snap: SetlistsSnapshot): Harvest {
  const index = titleIndex();
  const out: Harvest = { observed: new Map(), skipped: [], tabs: [], unread: [] };
  for (const tab of snap.tabs) {
    const header = findHeader(tab.values);
    if (!header) {
      // No header whose column A is blank or "Song". Two ways a tab can still be carrying metadata, both left unread because
      // which song a row describes would be a guess, and both worth a line so the choice is Jeff's:
      //   - a header with the right words but column A says something else ("Order", "Main", "Upbeat/faster Songs")
      //   - no header at all, but a m:ss duration next to one of the songs (Steve's Guitars)
      const head = tab.values.slice(0, 6).findIndex((row) => recognised(row) >= 2);
      if (head >= 0) {
        const row = tab.values[head];
        out.unread.push({
          tab: tab.title, reason: "column A of a header row is not a Song column",
          detail: `row ${head + 1} reads ${row.map((c) => `"${c}"`).join(" | ")}; which song a row in it describes is not certain, so none was read`,
        });
      } else {
        const durations = tab.values.filter((row) => index.has(norm(row[0] ?? "")) && row.slice(1).some((c) => /^\d{1,2}:[0-5]\d$/.test(c.trim())));
        if (durations.length) {
          out.unread.push({
            tab: tab.title, reason: "durations with no header row",
            detail: `${durations.length} of the songs have an m:ss cell (${durations.map((d) => `${d[0].trim()} ${d.slice(1).find((c) => /^\d{1,2}:[0-5]\d$/.test(c.trim()))}`).join(", ")}); no header names the column, so none was read`,
          });
        }
      }
      continue;
    }
    let songs = 0;
    const colOf = (role: Role) => [...header.roles].find(([, r]) => r === role)?.[0];
    const minCol = colOf("min"), secCol = colOf("sec");
    for (let r = header.row + 1; r < tab.values.length; r++) {
      const title = index.get(norm(tab.values[r][0] ?? ""));
      if (!title) continue;
      songs++;
      const see = (field: HarvestField, value: string) =>
        out.observed.set(title, [...(out.observed.get(title) ?? []), { field, value, tab: tab.title, row: r + 1 }]);
      const skip = (field: HarvestField, value: string, why: "tentative" | "unreadable") =>
        out.skipped.push({ title, tab: tab.title, row: r + 1, field, value, why });
      for (const [c, role] of header.roles) {
        const read = readCell(role, tab.values[r][c] ?? "");
        if (!read || !read.cell) continue;
        if ("ok" in read.cell) see(read.field, read.cell.ok);
        else if ("tentative" in read.cell) skip(read.field, read.cell.tentative, "tentative");
        else skip(read.field, read.cell.unreadable, "unreadable");
      }
      if (minCol !== undefined && secCol !== undefined) {
        const m = (tab.values[r][minCol] ?? "").trim(), s = (tab.values[r][secCol] ?? "").trim();
        if (m || s) {
          // Both must be whole numbers with seconds under 60: "27 | 188" (a running total typed into the row) is not a length.
          if (/^\d{1,2}$/.test(m) && /^[0-5]?\d$/.test(s)) see("lengthSec", String(Number(m) * 60 + Number(s)));
          else skip("lengthSec", `${m || "?"}:${s || "?"}`, "unreadable");
        }
      }
    }
    out.tabs.push({
      tab: tab.title, headerRow: header.row + 1, songs,
      columns: [...header.roles].map(([c, role]) => `${String.fromCharCode(65 + c)}:${role}`),
    });
  }
  return out;
}

export interface SongIssue { bucket: Bucket; reason: string; detail?: string }

export interface SetlistSongsReport {
  project: string; dryRun: boolean; runId: string; source: string; fetchedAt: string;
  artist?: { id: string; slug: string; name: string };
  /** The song fields used, and whether this run had to create each one. Only a field some song has a value for appears. */
  fields: { id: string; label: string; action: "created" | "reused" }[];
  songs: {
    title: string; songId: string; setlists: number; status: "active";
    action?: "created" | "updated" | "unchanged" | "skipped";
    key?: string; bpm?: number; lengthSec?: number;
    values: { label: string; value: string }[];
    /** Each value used, with every tab that stated it. */
    sources: { field: string; value: string; tabs: string[] }[];
    issues: SongIssue[];
  }[];
  /** Fields two tabs disagreed about. Left unset on the song. */
  conflicts: { title: string; field: string; values: { value: string; tabs: string[] }[] }[];
  /** Tabs that had a header and were read. */
  tabs: Harvest["tabs"];
  /** Tabs that look like they hold metadata and were not read. */
  unread: Harvest["unread"];
}

export async function importSetlistSongs(
  opts: { dryRun?: boolean; artist?: string; snapshot?: SetlistsSnapshot } = {},
): Promise<SetlistSongsReport> {
  const snap = opts.snapshot
    ?? (JSON.parse(readFileSync(join(process.cwd(), ".booking-kit", "setlists.json"), "utf8")) as SetlistsSnapshot);
  const runId = newRunId();
  const report: SetlistSongsReport = {
    project: process.env.GCLOUD_PROJECT ?? "", dryRun: !!opts.dryRun, runId,
    source: snap.source, fetchedAt: snap.fetchedAt, fields: [], songs: [], conflicts: [], tabs: [], unread: [],
  };

  const artists = await db.list("artists");
  const artist = opts.artist ? artists.find((a) => a.slug === opts.artist) : artists.length === 1 ? artists[0] : undefined;
  if (!artist) return report;
  report.artist = { id: artist.id, slug: artist.slug as string, name: artist.name as string };

  const ctx = importCtx("import-setlist-songs", runId, artist.id);
  // One overlay for the whole dry run, so a field this run would create is visible to the songs that use it and a dry
  // run sees its own pending writes (the shared pattern from import-song-list.ts).
  const overlay = new Map<string, DocumentData | null>();
  const unit = <T>(fn: (w: Writer) => Promise<T>) => run(ctx, fn, opts.dryRun ? { dryRun: true, overlay } : {});

  // ---------- what the tabs say ----------
  const h = harvest(snap);
  report.tabs = h.tabs;
  report.unread = h.unread;

  // A value is used only when every statement of it agrees (case aside). More than one distinct value is a conflict:
  // nothing is chosen, and the disagreement is reported with the tab each side came from.
  const resolved = new Map<string, Map<HarvestField, { value: string; tabs: string[] }>>();
  for (const s of SONGS) {
    const byField = new Map<HarvestField, Map<string, { value: string; tabs: string[] }>>();
    for (const o of h.observed.get(s.title) ?? []) {
      const values = byField.get(o.field) ?? new Map();
      const k = o.value.toLowerCase();
      const have = values.get(k);
      if (have) { if (!have.tabs.includes(o.tab)) have.tabs.push(o.tab); } else values.set(k, { value: o.value, tabs: [o.tab] });
      byField.set(o.field, values);
    }
    const ok = new Map<HarvestField, { value: string; tabs: string[] }>();
    for (const [field, values] of byField) {
      if (values.size === 1) ok.set(field, [...values.values()][0]);
      else report.conflicts.push({ title: s.title, field, values: [...values.values()] });
    }
    resolved.set(s.title, ok);
  }

  // ---------- the artist's song field definitions ----------
  // Matched by label so a run reuses what is there. Only a label some song has a value for is looked up or created: an
  // unused definition would put an empty column in the songs table.
  const existing = (artist.songFields as { id: string; label: string }[] | undefined) ?? [];
  const fieldIdFor = new Map<FieldLabel, string>();
  const toAdd: FieldLabel[] = [];
  for (const label of FIELD_LABELS) {
    if (![...resolved.values()].some((m) => m.has(label))) continue;
    const have = existing.find((x) => x.label.toLowerCase() === label.toLowerCase());
    if (have) { fieldIdFor.set(label, have.id); report.fields.push({ id: have.id, label: have.label, action: "reused" }); }
    else toAdd.push(label);
  }
  if (toAdd.length) {
    const made = await unit(async (w) => {
      const a = (await w.get("artists", artist.id))!;
      const fields = [...((a.songFields as { id: string; label: string }[] | undefined) ?? [])];
      const out: { id: string; label: string }[] = [];
      for (const label of toAdd) {
        let id = slug(label) || "field";
        while (fields.some((x) => x.id === id)) id += "-2";
        const entry = { id, label };
        fields.push(entry); out.push(entry);
      }
      await w.update("artists", artist.id, { songFields: fields });
      return out;
    });
    for (const [i, label] of toAdd.entries()) {
      fieldIdFor.set(label, made[i].id);
      report.fields.push({ id: made[i].id, label, action: "created" });
    }
  }
  report.fields.sort((a, b) => FIELD_LABELS.indexOf(a.label as FieldLabel) - FIELD_LABELS.indexOf(b.label as FieldLabel));

  // ---------- the songs ----------
  for (const s of SONGS) {
    const songId = `song-${slug(s.title)}`;
    const got = resolved.get(s.title)!;
    const issues: SongIssue[] = [];

    for (const c of report.conflicts.filter((x) => x.title === s.title)) {
      issues.push({
        bucket: "decide", reason: "tabs disagree about a value, so it is left unset",
        detail: `${c.field}: ${c.values.map((v) => `"${v.value}" (${v.tabs.join(", ")})`).join(" vs ")}`,
      });
    }
    for (const k of h.skipped.filter((x) => x.title === s.title)) {
      issues.push(k.why === "tentative"
        ? { bucket: "deferred", reason: "a tentative cell was not used", detail: `${k.field} "${k.value}" in ${k.tab} row ${k.row}` }
        : { bucket: "unclean", reason: "a cell in a metadata column could not be read", detail: `${k.field} "${k.value}" in ${k.tab} row ${k.row}` });
    }

    const key = got.get("key")?.value;
    const bpm = got.has("bpm") ? Number(got.get("bpm")!.value) : undefined;
    const lengthSec = got.has("lengthSec") ? Number(got.get("lengthSec")!.value) : undefined;
    // Every imported song is Playing: the app has no Ideas status any more.
    const status = "active" as const;
    const values = FIELD_LABELS.flatMap((label) => (got.has(label) ? [{ label, value: got.get(label)!.value, fieldId: fieldIdFor.get(label)! }] : []));

    const out: SetlistSongsReport["songs"][number] = {
      title: s.title, songId, setlists: s.setlists, status, key, bpm, lengthSec,
      values: values.map(({ label, value }) => ({ label, value })),
      sources: [...got].map(([field, v]) => ({ field, value: v.value, tabs: v.tabs })),
      issues,
    };
    report.songs.push(out);

    // No `writers`: every song here is an original. No artistId: songs are not per-artist in this schema.
    const input = {
      title: s.title, status,
      ...(key ? { key } : {}), ...(bpm !== undefined ? { bpm } : {}), ...(lengthSec !== undefined ? { lengthSec } : {}),
      fields: values.map(({ fieldId, value }) => ({ fieldId, value })),
    };

    await unit(async (w) => {
      const have = await w.get("songs", songId);
      if (!have) { out.action = "created"; await w.create("songs", input, { id: songId }); return; }
      if (have.deletedAt) {
        // A deleted song at the fixed id is restored with this content, as the sibling importers do.
        out.action = "updated";
        await w.restore("songs", songId);
        await w.update("songs", songId, input);
        return;
      }
      out.action = "unchanged";
      const same = Object.entries(input).every(([k, v]) => (k === "fields" ? JSON.stringify(have[k] ?? []) === JSON.stringify(v) : have[k] === v));
      if (!same) {
        issues.push({
          bucket: "decide", reason: "a song already exists and was left alone",
          detail: `${songId} ("${have.title as string}") is not what this import would write; the Songs tab is the source of truth for it`,
        });
      }
    });
  }
  return report;
}

/**
 * The survey. It leads with the conflicts, because those are the decisions only Jeff can make and the one thing that is
 * invisible afterwards: a key left unset looks the same as a key nobody ever wrote down.
 */
export function setlistSongsSurvey(r: SetlistSongsReport): Survey {
  const notes: Note[] = [];
  if (!r.artist) {
    notes.push(note("unclean", "NO ARTIST: the song fields live on the artist, so there is nothing to import into",
      "", "run stories 01-04 first, or pass --artist=<slug>"));
  }
  for (const s of r.songs) {
    for (const i of s.issues) notes.push(note(i.bucket, i.reason, s.title, i.detail));
    if (s.action === "updated") notes.push(note("overwrite", "a deleted song would be restored and rewritten", s.title, s.songId));
  }
  for (const f of r.fields.filter((f) => f.action === "created")) {
    notes.push(note("decide", "a song field that did not exist would be created", f.label, f.id));
  }
  for (const u of r.unread) notes.push(note("decide", `a tab that looks like it holds metadata was not read: ${u.reason}`, u.tab, u.detail));
  notes.push(note("deferred", "a column read but deliberately not imported", "Notes", "stage banter and per-gig reminders, not facts about the song"));
  notes.push(note("deferred", "covers that are not in the Songs tab are not created", "covers",
    "their setlist items stay unlinked plain text (Jeff, 2026-10-25)"));

  const had = (f: (s: SetlistSongsReport["songs"][number]) => unknown) => r.songs.filter((s) => f(s) !== undefined).length;
  return {
    title: "Setlist songs", project: r.project, dryRun: r.dryRun, runId: r.runId,
    source: `${r.songs.length} songs, harvested from ${r.tabs.length} tabs with metadata columns (captured ${r.fetchedAt})`,
    clean: tally(r.songs.filter((s) => s.action).map((s) => ({ collection: "songs", action: s.action! }))),
    notes,
    totals: {
      artist: r.artist ? `${r.artist.name} (${r.artist.slug})` : "NONE -- nothing can be imported",
      "song fields": r.fields.length ? r.fields.map((f) => `${f.label} (${f.action})`).join(", ") : "none used",
      active: r.songs.filter((s) => s.status === "active").length,
      "with a key": had((s) => s.key), "with a bpm": had((s) => s.bpm), "with a length": had((s) => s.lengthSec),
      "with a capo": r.songs.filter((s) => s.values.some((v) => v.label === "Capo")).length,
      conflicts: r.conflicts.length,
    },
  };
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await importSetlistSongs({ dryRun: flag("dry-run"), artist: arg("artist") });
  console.log(formatSurvey(setlistSongsSurvey(r)));
  const out = arg("report");
  if (out) { writeFileSync(out, JSON.stringify({ ...r, survey: setlistSongsSurvey(r) }, null, 2) + "\n"); console.log(`Report: ${out}`); }
  if (!r.dryRun && r.songs.length) console.log(`\nRun ${r.runId} -- undo it from Admin → History.`);
  if (!r.artist) throw new Error("No artist found: nothing was imported.");
}

if (process.argv[1]?.endsWith("import-setlist-songs.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
