import { BAND_TIME_ZONE } from "./timezone";
import { setLengthOf } from "./duration";

/**
 * Which show the public fan pages (/f/, /m/) are about right now. Pure: no clock, no I/O.
 *
 * Only `confirmed` and `played` shows count (any kind); hold, canceled and dropped never do.
 * Every time is wall-clock in the show's own zone (`zoneOf`, default the band's), converted to a real instant.
 *
 * A show's window:
 *  - starts 3h before doors; no doors: before showStart; no showStart: before the set; no times at all: at the start of the show's day.
 *  - ends 3h after the set ends (set start + set length); no set time or no set length: 3h after the end of the show's day (23:59:59.999).
 *  - a time earlier than the one before it in doors, showStart, set order is after midnight, so it belongs to the next day (set 00:30).
 *
 * pickShow returns:
 *  - "during": now is inside a window. If several windows contain now (matinee and night show), the one that started latest wins,
 *    i.e. the later show once its window has opened; a further tie goes to the later end, then the later date.
 *  - "morning-after": no window contains now, but one ended less than 18h ago (exactly 18h still counts). The one that ended most
 *    recently wins; a tie goes to the later start. "during" always beats "morning-after".
 *  - null: neither.
 */

export type PickableShow = {
  id?: string;
  date: string;
  status: string;
  times?: { doors?: string; showStart?: string; set?: string; setLengthSec?: number; setLength?: number };
};
export type PickMode = "during" | "morning-after";

const HOUR = 3_600_000;
const MORNING_AFTER_MS = 18 * HOUR;
const COUNTS = new Set(["confirmed", "played"]);

type Zoned<S> = { zoneOf?: (show: S) => string };

/** Milliseconds the zone is ahead of UTC at this instant. */
function offsetAt(ms: number, zone: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

/** The instant at which a wall clock (YYYY-MM-DD, HH:MM) reads that time in `zone`. A wall time that doesn't exist (spring-forward gap) lands just after the gap. */
export function wallToInstant(date: string, time: string, zone: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let ms = wall - offsetAt(wall, zone);
  ms = wall - offsetAt(ms, zone);
  return ms;
}

export const addDays = (date: string, n: number): string => new Date(Date.parse(date + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const minutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

/** [start, end] instants of a show's window (see the file comment). */
export function showWindow<S extends PickableShow>(show: S, zone: string = BAND_TIME_ZONE): { start: number; end: number } {
  const t = show.times ?? {};
  const dayStart = wallToInstant(show.date, "00:00", zone);
  const dayEnd = wallToInstant(addDays(show.date, 1), "00:00", zone) - 1;
  // Roll times that go backwards (after midnight) onto the next day.
  let last = -1, dayOffset = 0;
  const at = (time: string | undefined) => {
    if (!time) return undefined;
    const m = minutes(time);
    if (m < last) dayOffset = 1;
    last = Math.max(last, m);
    return wallToInstant(addDays(show.date, dayOffset), time, zone);
  };
  const doors = at(t.doors), showStart = at(t.showStart), set = at(t.set);
  const first = doors ?? showStart ?? set;
  const start = first === undefined ? dayStart : first - 3 * HOUR;
  const len = setLengthOf(t);
  const end = set !== undefined && len ? set + len * 1000 + 3 * HOUR : dayEnd + 3 * HOUR;
  return { start, end };
}

/** The show the fan pages are about at `now` (ms since epoch or Date), or null. See the file comment for the rules. */
export function pickShow<S extends PickableShow>(shows: readonly S[], now: number | Date, opts: Zoned<S> = {}): { show: S; mode: PickMode } | null {
  const t = +now;
  let during: { show: S; start: number; end: number } | null = null;
  let after: { show: S; start: number; end: number } | null = null;
  for (const show of shows) {
    if (!COUNTS.has(show.status)) continue;
    const w = showWindow(show, opts.zoneOf?.(show));
    const c = { show, ...w };
    if (t >= w.start && t <= w.end) {
      if (!during || w.start > during.start || (w.start === during.start && (w.end > during.end || (w.end === during.end && show.date > during.show.date)))) during = c;
    } else if (t > w.end && t - w.end <= MORNING_AFTER_MS) {
      if (!after || w.end > after.end || (w.end === after.end && w.start > after.start)) after = c;
    }
  }
  if (during) return { show: during.show, mode: "during" };
  if (after) return { show: after.show, mode: "morning-after" };
  return null;
}

/**
 * For the "Change" picker: up to `n` confirmed or played shows from the last `days` to the next `days` (default 30 each way),
 * nearest first. Distance is 0 for a show whose window contains now, else the gap from now to the window; ties go to the earlier date.
 */
export function recentAndUpcoming<S extends PickableShow>(shows: readonly S[], now: number | Date, n: number, opts: Zoned<S> & { days?: number } = {}): S[] {
  const t = +now, span = (opts.days ?? 30) * 24 * HOUR;
  return shows
    .filter((s) => COUNTS.has(s.status))
    .map((show) => {
      const w = showWindow(show, opts.zoneOf?.(show));
      return { show, dist: t < w.start ? w.start - t : t > w.end ? t - w.end : 0 };
    })
    .filter((c) => c.dist <= span)
    .sort((a, b) => a.dist - b.dist || (a.show.date < b.show.date ? -1 : a.show.date > b.show.date ? 1 : 0))
    .slice(0, n)
    .map((c) => c.show);
}
