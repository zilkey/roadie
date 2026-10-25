/** Pure calendar logic for the Calendar page (no server or browser imports). All dates are plain YYYY-MM-DD strings. */

export type CalendarKind = "show" | "rehearsal" | "pitchDate" | "opens" | "deadline" | "seriesStart" | "festivalDay";

export interface CalendarItem {
  /** Unique per item (e.g. `${kind}:${sourceId}:${date}`). */
  id: string;
  date: string;
  kind: CalendarKind;
  /** opens/deadline with sure === "estimated". */
  estimated?: boolean;
  /** deadline with sure === "target" ("Pitch by"). */
  target?: boolean;
  title: string;
  subtitle: string;
  /** Artist-relative path to the record, e.g. "/shows/abc". */
  href: string;
  /** Pitch date before today (struck through). */
  past?: boolean;
  /** The pitch, show, rehearsal or edition id; conflicts count each source once per day. */
  sourceId: string;
  /** A festival's day 1 (festivalDay only). */
  firstDay?: boolean;
}

export type CalendarLayer = "all" | "shows" | "rehearsals" | "booking";

/** Groups items by date. */
export function itemsByDay(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const list = byDay.get(item.date);
    if (list) list.push(item);
    else byDay.set(item.date, [item]);
  }
  return byDay;
}

/** A day's conflict: 2+ of shows and pitch dates (each pitch once). Null when none. */
export function conflictOf(dayItems: CalendarItem[]): { label: string } | null {
  const shows = new Set<string>();
  const pitches = new Set<string>();
  for (const item of dayItems) {
    if (item.kind === "show") shows.add(item.sourceId);
    else if (item.kind === "pitchDate") pitches.add(item.sourceId);
  }
  const s = shows.size;
  const p = pitches.size;
  if (s + p < 2) return null;
  if (p === 0) return { label: `${s} shows` };
  if (s > 0) return { label: "show + pitch date" };
  return { label: `${p} pitch dates overlap` };
}

/** Every date in the full Sunday-start weeks covering month `ym` ("YYYY-MM"). Length is a multiple of 7. */
export function monthGrid(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  const first = Date.UTC(y, m - 1, 1);
  const last = Date.UTC(y, m, 0);
  const start = first - new Date(first).getUTCDay() * 86400000;
  const end = last + (6 - new Date(last).getUTCDay()) * 86400000;
  const days: string[] = [];
  for (let t = start; t <= end; t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

/** Opens and deadlines on or after `today`, soonest first, first `n`. */
export function upcoming(items: CalendarItem[], today: string, n: number): CalendarItem[] {
  return items
    .filter((i) => (i.kind === "opens" || i.kind === "deadline") && i.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, n);
}

/** Whether `item` shows under filter `layer`. */
export function layerFilter(item: CalendarItem, layer: CalendarLayer): boolean {
  switch (layer) {
    case "all":
      return true;
    case "shows":
      return item.kind === "show";
    case "rehearsals":
      return item.kind === "rehearsal";
    case "booking":
      return ["pitchDate", "opens", "deadline", "seriesStart", "festivalDay"].includes(item.kind);
  }
}

function utcDay(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `today` to `date` (UTC; negative when past). */
export function daysUntil(date: string, today: string): number {
  return Math.round((utcDay(date) - utcDay(today)) / 86400000);
}
