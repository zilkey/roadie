/** Venue calendars on the client (issue #60): labels, the opener-chance guess and the room's record, shared with the server's post-step. */
import type { Act, CalendarType, VenueCalendar, VenueEvent } from "@/schema";
import { dateInBandZone } from "@/lib/timezone";

export const CALENDAR_LABEL: Record<CalendarType, string> = {
  squarespace: "Squarespace events", tribe: "The Events Calendar (WordPress)", ics: "iCal feed", jsonld: "Event data on the page (JSON-LD)",
  aeg: "AEG Presents", plot: "Plot", "venue-network": "venue.network", wix: "Wix events", eventbrite: "Eventbrite",
  selectors: "Calendar page (read with selectors)", manual: "No calendar Roadie can read",
};

/** Where a person can look at the calendar themselves. */
export function calendarHref(c: VenueCalendar): string | undefined {
  switch (c.type) {
    case "tribe": return `${c.baseUrl.replace(/\/$/, "")}/events/`;
    case "aeg": return undefined;
    case "venue-network": return undefined;
    case "eventbrite": return `https://www.eventbrite.com/o/${c.organizerId}`;
    case "manual": return undefined;
    default: return c.url.replace(/\?format=json$/, "");
  }
}

// ---------- might this show need an opener? ----------

/** Fewer settled bills than this and the room's own record says nothing. */
export const MIN_BILLS = 6;
/** What a room's record says, from the share of its settled bills that had a support act. */
export type BooksOpeners = "often" | "sometimes" | "rarely" | "unknown";
export const BOOKS_OPENERS_LABEL: Record<BooksOpeners, string> = { often: "often", sometimes: "sometimes", rarely: "rarely", unknown: "not enough shows yet" };
export function booksOpeners(stats?: { supportShare?: number; billsSeen?: number } | null): BooksOpeners {
  if (!stats || stats.supportShare === undefined || (stats.billsSeen ?? 0) < MIN_BILLS) return "unknown";
  return stats.supportShare >= 0.5 ? "often" : stats.supportShare >= 0.2 ? "sometimes" : "rarely";
}

/** Tribute and theme nights, DJ nights, open mics, residencies, "an evening with", recreations: no opener wanted. */
const THEMED: [RegExp, string][] = [
  [/\btribute|\bsalute to\b|\b(?:plays|playing) (?:the )?music of\b|\bthe music of\b/i, "Looks like a tribute night"],
  [/\brecreat(?:ing|es?|ion)\b|\brevisited\b|\breprise\b/i, "Looks like a recreation of another show"],
  [/\bnite\b|\brave\b/i, "Looks like a theme night"],
  [/\bdj\b|\bopen decks\b/i, "Looks like a DJ night"],
  [/\bopen mic\b/i, "An open mic"],
  [/\bresidency\b/i, "Part of a residency"],
  [/\ban evening with\b/i, "\u201cAn evening with\u201d: usually no opener"],
];
const RUN = /\bnight [1-9]\b|\b(?:two|three|four|2|3|4)[- ](?:night|day)\b|\b(?:two|three|2|3) nights\b/i;

/** What a signal sees: the show, the room's record and the day it is (the band's zone). Later signals add to this. */
export interface OpenerCtx { stats?: { supportShare?: number; billsSeen?: number } | null; today: string; daysOut: number }
export type OpenerEvent = Pick<VenueEvent, "acts" | "bill" | "title" | "date" | "status"> & Partial<Pick<VenueEvent, "supportTba" | "nights">>;
/** One reason: points for (+) or against (−) an open opener slot. "stop" settles it (cancelled, gone, past). */
export interface OpenerSignal { points: number; reason: string; stop?: boolean }
export type OpenerChance = "likely" | "maybe" | "unlikely";

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/**
 * Each signal looks at the show alone and returns a reason or nothing. Add a signal (genre fit, the band on tour nearby) by adding
 * a function here, and its context to OpenerCtx: the score and the badge pick it up.
 */
export const OPENER_SIGNALS: ((e: OpenerEvent, c: OpenerCtx) => OpenerSignal | null)[] = [
  (e) => e.status === "cancelled" ? { points: -99, reason: "Cancelled", stop: true } : e.status === "gone" ? { points: -99, reason: "No longer on the venue\u2019s calendar", stop: true } : null,
  (_e, c) => c.daysOut < 0 ? { points: -99, reason: "Already happened", stop: true } : null,
  (e) => {
    if (e.acts.some((a) => a.role !== "headliner")) return { points: -3, reason: "Support already listed" };
    if (e.supportTba) return { points: 3, reason: "Support still to be announced" };
    return e.bill === "full"
      ? { points: 2, reason: "No support listed, and this calendar lists support acts" }
      : { points: 1, reason: e.acts.length ? "One act listed" : "No support listed" };
  },
  (_e, c) => {
    const b = booksOpeners(c.stats);
    return b === "often" ? { points: 1, reason: "The room books openers often" } : b === "rarely" ? { points: -1, reason: "The room rarely books openers" } : null;
  },
  (e) => { const t = THEMED.find(([re]) => re.test(e.title)); return t ? { points: -2, reason: t[1] } : null; },
  (e) => (e.nights ?? 1) > 1 || RUN.test(e.title) ? { points: -1, reason: "Part of a multi-night run" } : null,
  (_e, c) => c.daysOut < 14 ? { points: -3, reason: "Under 2 weeks out" } : c.daysOut >= 21 && c.daysOut <= 70 ? { points: 1, reason: "3\u201310 weeks out, a good time to ask" } : null,
];

/** A guess from the listing: likely, maybe or unlikely that the show still has room for an opener, and why. */
export function openerChance(e: OpenerEvent, stats?: OpenerCtx["stats"], today: string = dateInBandZone()): { chance: OpenerChance; score: number; reasons: string[] } {
  const ctx: OpenerCtx = { stats, today, daysOut: days(today, e.date) };
  const got: OpenerSignal[] = [];
  for (const sig of OPENER_SIGNALS) {
    const s = sig(e, ctx);
    if (!s) continue;
    if (s.stop) return { chance: "unlikely", score: s.points, reasons: [s.reason] };
    got.push(s);
  }
  const score = got.reduce((n, s) => n + s.points, 0);
  return { chance: score >= 3 ? "likely" : score >= 1 ? "maybe" : "unlikely", score, reasons: got.map((s) => s.reason) };
}

/** Is this show a themed night (for the room's record, which leaves them out)? */
export const isThemed = (title: string) => THEMED.some(([re]) => re.test(title));

/**
 * A room's own record, computed at refresh: of its settled bills, the share that had a support act. A bill is settled when the
 * calendar lists full bills, or the show is past or under 2 weeks out (Colorado rooms add the opener late). Cancelled, gone,
 * themed and act-less shows don't count.
 */
export function roomStats(events: Pick<VenueEvent, "acts" | "bill" | "title" | "date" | "status">[], today: string): { supportShare?: number; billsSeen: number } {
  const settled = events.filter((e) => e.status !== "cancelled" && e.status !== "gone" && e.acts.length > 0 && !isThemed(e.title) && (e.bill === "full" || days(today, e.date) < 14));
  const withSupport = settled.filter((e) => e.acts.some((a) => a.role !== "headliner")).length;
  return { billsSeen: settled.length, ...(settled.length ? { supportShare: Math.round((withSupport / settled.length) * 100) / 100 } : {}) };
}

// ---------- how a show reads (the venue Events tab and Booking's Venue calendars tab) ----------

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
/** "Sat, Mar 14" for a YYYY-MM-DD date (a calendar day, so no zone math). */
export const fmtEventDay = (d: string) => DAY.format(new Date(`${d}T12:00:00Z`));
/** "Sat, Feb 8, 2020" (past shows). */
export const fmtEventYear = (d: string) => `${fmtEventDay(d)}, ${d.slice(0, 4)}`;
/** "8 PM", "7:30 PM" for HH:MM; "" for none. */
export function fmtClock(t?: string) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}
/** "8 PM · doors 7 PM", either part when only one is known. */
export const eventTime = (e: { start?: string; doors?: string }) =>
  [e.start && fmtClock(e.start), e.doors && `doors ${fmtClock(e.doors)}`].filter(Boolean).join(" · ");

/** The headliners and everyone else, for "Headliner with Support, Support". */
export function billParts(acts: Act[]) {
  return { head: acts.filter((a) => a.role === "headliner").map((a) => a.name), rest: acts.filter((a) => a.role !== "headliner").map((a) => a.name) };
}

/** Show the listed title under the acts only when it says more than their names ("Album release", a tour name). */
export function titleSaysMore(e: { title: string; acts: Act[] }) {
  if (!e.acts.length) return false;
  const extra = e.acts.reduce((t, a) => t.split(a.name).join(" "), e.title).replace(/\b(?:w|with|and|plus|feat|ft|featuring|special guests?)\b/gi, " ").replace(/[^\p{L}\p{N}]+/gu, "");
  return extra.length > 2;
}

/** Soonest first: by date, then start time (a show with no time sorts first on its day). */
export const byWhen = (a: { date: string; start?: string }, b: { date: string; start?: string }) =>
  (a.date + (a.start ?? "")).localeCompare(b.date + (b.start ?? ""));

/** Still to come and still listed: today or later (the band's zone) and not dropped off the venue's calendar. */
export const isUpcoming = (e: { date: string; status?: string }, today: string) => e.date >= today && e.status !== "gone";

/**
 * Venue calendars' next read limit. The pills and region filter on the client, so a page can come up short: the live query then
 * grows, doubling (a sparse filter takes a few reads, not dozens, each one a fresh snapshot and render), until `want` shows match or
 * the calendars run out. `read` is how many shows the server returned for `limit`, or null while its answer is still coming; a
 * cache answer must count as null, since it holds only what the last, smaller read left behind and would look like the end.
 */
export function nextCalendarLimit(limit: number, read: number | null, matched: number, want: number): number {
  if (read === null || read < limit || matched >= want) return limit;
  return limit * 2;
}

/** The Venue calendars "When" filter: shows up to a month or three months from today, or any time. */
export type CalendarWhen = "1m" | "3m" | "any";
export const CALENDAR_WHEN: [CalendarWhen, string][] = [["1m", "Next month"], ["3m", "Next 3 months"], ["any", "Any time"]];
/** The last date ("YYYY-MM-DD") a "When" choice shows, or "" for any time. A month on from Jan 31 is the last day of February. */
export function whenUntil(today: string, when: CalendarWhen): string {
  if (when === "any") return "";
  const [y, m, d] = today.split("-").map(Number);
  const months = when === "1m" ? 1 : 3;
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}
