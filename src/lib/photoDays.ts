/**
 * Posts › Photos groups the inbox's photos by the day they were taken, and labels each day with that day's shows and
 * rehearsals. Pure, so the page and the tests share it.
 */
import { showName, type ShowPlaceLike } from "./shows";

/** A photo taken before this hour counts toward the day before, so late-show photos land on the show's day. */
export const DAY_STARTS_AT_HOUR = 4;

/** Shows that label a day: on the books or played. Canceled and dropped shows didn't happen. */
const LABEL_STATUSES = new Set(["hold", "confirmed", "played"]);

/** The day (YYYY-MM-DD) a photo taken at `takenAt` ("YYYY-MM-DD HH:MM") belongs to; null when there's no date. */
export function photoDay(takenAt: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):\d{2})?/.exec(takenAt);
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] === undefined || Number(m[4]) >= DAY_STARTS_AT_HOUR) return day;
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface LabelShow extends ShowPlaceLike { date: string; status: string; deletedAt?: unknown }
export interface LabelRehearsal { date: string; location?: { name?: string }; deletedAt?: unknown }

/** date → what happened that day: "<show name>" for each hold, confirmed or played show, then "Rehearsal" (· where) for each rehearsal. */
export function dayLabels(shows: readonly LabelShow[], rehearsals: readonly LabelRehearsal[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (date: string, label: string) => out.set(date, [...(out.get(date) ?? []), label]);
  for (const s of shows) if (!s.deletedAt && LABEL_STATUSES.has(s.status)) add(s.date, showName(s));
  for (const r of rehearsals) if (!r.deletedAt) add(r.date, r.location?.name ? `Rehearsal · ${r.location.name}` : "Rehearsal");
  return out;
}

export interface PhotoDay<P> { day: string | null; labels: string[]; photos: P[] }

/**
 * Photos grouped by photoDay, newest day first (photos with no date last), each day keeping the photos' order as given
 * (newest added first) and the day's labels.
 */
export function groupByDay<P extends { takenAt: string }>(photos: readonly P[], labels: Map<string, string[]> = new Map()): PhotoDay<P>[] {
  const days = new Map<string | null, P[]>();
  for (const p of photos) {
    const d = photoDay(p.takenAt);
    days.set(d, [...(days.get(d) ?? []), p]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : b.localeCompare(a)))
    .map(([day, ps]) => ({ day, labels: day ? labels.get(day) ?? [] : [], photos: ps }));
}

/** "Sat, Oct 10, 2026" for a YYYY-MM-DD day; "No date" for null. */
export function dayTitle(day: string | null): string {
  if (!day) return "No date";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
