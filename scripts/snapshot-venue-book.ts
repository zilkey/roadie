/**
 * Capture the "Venue Book" tab of Ingrid's "Upcoming Shows" sheet into .booking-kit/venue-book-sheet.json (gitignored,
 * public repo: the tab carries booking contacts), so scripts/import-venue-book-sheet.ts reads one file and a re-capture
 * is reproducible.
 *   tsx scripts/snapshot-venue-book.ts --values=<payload.json> [--out=<file.json>]
 *
 * This tab is a hand-edited copy of the claude.ai Venue Book tracker that import-booking-kit.ts already imported, and
 * Ingrid keeps working in it: new rows at the top, and two columns the tracker never had. "E-mail" (column D) is her
 * pitch log ("sent 10/23", "booked", "meh gig") and "Miles from Boulder" is her distance calculation. Those two columns
 * are what the import carries; the rest is what the tracker already said.
 *
 * Columns are found by header, not position, so a column inserted in the sheet moves nothing. Every row is kept, with
 * its text exactly as a person reads it: what "10/23" without "sent" means, and whether "meh gig" is a pitch, are
 * decisions, and they live in the importer where the survey can report them. A row dropped here is invisible
 * downstream.
 *
 * Capturing needs the Sheets read, which this repo does through the Google Sheets MCP rather than a service account,
 * so the fetch is not scriptable here: the payload is
 *   spreadsheets.values.get(spreadsheetId: VENUE_BOOK_ID, range: "'Venue Book'!A1:J200")
 * saved to a file and passed as --values.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Ingrid's "Upcoming Shows" sheet; the tab is gid 9101. */
export const VENUE_BOOK_ID = "1ZugvtddW9wahThujTcQ3A34s-eFoaqXjUZixWUs5y8E";
export const VENUE_BOOK_SOURCE = `https://docs.google.com/spreadsheets/d/${VENUE_BOOK_ID}/edit?gid=9101#gid=9101`;

/** The headers as the sheet spells them (trimmed, case-insensitive) and the field each one fills. */
const COLUMNS: Record<string, keyof VenueBookRow> = {
  venue: "name", location: "city", type: "type", "e-mail": "pitchLog", "miles from boulder": "miles", status: "status",
  "booking contact": "contact", email: "contactEmail", phone: "contactPhone", "contact notes": "contactNotes",
};

/** One sheet row, each cell as text ("" when empty). `row` is the 1-based sheet row, for the survey. */
export interface VenueBookRow {
  row: number; name: string; city: string; type: string; pitchLog: string; miles: string; status: string;
  contact: string; contactEmail: string; contactPhone: string; contactNotes: string;
}
export interface VenueBookSnapshot { source: string; fetchedAt: string; rows: VenueBookRow[] }

/**
 * Rows from a `values.get` payload. The first row is the header; a header this script does not know is reported by
 * name rather than guessed at, and a known header that is missing fails the capture, since a column silently empty
 * is a column silently lost.
 */
export function rowsFromValues(values: unknown[][]): { rows: VenueBookRow[]; unknownHeaders: string[] } {
  const [header = [], ...body] = values;
  const cell = (v: unknown) => (v == null ? "" : String(v)).trim();
  const fieldAt = header.map((h) => COLUMNS[cell(h).toLowerCase()]);
  const unknownHeaders = header.map(cell).filter((h) => h && !COLUMNS[h.toLowerCase()]);
  const missing = Object.entries(COLUMNS).filter(([, f]) => !fieldAt.includes(f)).map(([h]) => h);
  if (missing.length) throw new Error(`The header row has no "${missing.join('", "')}" column; the tab's layout changed.`);
  const rows: VenueBookRow[] = [];
  body.forEach((r, i) => {
    const out: VenueBookRow = { row: i + 2, name: "", city: "", type: "", pitchLog: "", miles: "", status: "", contact: "", contactEmail: "", contactPhone: "", contactNotes: "" };
    fieldAt.forEach((f, c) => { if (f) out[f] = cell(r[c]) as never; });
    if (out.name) rows.push(out);
  });
  return { rows, unknownHeaders };
}

async function main() {
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
  const values = arg("values");
  if (!values) throw new Error("Pass --values=<payload.json>, the response of spreadsheets.values.get on 'Venue Book'!A1:J200.");
  const { readFileSync } = await import("node:fs");
  const raw = JSON.parse(readFileSync(values, "utf8")) as { values?: unknown[][] } | unknown[][];
  const grid = Array.isArray(raw) ? raw : raw.values ?? [];
  if (!grid.length) throw new Error(`${values} holds no rows.`);
  const { rows, unknownHeaders } = rowsFromValues(grid);
  if (unknownHeaders.length) console.warn(`Columns not carried: ${unknownHeaders.join(", ")}`);
  const snap: VenueBookSnapshot = { source: VENUE_BOOK_SOURCE, fetchedAt: new Date().toISOString().slice(0, 10), rows };
  const out = arg("out") ?? ".booking-kit/venue-book-sheet.json";
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(snap, null, 2) + "\n");
  console.log(`${out}: ${rows.length} rows, ${rows.filter((r) => r.pitchLog).length} with something in the E-mail column.`);
}

if (process.argv[1]?.endsWith("snapshot-venue-book.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
