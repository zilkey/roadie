/**
 * Dates for specs. Nothing here is a fixed calendar date: a spec that writes one out ("Nov 14", "2027-03-12") fails for
 * good the day after it. Use the seed's own dates (SEED) and day(n) for anything a spec creates, and the app's own
 * formatters for the text a page shows, so the label always matches the date.
 */
import { fmtDate, fmtPitchDate } from "../../src/lib/booking";
import { fmtLong, fmtLongYear, fmtLongYearIfNot } from "../../src/lib/shows";
import { shortDate } from "../../src/lib/todos";
import { SEED_DATES, SEED_TODAY, day } from "../../scripts/seed-dates";

export { day, fmtDate, fmtPitchDate, fmtLong, fmtLongYear, shortDate };
/** The seeded shows and pitch dates that are ahead of today: see scripts/seed-dates.ts. */
export const SEED = SEED_DATES;
/** Today in the band's timezone (YYYY-MM-DD), as the seed saw it. */
export const TODAY = SEED_TODAY;
/** "Nov 14": the Shows list's date cell, a pitch's due date. */
export const mmmD = fmtDate;
/** "Sat, Nov 14", with the year when it isn't this year's ("Sat, Jan 16, 2027"): what a show page's header says. */
export const longDate = (d: string) => fmtLongYearIfNot(d, TODAY);
/** "2026-12": the calendar's ?m= for the month a date is in. */
export const monthOf = (d: string) => d.slice(0, 7);
