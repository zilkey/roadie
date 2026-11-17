/**
 * Wall-clock dates and times in a named IANA zone. Every artist has its own (`artists.timeZone`, General Settings): the server
 * reads it with `zoneOf(ctx)` (src/server/zone.ts), the browser with `useZone()` (src/lib/artist.tsx). A show at a venue with
 * its own `timeZone` uses the venue's. Nothing here reads the machine's or the browser's zone.
 */
const fmts = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string, withTime: boolean): Intl.DateTimeFormat {
  const key = `${withTime ? "t" : "d"}|${zone}`;
  let f = fmts.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}) });
    fmts.set(key, f);
  }
  return f;
}
const partsOf = (f: Intl.DateTimeFormat, d: Date) => Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));

/** Calendar date (YYYY-MM-DD) of an instant as seen in `zone`. */
export function dateInZone(zone: string, d: Date = new Date()): string {
  const p = partsOf(formatter(zone, false), d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Date and time (YYYY-MM-DD HH:MM, 24-hour) of an instant as seen in `zone`. */
export function dateTimeInZone(zone: string, d: Date = new Date()): string {
  const p = partsOf(formatter(zone, true), d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** Format an instant (ISO string, ms or Date) for display in `zone`. */
export function fmtInstant(t: string | number | Date, zone: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }): string {
  return new Date(t).toLocaleString("en-US", { ...opts, timeZone: zone });
}

/**
 * The zone a new artist starts with when nobody picked one (scripts, an older backup's artist, a system job with no venue zone).
 * Not a fallback for an artist that has one: read `artists.timeZone`.
 */
export const DEFAULT_TIME_ZONE = "America/Denver";

/** The zones the pickers offer (artist and venue), as [IANA name, label]. */
export const US_ZONES: [string, string][] = [
  ["America/New_York", "Eastern"], ["America/Chicago", "Central"], ["America/Denver", "Mountain"], ["America/Phoenix", "Arizona (no DST)"],
  ["America/Los_Angeles", "Pacific"], ["America/Anchorage", "Alaska"], ["Pacific/Honolulu", "Hawaii"],
];

/** US_ZONES, plus `current` (labelled with its own name) when it is a zone the list doesn't have, so a picker never hides the saved value. */
export function zoneOptions(current?: string | null): [string, string][] {
  return current && !US_ZONES.some(([z]) => z === current) ? [...US_ZONES, [current, current.replace(/_/g, " ")]] : US_ZONES;
}

/** This browser's own zone (the start-band form's default); DEFAULT_TIME_ZONE when the browser doesn't say. */
export function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE; } catch { return DEFAULT_TIME_ZONE; }
}
