/**
 * One-time import of the band's song list (the Songs tab: one row per song, 41 songs) as songs, their custom field
 * values, and one `files` doc per link, from the snapshot in .booking-kit/song-list.json (gitignored, public repo).
 *   tsx scripts/import-song-list.ts [--dry-run] [--yes] [--artist=<slug>] [--report=<file.json>]
 *
 * The snapshot carries cell *formatting*, not just values, because that is where the URLs live: see
 * scripts/snapshot-song-list.ts. Every link in a row becomes a files doc with `songId` -- the chart Doc from the title
 * cell, and the demos/recordings from the Demo cell, which can hold two links in one cell.
 *
 * Seven sheet columns (Ingrid, Jeff, Capo, Genre and the three MIDI patch columns) describe a song but are too small
 * and too band-specific to deserve schema columns, so they are the artist's `songFields` definitions, filled in per
 * song. The importer creates a missing definition by label and reuses an existing one, so a second run makes no
 * duplicates.
 *
 * Fixed ids (song-<slug(title)>, songfile-<songId>-<sha1(url)[0..8]>), so a re-run updates instead of duplicating.
 * All writes go through db.ts with via "import" and one runId (Admin → History can undo it). Real Firestore needs --yes.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { DocumentData } from "firebase-admin/firestore";
import { run, db, type Doc, type Writer } from "../src/server/db";
import { importCtx, newRunId } from "../src/server/ctx";
import { slug } from "../src/schema/normalize";
import { guessKind, providerFor } from "../src/lib/music";
import { formatSurvey, note, tally, type Bucket, type Note, type Survey } from "./survey";
import type { SongListSnapshot, SnapshotLink } from "./snapshot-song-list";

/**
 * The sheet's columns, by letter. The Songs tab's headers are not all unique or stable enough to look up by name
 * (column K is blank and the M..AA block is a run of dates), so the mapping is positional and stated once.
 */
const COL = { title: 0, key: 1, tempo: 2, timeSerial: 3, timeSec: 4, ingrid: 5, jeff: 6, capo: 7, original: 8, demo: 9, rehearsed: 11 } as const;
/** M..AA: the rehearsal and show columns. Out of scope for this import (story 18), reported as deferred. */
const DEFERRED_FIRST = 12, DEFERRED_LAST = 26;

/**
 * The seven columns that become the artist's song fields, in sheet order, with the labels the band should see.
 * F and G are renamed from the bare first names ("Ingrid" -> "Ingrid Plays"): the column says which *instrument*
 * that person plays on the song, which the first name alone doesn't convey. Capo loses its "*".
 */
const FIELD_COLS: { col: number; label: string }[] = [
  { col: COL.ingrid, label: "Ingrid Plays" },
  { col: COL.jeff, label: "Jeff Plays" },
  { col: COL.capo, label: "Capo" },
  { col: 28, label: "Genre" },
  { col: 29, label: "MC6 PC" },
  { col: 30, label: "H90 Bank" },
  { col: 31, label: "Iridium Bank" },
];

/**
 * Titles the sheet cannot give us, by sheet row (1-based, as a person reads the sheet).
 *
 * Row 2 is the song "February 17th". Sheets read the typed title as a date, so the cell is a number
 * (userEnteredValue.numberValue 46070) and formattedValue shows only the truncated display text "Feb 17". Neither the
 * serial nor the formatted text can produce the real name, and expanding "Feb 17" in code would be guessing at a
 * title ("February 17", "February 17, 2026"), so the one row the sheet can't tell us is written down here.
 */
const TITLE_OVERRIDE: Record<number, string> = { 2: "February 17th" };

/**
 * "n/a" in the two "<person> Plays" columns means that person plays no instrument on the song -- Ingrid is still on
 * it, singing, with her hands free. She is not absent from it. "none" says that; "n/a" reads like missing data and
 * would invite someone to "fix" it later. "?" is left as "?": undecided is not the same as playing nothing.
 */
const fieldValue = (raw: string) => (raw.trim().toLowerCase() === "n/a" ? "none" : raw.trim());

/** `(cover)` is carried by the Original column, and `(chart)` is a note about the link, not part of the name. */
export const cleanTitle = (s: string) => s.replace(/\s*\((?:cover|chart)\)\s*$/i, "").trim();

/** A link's own id, so a re-run over the same snapshot updates the same doc instead of adding a second one. */
const fileId = (songId: string, url: string) => `songfile-${songId}-${createHash("sha1").update(url).digest("hex").slice(0, 8)}`;

/**
 * What to call a link, and what kind of file it is, from the text it sits under in the cell.
 *
 * A Spotify or YouTube link defaults to "recording" rather than "demo": it is a released version, which is the thing
 * the band actually opens most. The "Radio Show 56:14" timestamp is dropped from the title but the link is kept.
 */
export function linkFile(l: SnapshotLink, songTitle: string, isTitleCell: boolean) {
  const provider = providerFor(l.url);
  const released = provider === "spotify" || provider === "youtube";
  const text = l.text.replace(/\s+\d+:\d{2}\s*$/, "").trim();
  const title = isTitleCell ? `${songTitle} chart` : text || `${songTitle} ${released ? "recording" : "demo"}`;
  // guessKind already defaults a Spotify/YouTube link to "recording" when nothing in the text says otherwise, so the
  // provider is handed to it rather than second-guessed here.
  const kind = isTitleCell ? "chart" : guessKind(text, undefined, provider);
  return { provider, title, kind, url: l.url };
}

export interface SongListReport {
  project: string; dryRun: boolean; runId: string; source: string; sheet: string; fetchedAt: string;
  artist?: { id: string; slug: string; name: string };
  /** The artist's song fields after the run, in order, and whether this run had to create each one. */
  fields: { id: string; label: string; action: "created" | "reused" }[];
  rows: {
    row: number; title: string; songId: string; status: "active" | "idea";
    action?: "created" | "updated" | "unchanged" | "skipped";
    writers?: string; key?: string; bpm?: number; lengthSec?: number;
    values: { label: string; value: string }[];
    files: { id: string; kind: string; title: string; provider: string; url: string; action: "created" | "updated" | "unchanged" }[];
    issues: string[];
  }[];
  /** The M..AA columns this import knowingly doesn't carry, with the ✅ count story 18 checks itself against. */
  deferredColumns: { col: string; header: string; ticks: number }[];
  /** Column L: a counta() formula over M..AA, so it is derived from data story 18 will hold properly. */
  droppedColumns: { col: string; header: string; why: string }[];
  /** The cells that hold more than one link -- the case the hyperlink/textFormatRuns merge exists for. */
  multiLinkCells: { row: number; col: string; text: string; links: number }[];
}

export async function importSongList(opts: { dryRun?: boolean; artist?: string; snapshot?: SongListSnapshot } = {}): Promise<SongListReport> {
  const snap = opts.snapshot
    ?? (JSON.parse(readFileSync(join(process.cwd(), ".booking-kit", "song-list.json"), "utf8")) as SongListSnapshot);
  const runId = newRunId();
  const report: SongListReport = {
    project: process.env.GCLOUD_PROJECT ?? "", dryRun: !!opts.dryRun, runId,
    source: snap.source, sheet: snap.sheet, fetchedAt: snap.fetchedAt,
    fields: [], rows: [], deferredColumns: [], droppedColumns: [], multiLinkCells: [],
  };

  const artists = await db.list("artists");
  const artist = opts.artist ? artists.find((a) => a.slug === opts.artist) : artists.length === 1 ? artists[0] : undefined;
  if (!artist) {
    // The field definitions live on the artist, so there is nothing to import into without one. Say so once rather
    // than reporting 41 identical row failures.
    report.rows = [];
    return report;
  }
  report.artist = { id: artist.id, slug: artist.slug as string, name: artist.name as string };
  const ctx = importCtx("import-song-list", runId, artist.id);
  // One overlay for the whole dry run, so the song fields this run would create are visible to the rows that use
  // them and a dry run's dedupe sees its own pending writes (the shared pattern from import-booking-kit.ts).
  const overlay = new Map<string, DocumentData | null>();
  const unit = <T>(fn: (w: Writer) => Promise<T>) => run(ctx, fn, opts.dryRun ? { dryRun: true, overlay } : {});

  const header = snap.values[0] ?? [];
  const colLetter = (c: number) => (c < 26 ? String.fromCharCode(65 + c) : `A${String.fromCharCode(65 + c - 26)}`);

  // ---------- the artist's song field definitions ----------
  // Matched by label so a second run reuses what is already there; created in sheet order so the songs table shows
  // the columns in the order the band reads them in the sheet.
  const existing = (artist.songFields as { id: string; label: string }[] | undefined) ?? [];
  const fieldIdFor = new Map<number, string>();
  const toAdd: { col: number; label: string }[] = [];
  for (const f of FIELD_COLS) {
    const have = existing.find((x) => x.label.toLowerCase() === f.label.toLowerCase());
    if (have) { fieldIdFor.set(f.col, have.id); report.fields.push({ id: have.id, label: have.label, action: "reused" }); }
    else toAdd.push(f);
  }
  if (toAdd.length) {
    const made = await unit(async (w) => {
      const a = (await w.get("artists", artist.id))!;
      const fields = [...(((a.songFields as { id: string; label: string }[] | undefined) ?? []))];
      const out: { id: string; label: string }[] = [];
      for (const f of toAdd) {
        // slug(label) as the id keeps it readable in the song docs and stable across runs.
        let id = slug(f.label) || "field";
        while (fields.some((x) => x.id === id)) id += "-2";
        const entry = { id, label: f.label };
        fields.push(entry); out.push(entry);
      }
      await w.update("artists", artist.id, { songFields: fields });
      return out;
    });
    for (const [i, f] of toAdd.entries()) {
      fieldIdFor.set(f.col, made[i].id);
      report.fields.push({ id: made[i].id, label: f.label, action: "created" });
    }
  }
  // Report the definitions in sheet order, which is the order they were created in.
  report.fields.sort((a, b) => FIELD_COLS.findIndex((f) => f.label === a.label) - FIELD_COLS.findIndex((f) => f.label === b.label));

  // ---------- the deferred and dropped columns ----------
  // M..AA are rehearsals and shows, one column each, with ✅ marks for the songs played. Real data with real homes in
  // the schema, but out of scope here: reported with per-column counts so story 18 has something to check itself
  // against, and so nothing looks lost later.
  for (let c = DEFERRED_FIRST; c <= DEFERRED_LAST; c++) {
    const head = (header[c] ?? "").trim();
    if (!head) continue;
    const ticks = snap.values.slice(1).filter((r) => (r[c] ?? "").trim()).length;
    report.deferredColumns.push({ col: colLetter(c), header: head, ticks });
  }
  report.droppedColumns.push({
    col: colLetter(COL.rehearsed), header: (header[COL.rehearsed] ?? "Rehearsed").trim(),
    why: "a counta() over M..AA, so it is derived from the rehearsal and show data story 18 will hold properly",
  });

  // ---------- the songs ----------
  const links = new Map<string, SnapshotLink[]>();
  for (const l of snap.links) links.set(`${l.row},${l.col}`, [...(links.get(`${l.row},${l.col}`) ?? []), l]);
  const cell = (r: number, c: number) => (snap.values[r]?.[c] ?? "").trim();
  for (const [k, ls] of links) {
    if (ls.length < 2) continue;
    const [lr, lc] = k.split(",").map(Number);
    report.multiLinkCells.push({ row: lr + 1, col: colLetter(lc), text: cell(lr, lc), links: ls.length });
  }
  report.multiLinkCells.sort((a, b) => a.row - b.row);
  const usedSongIds = new Set<string>();

  for (let r = 1; r < snap.values.length; r++) {
    const sheetRow = r + 1;
    const rawTitle = cell(r, COL.title);
    // Never skip a row that has anything in column A: a cell Sheets has coerced to a number is still a song.
    if (!rawTitle && !TITLE_OVERRIDE[sheetRow]) continue;

    const numeric = snap.numericTitleRows.find((x) => x.row === r);
    const override = TITLE_OVERRIDE[sheetRow];
    const title = override ?? cleanTitle(rawTitle);
    const issues: string[] = [];
    if (numeric && override) {
      issues.push(`the title cell is a date serial (${numeric.numberValue}, shown as "${numeric.formattedValue}"); the title comes from the importer's override`);
    } else if (numeric) {
      // The same coercion may have eaten a different name, so this is a flag, not a skip.
      issues.push(`the title cell is a number (${numeric.numberValue}); imported as "${numeric.formattedValue}" from the formatted text -- confirm the real title`);
    }

    const key = cell(r, COL.key) || undefined;
    const bpmRaw = cell(r, COL.tempo);
    const bpm = bpmRaw ? Number(bpmRaw) : undefined;
    const lenRaw = cell(r, COL.timeSec);
    const lengthSec = lenRaw ? Number(lenRaw) : undefined;
    // Column E is already seconds; column D is a fraction-of-a-day serial and is deliberately not used.
    if (lenRaw && !Number.isFinite(lengthSec)) issues.push(`column E Time (s) is "${lenRaw}", which is not a number`);
    if (bpmRaw && !Number.isFinite(bpm)) issues.push(`column C Tempo is "${bpmRaw}", which is not a number`);
    // A song is an idea only when the row is title-only: nothing but the name (and the Original flag).
    //
    // Story 27 words this as "active when the row has a key and a tempo", but then names the nine rows that should
    // land as ideas -- and those nine are exactly the title-only rows. Four songs (Great Migration, I Gotta Stop,
    // Mother, What a Time to Live) have a key and no tempo, and they are played songs with charts, demos and ✅ marks
    // on rehearsal columns, so a key-and-tempo rule would file four real songs as ideas. The named list is the
    // intent, so "title-only" is the test and a key, tempo or length is enough to make a song active.
    const titleOnly = !key && !bpmRaw && !lenRaw;
    const status: "active" | "idea" = titleOnly ? "idea" : "active";
    // The Song schema has no boolean for "is this ours", and `writers` is the nearest honest field.
    const original = cell(r, COL.original).toUpperCase();
    const writers = original === "FALSE" ? "cover" : undefined;

    let songId = `song-${slug(title) || `row-${sheetRow}`}`;
    if (usedSongIds.has(songId)) { issues.push(`two rows slug to ${songId}; this row is imported as ${songId}-2`); songId += "-2"; }
    usedSongIds.add(songId);

    const values = FIELD_COLS.flatMap((f) => {
      const v = fieldValue(cell(r, f.col));
      return v ? [{ label: f.label, value: v, fieldId: fieldIdFor.get(f.col)! }] : [];
    });

    const titleLinks = links.get(`${r},${COL.title}`) ?? [];
    const demoLinks = links.get(`${r},${COL.demo}`) ?? [];
    if (!demoLinks.length && cell(r, COL.demo)) {
      // The link merge is the fragile part of this import and a lost URL is silent, so a Demo cell with text but no
      // link is said out loud rather than passed over.
      issues.push(`the Demo cell says "${cell(r, COL.demo)}" but carries no link`);
    }
    // The title cell normally holds one link, the chart Doc. "Ruined (chart)" holds two: the chart on "Ruined" and a
    // Drive audio file under part of the "(chart)" marker. Keep both -- the extra is a real recording, and dropping a
    // link the band put there is the one thing this import must not do -- and flag it, since only the first is a chart.
    const extraTitleLinks = titleLinks.slice(1);
    for (const l of extraTitleLinks) issues.push(`the title cell carries a second link ("${l.text}" -> ${l.url}); imported as a file, confirm its kind`);

    const want = [
      ...titleLinks.slice(0, 1).map((l) => linkFile(l, title, true)),
      ...extraTitleLinks.map((l) => linkFile(l, title, false)),
      ...demoLinks.map((l) => linkFile(l, title, false)),
    ];

    const out: SongListReport["rows"][number] = {
      row: sheetRow, title, songId, status, writers, key,
      bpm: Number.isFinite(bpm) ? bpm : undefined, lengthSec: Number.isFinite(lengthSec) ? lengthSec : undefined,
      values: values.map(({ label, value }) => ({ label, value })), files: [], issues,
    };
    report.rows.push(out);

    // No artistId: songs are not per-artist in this schema (seed.ts creates them the same way), so adding one here
    // would be inventing a field the Song schema doesn't have.
    const input = {
      title, status,
      ...(writers ? { writers } : {}), ...(key ? { key } : {}),
      ...(Number.isFinite(bpm) ? { bpm } : {}), ...(Number.isFinite(lengthSec) ? { lengthSec } : {}),
      fields: values.map(({ fieldId, value }) => ({ fieldId, value })),
    };

    await unit(async (w) => {
      const have = await w.get("songs", songId);
      // The fixed id makes a re-run update its own song instead of adding a second one, but it would just as happily
      // overwrite a song that someone else created at the same slug. A doc already there with a DIFFERENT title is
      // that case, so it is reported and left alone rather than quietly rewritten.
      if (have && !have.deletedAt && have.title !== title) {
        out.action = "skipped";
        out.issues.push(`a different song is already at ${songId} ("${have.title as string}"); left alone -- rename one of them, or give this row its own id`);
        return;
      }
      const sameSong = have && !have.deletedAt
        && Object.entries(input).every(([k, v]) => (k === "fields" ? JSON.stringify(have[k] ?? []) === JSON.stringify(v) : have[k] === v));
      out.action = !have ? "created" : sameSong ? "unchanged" : "updated";
      if (!have) await w.create("songs", input, { id: songId });
      else if (!sameSong) {
        if (have.deletedAt) await w.restore("songs", songId);
        await w.update("songs", songId, input);
      }

      for (const f of want) {
        const id = fileId(songId, f.url);
        const doc = {
          songId, kind: f.kind, title: f.title, url: f.url, provider: f.provider,
          // ownerEmail, inBandFolder and sharing only mean something for a Drive file and are left unset otherwise:
          // the Music tab's sharing warnings would be lying about a Spotify link.
          ...(f.provider === "drive" ? { driveFileId: driveIdFrom(f.url) } : {}),
          checkedAt: new Date(),
        };
        const haveFile = await w.get("files", id);
        const sameFile = haveFile && !haveFile.deletedAt
          && (["songId", "kind", "title", "url", "provider"] as const).every((k) => haveFile[k] === doc[k]);
        out.files.push({ id, kind: f.kind, title: f.title, provider: f.provider, url: f.url, action: !haveFile ? "created" : sameFile ? "unchanged" : "updated" });
        if (!haveFile) await w.create("files", doc, { id });
        else if (!sameFile) {
          if (haveFile.deletedAt) await w.restore("files", id);
          await w.update("files", id, doc);
        }
      }
    });
  }
  return report;
}

/** A Drive or Docs url's file id, so a Drive link is still a Drive file the sharing checks can work on. */
export function driveIdFrom(url: string): string | undefined {
  return /\/d\/([a-zA-Z0-9_-]+)/.exec(url)?.[1];
}

/**
 * The song-list survey. It leads with the custom fields it would create and the ✅ counts for the deferred columns,
 * because those are the two things that can't be checked after the fact: a field created with the wrong label gets
 * values hung off it, and the M..AA counts are what story 18 will check itself against.
 */
export function songListSurvey(r: SongListReport): Survey {
  const notes: Note[] = [];
  if (!r.artist) {
    notes.push(note("unclean", "NO ARTIST: the song fields live on the artist, so there is nothing to import into",
      "", "run stories 01-04 first, or pass --artist=<slug>"));
  }
  for (const x of r.rows) {
    const where = `row ${x.row} ${x.title}`;
    for (const issue of x.issues) {
      // Anything that loses or guesses at data is Jeff's to decide; a value the sheet got wrong is unclean. The
      // date-serial override for row 2 is the one known, intended outcome, so it is the only thing left deferred.
      const bucket: Bucket = /is already at|carries no link|is a number|confirm/.test(issue) ? "decide"
        : /not a number|slug to/.test(issue) ? "unclean"
        : "deferred";
      // The row-specific parts (the title, the urls, the numbers) would otherwise split one problem into one group
      // per row, so they live in the detail and the reason stays general.
      const reason = issue
        .replace(/"[^"]*"/g, "a value")
        .replace(/\bhttps?:\/\/\S+/g, "a url")
        .replace(/\b\d+\b/g, "N")
        .replace(/ -> a url\)/, ")")
        .trim();
      notes.push(note(bucket, reason, where, issue));
    }
    if (x.action === "updated") notes.push(note("overwrite", "a song already there would be updated", where, x.songId));
    for (const f of x.files.filter((f) => f.action === "updated")) {
      notes.push(note("overwrite", "a file already there would be updated", where, `${f.kind} ${f.title}`));
    }
  }
  for (const c of r.droppedColumns) {
    notes.push(note("deferred", "a column read but deliberately not imported", `column ${c.col} ${c.header}`, c.why));
  }
  for (const c of r.deferredColumns) {
    notes.push(note("deferred", "a rehearsal or show column left for story 18, with its tick count",
      `column ${c.col} ${c.header}`, `${c.ticks} song(s) marked`));
  }

  const files = r.rows.flatMap((x) => x.files);
  const byProvider = (p: string) => files.filter((f) => f.provider === p).length;
  return {
    title: "Song list", project: r.project, dryRun: r.dryRun, runId: r.runId,
    source: `${r.rows.length} songs and ${files.length} links from the ${r.sheet} tab (captured ${r.fetchedAt})`,
    clean: tally([
      ...r.rows.filter((x) => x.action).map((x) => ({ collection: "songs", action: x.action! })),
      ...files.map((f) => ({ collection: "files", action: f.action })),
    ]),
    notes,
    totals: {
      artist: r.artist ? `${r.artist.name} (${r.artist.slug})` : "NONE -- nothing can be imported",
      "song fields": r.fields.length
        ? r.fields.map((f) => `${f.label}${f.action === "reused" ? " (reused)" : ""}`).join(", ")
        : "none",
      active: r.rows.filter((x) => x.status === "active").length,
      ideas: r.rows.filter((x) => x.status === "idea").length,
      covers: r.rows.filter((x) => x.writers === "cover").length,
      "links by provider": ["drive", "spotify", "youtube", "web"].map((p) => `${p} ${byProvider(p)}`).join(", "),
      "songs with a link that isn't Drive": r.rows.filter((x) => x.files.some((f) => f.provider !== "drive")).length,
      // The multi-link cells, not the multi-file songs: a song with a chart and one demo has two files from two
      // separate cells, which is ordinary. Two links in ONE cell is the fragile case the merge exists for.
      "cells holding two links": r.multiLinkCells.length,
      "songs with a chart": r.rows.filter((x) => x.files.some((f) => f.kind === "chart")).length,
    },
  };
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await importSongList({ dryRun: flag("dry-run"), artist: arg("artist") });
  console.log(formatSurvey(songListSurvey(r)));
  const out = arg("report");
  if (out) { writeFileSync(out, JSON.stringify({ ...r, survey: songListSurvey(r) }, null, 2) + "\n"); console.log(`Report: ${out}`); }
  if (!r.dryRun && r.rows.length) console.log(`\nRun ${r.runId} -- undo it from Admin → History.`);
  // No artist means every row was skipped and nothing was imported: a failed run, not a quiet success.
  if (!r.artist) throw new Error("No artist found: the song fields live on the artist, so nothing was imported.");
}

if (process.argv[1]?.endsWith("import-song-list.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
