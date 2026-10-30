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

// ---------- the pages ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parts = (d: string) => { const [y, m, day] = d.split("-").map(Number); return { y, m: MONTHS[m - 1], d: day }; };

/** "Mar 9–14, 2027", "Mar 30 – Apr 2, 2027", "Dec 30, 2026 – Jan 2, 2027"; one end only: "From Mar 9, 2027" / "Until Mar 14, 2027". */
export function fmtTourDates(start?: string, end?: string): string {
  if (!start && !end) return "No dates yet";
  const one = (d: string) => { const p = parts(d); return `${p.m} ${p.d}, ${p.y}`; };
  if (!end) return `From ${one(start!)}`;
  if (!start) return `Until ${one(end)}`;
  if (start === end) return one(start);
  const a = parts(start), b = parts(end);
  if (a.y !== b.y) return `${one(start)} – ${one(end)}`;
  if (a.m !== b.m) return `${a.m} ${a.d} – ${b.m} ${b.d}, ${b.y}`;
  return `${a.m} ${a.d}–${b.d}, ${b.y}`;
}

export const TOUR_STATUS_LABEL = { idea: "Idea", planning: "Planning", booked: "Booked", done: "Done" } as const;

/** The Tours list's filter: Ideas are status idea; Past is done or ended before today; the rest are Upcoming. */
export type TourFilter = "upcoming" | "ideas" | "past" | "all";
export function tourFilterOf(tour: TourLike & { status: string }, today: string): Exclude<TourFilter, "all"> {
  if (tour.status === "done" || (tour.endDate && tour.endDate < today)) return "past";
  return tour.status === "idea" ? "ideas" : "upcoming";
}

/** "1 night no stay · 1 long drive": the warnings that need doing something about (open dates have their own column). Empty when there are none. */
export function attentionText(warnings: readonly { kind: TourWarningKind }[]): string {
  const n = (k: TourWarningKind) => warnings.filter((w) => w.kind === k).length;
  const plural = (c: number, one: string, many: string) => (c ? [`${c} ${c === 1 ? one : many}`] : []);
  return [
    ...plural(n("noStay"), "night no stay", "nights no stay"), ...plural(n("longDrive"), "long drive", "long drives"),
    ...plural(n("lateArrival"), "late arrival", "late arrivals"), ...plural(n("outsideDates"), "thing outside the dates", "things outside the dates"),
  ].join(" · ");
}

// ---------- the Plan tab ----------

/** "7 h 10 min · 463 mi"; either half alone; empty when the server has neither yet. */
export function driveText(minutes?: number, miles?: number): string {
  return [minutes !== undefined ? hoursText(minutes) : "", miles !== undefined ? `${Math.round(miles).toLocaleString("en-US")} mi` : ""].filter(Boolean).join(" · ");
}

/** The stat pills over the plan: shows booked, open dates and dated options, the warnings that need doing (each with its first day), and the driving. */
export function planStats(entries: readonly EntryLike[], warnings: readonly TourWarning[]) {
  const live = entries.filter((e) => !e.deletedAt);
  const drives = live.filter((e) => e.kind === "drive");
  const firstDay = (k: TourWarningKind) => warnings.filter((w) => w.kind === k && w.date).map((w) => w.date!).sort()[0];
  const n = (k: TourWarningKind) => warnings.filter((w) => w.kind === k).length;
  const plural = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;
  const attention: { kind: TourWarningKind; text: string; date?: string }[] = [];
  if (n("noStay")) attention.push({ kind: "noStay", text: plural(n("noStay"), "night with no stay", "nights with no stay"), date: firstDay("noStay") });
  if (n("longDrive")) attention.push({ kind: "longDrive", text: plural(n("longDrive"), "long drive", "long drives"), date: firstDay("longDrive") });
  if (n("lateArrival")) attention.push({ kind: "lateArrival", text: plural(n("lateArrival"), "late arrival", "late arrivals"), date: firstDay("lateArrival") });
  if (n("outsideDates")) attention.push({ kind: "outsideDates", text: plural(n("outsideDates"), "thing outside the dates", "things outside the dates"), date: firstDay("outsideDates") });
  const minutes = drives.reduce((s, e) => s + (e.minutes ?? 0), 0), miles = drives.reduce((s, e) => s + (e.miles ?? 0), 0);
  return {
    shows: live.filter((e) => e.kind === "show").length,
    options: live.filter((e) => e.kind === "option" && e.date).length,
    openDates: n("openDate"),
    attention,
    driving: drives.length ? `${Math.round(miles).toLocaleString("en-US")} mi · ${Math.round(minutes / 60)} h driving` : "",
  };
}

/** The lower-cased towns a tour passes through (the "Near the route" filter): where it leaves from, every drive's ends, every stay, and the towns of its shows and options. */
export function routeTowns(places: readonly ({ name?: string; address: string } | undefined)[], cities: readonly (string | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const p of places) if (p) for (const t of [p.name, p.address.split(",")[0]]) if (t?.trim()) out.add(t.trim().toLowerCase());
  for (const c of cities) if (c?.trim()) out.add(c.trim().toLowerCase());
  return out;
}
