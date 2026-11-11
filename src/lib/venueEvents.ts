/** Venue calendars on the client (issue #60): labels and the open-slot rule, shared with the server's post-step. */
import type { Act, CalendarType, VenueCalendar } from "@/schema";

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

/**
 * Looks like an open opener slot: the source would show a support act (it lists full bills) and this show has none, or the
 * bill names a support act still to be announced.
 */
export const openSlot = (e: { acts: Act[]; bill: string; supportTba?: boolean; status?: string }) =>
  e.status !== "cancelled" && e.status !== "gone" && (!!e.supportTba || (e.bill === "full" && e.acts.filter((a) => a.role !== "headliner").length === 0));

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
