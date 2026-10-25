/**
 * Capture the Songs tab of the band's song-list sheet into .booking-kit/song-list.json (gitignored, public repo),
 * so scripts/import-song-list.ts reads one file and a re-capture is reproducible.
 *   tsx scripts/snapshot-song-list.ts [--out=<file.json>] [--sheet=<tab>] [--id=<spreadsheetId>]
 *
 * This snapshot is NOT values-shaped like the other .booking-kit/*.json files, and it can't be: the URLs this import
 * exists to carry live in cell *formatting*, not cell values. 14 of the 41 songs link to Spotify or YouTube and nine
 * Demo cells hold two links in one cell, none of which spreadsheets.values.get can see. So we read
 * spreadsheets.get with includeGridData and keep both link shapes:
 *
 *   hyperlink        a whole-cell link ("Animal" -> the chart Doc).
 *   textFormatRuns   per-character-range formatting. Each run's format.link.uri applies from its startIndex to the
 *                    next run's (or end of text); a run with no link is plain text between two links. This is the
 *                    only place a partial or multi-link cell appears.
 *
 * A cell can have BOTH shapes, so they are merged (see mergeCellLinks) and flattened to
 * { row, col, url, text }. Read only one of the two and the import quietly loses URLs, which is the failure this
 * script is shaped around: a missing link is invisible in the result.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** The sheet this import reads. Only the Songs tab is in scope; the other eleven tabs are a separate job. */
export const SONG_LIST_ID = "1lc16Ajq-2LHH46zG1Acmc9mmm6lZH8Ac3fncxi_-Vno";
export const SONG_LIST_SOURCE = `https://docs.google.com/spreadsheets/d/${SONG_LIST_ID}/edit?gid=0#gid=0`;

/** The bits of the Sheets grid response this script reads. Everything else in the payload is dropped. */
export interface GridRun { startIndex?: number; format?: { link?: { uri?: string } } }
export interface GridCell { formattedValue?: string; hyperlink?: string; textFormatRuns?: GridRun[]; userEnteredValue?: Record<string, unknown> }
export interface GridRow { values?: GridCell[] }

/** One link found in one cell, with the text it sits under. `text` is what the link is called ("On Spotify"). */
export interface CellLink { url: string; text: string }
/** A link in the snapshot, addressed by zero-based row and column within the captured range. */
export interface SnapshotLink extends CellLink { row: number; col: number }

export interface SongListSnapshot {
  source: string;
  sheet: string;
  fetchedAt: string;
  /** formattedValue per cell, padded to a rectangle. The text of the sheet, exactly as a person reads it. */
  values: string[][];
  links: SnapshotLink[];
  /** Rows whose column A is a number: Sheets coerced a typed title to a date and `formattedValue` is truncated. */
  numericTitleRows: { row: number; formattedValue: string; numberValue: number }[];
}

/**
 * Every link in one cell, merging the whole-cell `hyperlink` with the per-run `textFormatRuns`.
 *
 * The run list is the richer shape, so it wins when both are present: a cell with a whole-cell hyperlink AND runs
 * is a cell whose runs describe the same link (plus any others), and taking `hyperlink` too would double it. We
 * dedupe on the url for that reason, keeping the first text we saw for it.
 *
 * Each run covers [startIndex, nextStartIndex), which is how "Duo On Youtube, Production Demo" yields a YouTube URL
 * titled "Duo On Youtube" and a Drive URL titled "Production Demo". A run with no `format.link` is the plain text
 * between two links (", ") and contributes nothing.
 */
export function mergeCellLinks(cell: GridCell | undefined): CellLink[] {
  if (!cell) return [];
  const text = cell.formattedValue ?? "";
  const out: CellLink[] = [];
  const seen = new Set<string>();
  const add = (url: string | undefined, label: string) => {
    const t = label.trim().replace(/^[,;&]\s*|[,;&]\s*$/g, "").trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    // A link whose own run text is empty (a link on whitespace) still deserves to survive; the importer titles it.
    out.push({ url, text: t });
  };

  const runs = cell.textFormatRuns ?? [];
  for (const [i, run] of runs.entries()) {
    const start = run.startIndex ?? 0;
    const end = runs[i + 1]?.startIndex ?? text.length;
    add(run.format?.link?.uri, text.slice(start, end));
  }
  // Only fall back to the whole-cell link when the runs produced nothing: a cell with runs has already described
  // its links, and "Animal" (hyperlink, no runs) is the shape this covers.
  if (!out.length) add(cell.hyperlink, text);
  return out;
}

/** The captured range as a rectangle of `formattedValue`, so `values[r][c]` is always a string. */
export function gridValues(rows: GridRow[]): string[][] {
  const width = Math.max(0, ...rows.map((r) => r.values?.length ?? 0));
  return rows.map((r) => Array.from({ length: width }, (_, c) => r.values?.[c]?.formattedValue ?? ""));
}

/** Every link in the grid, flattened with its address. */
export function gridLinks(rows: GridRow[]): SnapshotLink[] {
  return rows.flatMap((r, row) =>
    (r.values ?? []).flatMap((cell, col) => mergeCellLinks(cell).map((l) => ({ row, col, ...l }))));
}

/**
 * Rows whose title cell came back numeric. Row 2 of the real sheet is the known one: the song is called
 * "February 17th", Sheets read it as a date, and the cell is `numberValue: 46070` with `formattedValue` showing the
 * truncated "Feb 17". Neither the serial nor the formatted text can produce the real name, so the importer carries a
 * one-row override; this list is how a *different* row with the same coercion gets noticed instead of silently
 * importing a wrong title.
 */
export function numericTitleRows(rows: GridRow[]): SongListSnapshot["numericTitleRows"] {
  const out: SongListSnapshot["numericTitleRows"] = [];
  for (const [row, r] of rows.entries()) {
    const n = r.values?.[0]?.userEnteredValue?.numberValue;
    if (typeof n === "number") out.push({ row, formattedValue: r.values?.[0]?.formattedValue ?? "", numberValue: n });
  }
  return out;
}

export function buildSnapshot(rows: GridRow[], meta: { source: string; sheet: string; fetchedAt: string }): SongListSnapshot {
  return { ...meta, values: gridValues(rows), links: gridLinks(rows), numericTitleRows: numericTitleRows(rows) };
}

/**
 * Capturing needs the Sheets grid read, which this repo does through the Google Sheets MCP rather than a service
 * account, so the fetch is not scriptable here. The merge logic above is the part worth having in code and under
 * test; this entry point writes a snapshot from a grid payload saved next to it.
 *   tsx scripts/snapshot-song-list.ts --grid=<rowData.json> [--out=.booking-kit/song-list.json]
 * where <rowData.json> is the `sheets[0].data[0].rowData` array from
 *   spreadsheets.get(includeGridData: true, ranges: ["Songs!A1:AF41"],
 *     fields: rowData.values.{formattedValue,hyperlink,textFormatRuns,userEnteredValue})
 */
async function main() {
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
  const grid = arg("grid");
  if (!grid) throw new Error("Pass --grid=<rowData.json>, the rowData array from spreadsheets.get with includeGridData.");
  const { readFileSync } = await import("node:fs");
  const raw: unknown = JSON.parse(readFileSync(grid, "utf8"));
  const rows: GridRow[] = Array.isArray(raw) ? raw : (raw as { rowData?: GridRow[] }).rowData ?? [];
  if (!rows.length) throw new Error(`${grid} holds no rowData.`);

  const snap = buildSnapshot(rows, {
    source: arg("id") ? `https://docs.google.com/spreadsheets/d/${arg("id")}/edit` : SONG_LIST_SOURCE,
    sheet: arg("sheet") ?? "Songs",
    fetchedAt: new Date().toISOString().slice(0, 10),
  });
  const out = arg("out") ?? ".booking-kit/song-list.json";
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(snap, null, 2) + "\n");
  console.log(`${out}: ${snap.values.length} rows, ${snap.links.length} links, ${snap.numericTitleRows.length} numeric title cell(s).`);
}

if (process.argv[1]?.endsWith("snapshot-song-list.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
