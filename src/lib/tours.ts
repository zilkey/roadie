/**
 * Tours (#11), pure: where an entry goes in its day, the days of a tour, and the warnings. Used by the tours commands
 * (src/server/commands/tours.ts) and, later, the tour pages. Nothing here is stored: days and warnings are worked out
 * every time from the tour and its entries.
 */
import { addDays } from "./shows";

export interface EntryLike {
  id: string; kind: "show" | "option" | "drive" | "stay" | "note"; date?: string; position: number; visibility?: string;
  showId?: string; pitchId?: string; leaveBy?: string; roundTrip?: boolean; minutes?: number; miles?: number;
  name?: string; nights?: number; text?: string; to?: { name?: string; address: string }; deletedAt?: unknown;
}
export interface TourLike { startDate?: string; endDate?: string }
/** What a warning needs to know about a show on the tour. */
export interface ShowFacts { date: string; name: string; loadIn?: string }

/** Drives longer than this many minutes get a warning. */
export const LONG_DRIVE_MINUTES = 5 * 60;

/** The sort key between two neighbours: their midpoint; past the last one, one more; before the first, one less; alone, 1. */
export function positionBetween(after?: number, before?: number): number {
  if (after !== undefined && before !== undefined) return (after + before) / 2;
  if (after !== undefined) return after + 1;
  if (before !== undefined) return before - 1;
  return 1;
}

export const byPosition = <T extends { position: number }>(xs: readonly T[]) => [...xs].sort((a, b) => a.position - b.position);

/**
 * The position for a new (or moved) entry in one day's entries: right after `after`, right before `before`, between the
 * two when both are given, else at the end of the day. A neighbour that isn't in the day is an error (null).
 */
export function slotIn(day: readonly { id: string; position: number }[], o: { after?: string; before?: string } = {}): number | null {
  const sorted = byPosition(day);
  const ai = o.after ? sorted.findIndex((e) => e.id === o.after) : -1, bi = o.before ? sorted.findIndex((e) => e.id === o.before) : -1;
  if ((o.after && ai < 0) || (o.before && bi < 0)) return null;
  if (o.after && o.before) return positionBetween(sorted[ai].position, sorted[bi].position);
  if (o.after) return positionBetween(sorted[ai].position, sorted[ai + 1]?.position);
  if (o.before) return positionBetween(sorted[bi - 1]?.position, sorted[bi].position);
  return positionBetween(sorted[sorted.length - 1]?.position);
}

/** "Sat Oct 11" for YYYY-MM-DD. */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).replace(",", "");
}

/** Every date from `from` to `to`, inclusive (empty when to is before from). */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The days the tour covers: its own dates when set, otherwise its first to its last dated entry. Null when nothing is dated yet. */
export function tourSpan(tour: TourLike, entries: readonly EntryLike[]): { from: string; to: string } | null {
  const dated = entries.filter((e) => !e.deletedAt && e.date).map((e) => e.date!).sort();
  const from = tour.startDate ?? dated[0], to = tour.endDate ?? dated[dated.length - 1];
  if (!from || !to) return from ? { from, to: from } : to ? { from: to, to } : null;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** The tour by day: every date of its span plus any entry dated outside it, each with its entries in order; undated entries are the bucket. */
export function tourDays<E extends EntryLike>(tour: TourLike, entries: readonly E[]): { days: { date: string; entries: E[] }[]; bucket: E[] } {
  const live = entries.filter((e) => !e.deletedAt);
  const span = tourSpan(tour, live);
  const dates = new Set([...(span ? dateRange(span.from, span.to) : []), ...live.filter((e) => e.date).map((e) => e.date!)]);
  return {
    days: [...dates].sort().map((date) => ({ date, entries: byPosition(live.filter((e) => e.date === date)) })),
    bucket: byPosition(live.filter((e) => !e.date)),
  };
}

const toMinutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const clock = (n: number) => `${Math.floor(n / 60) % 24}:${String(n % 60).padStart(2, "0")}`;
const hoursText = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return m ? `${h} h ${m} min` : `${h} h`; };

export type TourWarningKind = "noStay" | "openDate" | "longDrive" | "lateArrival" | "outsideDates";
export interface TourWarning { kind: TourWarningKind; date?: string; entryId?: string; message: string }

/**
 * What still needs sorting on a tour, worked out fresh every time:
 * - noStay: a night of the tour (every day but the last) with no stay covering it (a stay covers its date and nights − 1 more; a round-trip drive that day means home for the night);
 * - openDate: a day with no show and no option on it;
 * - longDrive: a drive over five hours;
 * - lateArrival: leaving at leaveBy, a drive that day gets in after the load in of a show later that day;
 * - outsideDates: an entry dated before the tour's start or after its end.
 */
export function tourWarnings(tour: TourLike, entries: readonly EntryLike[], shows: ReadonlyMap<string, ShowFacts>): TourWarning[] {
  const live = entries.filter((e) => !e.deletedAt);
  const span = tourSpan(tour, live);
  const out: TourWarning[] = [];
  if (span) {
    const days = dateRange(span.from, span.to);
    const covered = new Set<string>();
    for (const e of live) {
      if (e.kind === "stay" && e.date) for (let i = 0; i < (e.nights ?? 1); i++) covered.add(addDays(e.date, i));
      if (e.kind === "drive" && e.date && e.roundTrip) covered.add(e.date);
    }
    for (const d of days.slice(0, -1)) if (!covered.has(d)) out.push({ kind: "noStay", date: d, message: `No stay the night of ${dayLabel(d)}` });
    for (const d of days) {
      if (!live.some((e) => e.date === d && (e.kind === "show" || e.kind === "option"))) out.push({ kind: "openDate", date: d, message: `${dayLabel(d)} is open: nothing booked or pitched` });
    }
  }
  for (const e of live) {
    if (e.kind !== "drive" || !e.date) continue;
    if ((e.minutes ?? 0) > LONG_DRIVE_MINUTES) out.push({ kind: "longDrive", date: e.date, entryId: e.id, message: `The drive on ${dayLabel(e.date)} is ${hoursText(e.minutes!)}` });
    if (e.leaveBy && e.minutes !== undefined) {
      const arrive = toMinutes(e.leaveBy) + Math.round(e.minutes);
      for (const s of live) {
        if (s.kind !== "show" || s.date !== e.date || s.position < e.position || !s.showId) continue;
        const show = shows.get(s.showId);
        if (show?.loadIn && arrive > toMinutes(show.loadIn)) {
          out.push({ kind: "lateArrival", date: e.date, entryId: e.id, message: `Leaving at ${e.leaveBy} gets in at ${clock(arrive)}, after load in at ${show.name} (${show.loadIn})` });
        }
      }
    }
  }
  for (const e of live) {
    if (!e.date) continue;
    if ((tour.startDate && e.date < tour.startDate) || (tour.endDate && e.date > tour.endDate)) {
      out.push({ kind: "outsideDates", date: e.date, entryId: e.id, message: `Something on ${dayLabel(e.date)} is outside the tour's dates` });
    }
  }
  return out;
}
