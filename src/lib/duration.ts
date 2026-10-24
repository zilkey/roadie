/**
 * Set length: typed as free text, stored as whole seconds. Pure (UI and server).
 *   parseDuration("2h") = 7200, "2 hours", "90m", "90 min", "2:30" (h:mm), "1h 45m", "1.5h", "120" (bare number = minutes)
 *   fmtDuration(9000) = "2h 30m"          (the shortest natural form, for tables and cards)
 *   describeDuration(9000) = "2 hours 30 minutes"   (said back under the field)
 */

const UNIT: Record<string, number> = {
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
};

/** Seconds, or null when the text can't be read as a positive duration. */
export function parseDuration(text: string): number | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  // "2:30" = 2 hours 30 minutes
  const hm = /^(\d+):([0-5]\d)$/.exec(s);
  if (hm) return positive(Number(hm[1]) * 3600 + Number(hm[2]) * 60);
  // "120" = minutes
  if (/^\d+(\.\d+)?$/.test(s)) return positive(Math.round(Number(s) * 60));
  // one or more "<number><unit>" parts, nothing else: "1h 45m", "1.5h", "2 hours", "90 min", "1 hr and 30 mins"
  const parts = s.replace(/,|\band\b/g, " ");
  if (!/^(\s*\d+(\.\d+)?\s*[a-z]+)+\s*$/.test(parts)) return null;
  let total = 0;
  for (const [, n, u] of parts.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/g)) {
    if (!UNIT[u]) return null;
    total += Number(n) * UNIT[u];
  }
  return positive(Math.round(total));
}
const positive = (n: number) => (Number.isFinite(n) && n > 0 ? n : null);

const split = (sec: number) => {
  const mins = Math.round(sec / 60);
  return { h: Math.floor(mins / 60), m: mins % 60 };
};

/** "2h", "2h 30m", "45m"; "" for nothing. */
export function fmtDuration(sec?: number | null): string {
  if (!sec || sec <= 0) return "";
  const { h, m } = split(sec);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "2 hours 30 minutes", "1 hour", "45 minutes". */
export function describeDuration(sec: number): string {
  const { h, m } = split(sec);
  const w = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  return [h && w(h, "hour"), (m || !h) && w(m, "minute")].filter(Boolean).join(" ");
}

/** The clock time a set ends: start "18:30" + 7200s = "8:30 PM". Wraps past midnight. */
export function endsAt(start: string, sec: number): string {
  const [h, m] = start.split(":").map(Number);
  const t = (h * 60 + m + Math.round(sec / 60)) % (24 * 60);
  const hh = Math.floor(t / 60), mm = t % 60;
  return `${hh % 12 || 12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}

/** A show's set length in seconds: setLengthSec, else the legacy minutes field (shows not yet migrated). */
export const setLengthOf = (t: { setLengthSec?: number; setLength?: number }) => t.setLengthSec ?? (t.setLength ? t.setLength * 60 : undefined);
