/**
 * The one place the band's timezone lives. The band is in Colorado, so every "today", every wall-clock show time
 * and every payload sent to Calendar is interpreted in America/Denver, whatever the server or the
 * viewer's browser is set to.
 */
export const BAND_TIME_ZONE = "America/Denver";

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: BAND_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Calendar date (YYYY-MM-DD) of an instant as seen in the band's timezone. */
export function dateInBandZone(d: Date = new Date()): string {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const fmtTime = new Intl.DateTimeFormat("en-CA", { timeZone: BAND_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Date and time (YYYY-MM-DD HH:MM, 24-hour) of an instant as seen in the band's timezone. */
export function dateTimeInBandZone(d: Date = new Date()): string {
  const p = Object.fromEntries(fmtTime.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** Format an instant (ISO string, ms or Date) for display in the band's timezone. */
export function fmtInstant(t: string | number | Date, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }): string {
  return new Date(t).toLocaleString("en-US", { ...opts, timeZone: BAND_TIME_ZONE });
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
