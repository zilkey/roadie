/**
 * Capture every tab of the band's Set Lists sheet into .booking-kit/setlists.json (gitignored, public repo: the tabs
 * carry stage banter and host names), so scripts/import-setlists.ts reads one file and a re-capture is reproducible.
 *   tsx scripts/snapshot-setlists.ts --values=<payload.json> [--out=<file.json>] [--sheet=<spreadsheet id>]
 *
 * `--sheet` records another spreadsheet as the source: the show-setlist tabs in the song-list sheet are captured the same
 * way (scripts/import-show-setlists.ts).
 *
 * All 82 tabs go in, on purpose: `Checklist` (Jeff has a later plan for it), `Sheet57` (empty), the song lists, the
 * superseded twins, the unresolved `Mixtape 10.23`. Which tabs are setlists, which show each one belongs to, and which
 * of two Swallow Hill tabs wins are decisions made on 2026-10-24 and they live in the importer's mapping table. If
 * this script filtered, a re-capture would have to repeat that judgement, and a tab dropped here is invisible
 * downstream: the importer could never report it as "unmapped" because it would never have seen it.
 *
 * Unlike the song list this IS values-shaped. The setlist tabs carry no links worth keeping (the song list's URLs live
 * in cell formatting; these tabs are titles, capos and notes), so spreadsheets.values.batchGet is enough and the
 * grid-data merge from snapshot-song-list.ts has no counterpart here. `formattedValue` is what values.batchGet returns
 * by default, which is the text as a person reads it.
 *
 * Each tab is padded to a rectangle. Sheets trims trailing empty cells per row, so a song with no capo comes back as
 * a one-element row and a tab with a Capo column would otherwise need a bounds check on every read. Row order is
 * kept as returned: in a set list the order IS the data.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** The sheet this import reads: one tab per show, 82 tabs as of 2026-10-24. */
export const SETLISTS_ID = "1sRT4H6pU7uq9s-_NFMSyzotGQdmB9UAXbVEtL868GBM";
export const SETLISTS_SOURCE = `https://docs.google.com/spreadsheets/d/${SETLISTS_ID}/edit`;

/** One entry of a Sheets `values.batchGet` response's `valueRanges`. `values` is absent when the range is empty. */
export interface ValueRange { range: string; values?: unknown[][] }

/** One tab, its title exactly as Sheets spells it and its cells padded to a rectangle. */
export interface SetlistTab { title: string; values: string[][]; }
export interface SetlistsSnapshot { source: string; fetchedAt: string; tabs: SetlistTab[]; }

/**
 * Pad ragged rows to the width of the widest, so `values[r][c]` is always a string.
 *
 * Cells are stringified rather than trusted: batchGet with FORMATTED_VALUE already returns strings, but a payload
 * saved from another read path can hold numbers, and `String(7)` is the text a person would have seen. An empty tab
 * (`Sheet57`) has no rows at all and stays `[]`; a rectangle of zero width is not a rectangle worth keeping.
 */
export function padRect(rows: string[][]): string[][] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => Array.from({ length: width }, (_, c) => (r[c] == null ? "" : String(r[c]))));
}

/**
 * The tab title out of an A1 range. Sheets quotes a title that has anything but letters, digits and underscores, and
 * doubles any apostrophe inside it, so `'Boulder Creek Fest ''25'!A1:Z100` is the tab `Boulder Creek Fest '25`.
 * Titles here carry spaces, dots, slashes (`Jerry/Tania_House Show_6.26.26`, `Katy-House Concert_7/25/25`) and one
 * apostrophe, which is why this does not split on "!" or "/". The sheet part always ends at the LAST "!" since the
 * cell reference after it can't contain one, but a title can ("!" is legal in tab names).
 */
export function tabTitle(range: string): string {
  const bang = range.lastIndexOf("!");
  const sheet = bang === -1 ? range : range.slice(0, bang);
  return sheet.startsWith("'") && sheet.endsWith("'") && sheet.length >= 2 ? sheet.slice(1, -1).replace(/''/g, "'") : sheet;
}

/**
 * Tabs in the order the payload gave them, each titled from its OWN `range` -- never from its position in the list.
 *
 * That is not pedantry. A multi-range `spreadsheets.get` returns its sheets in the spreadsheet's tab order, NOT in the
 * order the ranges were asked for, so zipping a response against the request list silently pairs every tab with
 * another tab's songs (found 2026-10-24: ten ranges asked for, ten unrelated titles back, `Mixtape 10.23`'s songs
 * arriving under the title `Trident`). `values.batchGet` echoes each range back next to its values, which is why this
 * snapshot reads that shape and takes the title from the echo. A wrong setlist on a real show is invisible once
 * written -- it just looks like a show whose set was something else.
 *
 * A payload whose entries carry no `range` therefore cannot be trusted at all, and is refused rather than guessed at.
 */
export function tabsFromValueRanges(ranges: ValueRange[]): SetlistTab[] {
  const untitled = ranges.findIndex((r) => !r.range);
  if (untitled !== -1) {
    throw new Error(
      `valueRanges[${untitled}] has no "range", so its tab title can only be guessed from position, which pairs songs with the wrong show. `
      + `Capture with values.batchGet (it echoes each range), not a multi-range spreadsheets.get.`);
  }
  return ranges.map((r) => ({ title: tabTitle(r.range), values: padRect((r.values ?? []) as string[][]) }));
}

export function buildSnapshot(tabs: SetlistTab[], meta: { source: string; fetchedAt: string }): SetlistsSnapshot {
  return { ...meta, tabs };
}

/**
 * Capturing needs the Sheets read, which this repo does through the Google Sheets MCP rather than a service account,
 * so the fetch is not scriptable here. The transform above is the part worth having in code and under test; this entry
 * point writes a snapshot from a payload saved next to it.
 *   tsx scripts/snapshot-setlists.ts --values=<payload.json> [--out=.booking-kit/setlists.json]
 * where <payload.json> is the `valueRanges` array (or the whole object) from
 *   spreadsheets.values.batchGet(ranges: one "'<title>'!A1:Z<n>" per tab, all 82)
 */
async function main() {
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
  const values = arg("values");
  if (!values) throw new Error("Pass --values=<payload.json>, the valueRanges array from spreadsheets.values.batchGet.");
  const { readFileSync } = await import("node:fs");
  const raw: unknown = JSON.parse(readFileSync(values, "utf8"));
  const ranges: ValueRange[] = Array.isArray(raw) ? raw : (raw as { valueRanges?: ValueRange[] }).valueRanges ?? [];
  if (!ranges.length) throw new Error(`${values} holds no valueRanges.`);

  const snap = buildSnapshot(tabsFromValueRanges(ranges), {
    source: arg("sheet") ? `https://docs.google.com/spreadsheets/d/${arg("sheet")}/edit` : SETLISTS_SOURCE,
    fetchedAt: new Date().toISOString().slice(0, 10),
  });
  const out = arg("out") ?? ".booking-kit/setlists.json";
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(snap, null, 2) + "\n");
  const empty = snap.tabs.filter((t) => !t.values.length).length;
  console.log(`${out}: ${snap.tabs.length} tabs, ${snap.tabs.reduce((n, t) => n + t.values.length, 0)} rows, ${empty} empty.`);
}

if (process.argv[1]?.endsWith("snapshot-setlists.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
