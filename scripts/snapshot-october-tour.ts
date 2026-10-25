/**
 * Merge the October CO tour (the "October Tour - Scenarios" sheet, FINAL tab) into .booking-kit/venue-book.json
 * (gitignored: real venues, contacts and addresses) so scripts/import-booking-kit.ts creates those shows.
 *   tsx scripts/snapshot-october-tour.ts --values=<payload.json> [--book=.booking-kit/venue-book.json] [--year=2025] [--dry-run]
 *
 * Like snapshot-setlists.ts this script owns the transform, never the fetch: `--values` is a saved Sheets values payload
 * ({ values: string[][] }, header row first). Re-running is a no-op: a venue that already has a show on a date is left
 * alone, and no other venue is reordered or reformatted (the file is written back with 1-space indentation).
 *
 * A row is a show when it has a real Venue (not blank, `pending`, `Travel/Rest/Work Day`, `CO TOUR`) AND an Estimate.
 * A named venue without an Estimate (the 10/11 IAmMusic row) is skipped but REPORTED: it may be a show nobody priced yet.
 */
import { readFileSync, writeFileSync } from "node:fs";

export interface BookContact { name: string; email: string; phone: string; note: string }
export interface BookShow {
  date: string; dateLabel: string; event: string; notes: string; olive: string; pay: string;
  setLength: string; sound: string; time: string; where: string; who: string;
}
export interface BookVenue {
  id: string; name: string; city: string; type: string; lead: string; link: string; notes: string;
  contacts: BookContact[]; shows: BookShow[];
}
export interface Book { source?: string; pulledAt?: string; venues: BookVenue[] }

export interface TourReport {
  venuesCreated: string[];
  showsAdded: { venue: string; date: string }[];
  alreadyThere: { venue: string; date: string }[];
  skipped: { row: number; venue: string; date: string; reason: string }[];
  /** Rows that are not shows at all (blank, pending, travel days, the legend): counted, not itemised. */
  notShows: number;
}

/** The sheet's venue text -> the Venue Book id it already has. */
export const ALIASES: Record<string, string> = {
  "Motel SoCo": "motel-soco",
  "Trade and Post": "trade-post",
  "Wild Edge Brewing Collective": "wild-edge",
  "Casa Testhost": "casa-testhost",
  "House Concert - 1 County Rd, Buena Vista": "bv-andrews",
};
const RENAMED: Record<string, string> = { Alibi: "The Alibi" };
const NOT_VENUES = /^(pending|travel\/rest\/work day|co tour)$/i;
const TYPES: Record<string, string> = { brewery: "Brewery / taproom", "music venue": "Bar / club", "listening room": "Listening room" };

// Column positions in the FINAL tab.
const C = { lodging: 0, date: 2, venue: 3, location: 4, time: 5, event: 6, setLength: 8, sound: 9, contact: 10, info: 11, pay: 12, estimate: 13, note: 14 } as const;

const slug = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function contactFrom(name: string, info: string): BookContact[] {
  if (!name || /^(tbd|-)/i.test(name)) return [];
  const email = info.match(/[^\s|/,]+@[^\s|/,]+/)?.[0] ?? "";
  const rest = info.replace(email, "").replace(/^[\s|/,-]+|[\s|/,-]+$/g, "");
  const phone = /\d/.test(rest) ? rest.replace(/^[^\d(+]*/, "").trim() : "";
  return [{ name, email, phone, note: "" }];
}

export function mergeOctoberTour(book: Book, values: unknown[][], year = "2025"): TourReport {
  const report: TourReport = { venuesCreated: [], showsAdded: [], alreadyThere: [], skipped: [], notShows: 0 };
  const cell = (r: unknown[], i: number) => String(r[i] ?? "").trim();
  for (const [i, r] of values.entries()) {
    if (i === 0) continue;
    const venueText = cell(r, C.venue);
    const dm = cell(r, C.date).match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!venueText || NOT_VENUES.test(venueText) || !dm) { report.notShows++; continue; }
    const date = `${year}-${dm[1].padStart(2, "0")}-${dm[2].padStart(2, "0")}`;
    if (!cell(r, C.estimate)) { report.skipped.push({ row: i + 1, venue: venueText, date, reason: "blank Estimate" }); continue; }

    const location = cell(r, C.location), note = cell(r, C.note), eventText = cell(r, C.event);
    let venue = book.venues.find((v) => v.id === ALIASES[venueText]) ?? book.venues.find((v) => v.name.toLowerCase() === venueText.toLowerCase());
    if (!venue) {
      const type = TYPES[eventText.toLowerCase()] ?? (/house/i.test(eventText) || /house/i.test(venueText) ? "House concert" : "Other");
      venue = {
        id: slug(venueText), name: RENAMED[venueText] ?? venueText, city: `${location}, CO`, type, lead: "", link: "", notes: "",
        contacts: contactFrom(cell(r, C.contact), cell(r, C.info)), shows: [],
      };
      book.venues.push(venue);
      report.venuesCreated.push(`${venue.id} (${venue.name})`);
    }
    if (venue.shows.some((s) => s.date === date)) { report.alreadyThere.push({ venue: venue.id, date }); continue; }

    // The note column holds a street address on the Alibi row ("121 S Fir St Telluride CO 81435").
    const addr = note.match(new RegExp(`^(\\d.*?)\\s+${location}\\s+CO\\s+\\d{5}$`, "i"))?.[1];
    venue.shows.push({
      date, dateLabel: "", event: eventText,
      notes: [`Lodging: ${cell(r, C.lodging)}. October ${year} CO tour (October Tour - Scenarios, FINAL tab).`, !addr && note].filter(Boolean).join(" "),
      olive: "", pay: cell(r, C.pay), setLength: cell(r, C.setLength), sound: cell(r, C.sound), time: cell(r, C.time),
      where: addr ? `${location}, CO (${addr})` : `${location}, CO`, who: "Ingrid, Jeff",
    });
    report.showsAdded.push({ venue: venue.id, date });
  }
  return report;
}

export function formatReport(r: TourReport, dryRun = false): string {
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `\n  ${x}`).join("") : " none");
  return [
    `${dryRun ? "DRY RUN: nothing written. " : ""}October tour merge`,
    `Venues created (${r.venuesCreated.length}):${list(r.venuesCreated)}`,
    `Shows added (${r.showsAdded.length}):${list(r.showsAdded.map((s) => `${s.date} ${s.venue}`))}`,
    `Already there (${r.alreadyThere.length}):${list(r.alreadyThere.map((s) => `${s.date} ${s.venue}`))}`,
    `Skipped (${r.skipped.length}):${list(r.skipped.map((s) => `row ${s.row} ${s.date} ${s.venue}: ${s.reason}`))}`,
    `Not shows (blank / pending / travel days / legend): ${r.notShows}`,
  ].join("\n");
}

function main() {
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
  const valuesPath = arg("values");
  if (!valuesPath) throw new Error("Usage: tsx scripts/snapshot-october-tour.ts --values=<payload.json> [--book=<venue-book.json>] [--year=2025] [--dry-run]");
  const bookPath = arg("book") ?? ".booking-kit/venue-book.json";
  const dryRun = process.argv.includes("--dry-run");
  const payload = JSON.parse(readFileSync(valuesPath, "utf8")) as { values?: unknown[][] };
  if (!Array.isArray(payload.values)) throw new Error(`${valuesPath} has no "values" array`);
  const book = JSON.parse(readFileSync(bookPath, "utf8")) as Book;
  const report = mergeOctoberTour(book, payload.values, arg("year") ?? "2025");
  if (!dryRun && (report.venuesCreated.length || report.showsAdded.length)) writeFileSync(bookPath, JSON.stringify(book, null, 1) + "\n");
  console.log(formatReport(report, dryRun));
}

if (process.argv[1]?.endsWith("snapshot-october-tour.ts")) {
  try { main(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
}
