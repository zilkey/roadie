/**
 * The one place the band's timezone lives. The band is in Colorado, so every "today", every wall-clock show time
 * and every payload sent to Calendar or Bandsintown is interpreted in America/Denver, whatever the server or the
 * viewer's browser is set to.
 */
export const BAND_TIME_ZONE = "America/Denver";

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: BAND_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Calendar date (YYYY-MM-DD) of an instant as seen in the band's timezone. */
export function dateInBandZone(d: Date = new Date()): string {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Format an instant (ISO string, ms or Date) for display in the band's timezone. */
export function fmtInstant(t: string | number | Date, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }): string {
  return new Date(t).toLocaleString("en-US", { ...opts, timeZone: BAND_TIME_ZONE });
}
