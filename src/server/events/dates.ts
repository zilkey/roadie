/**
 * Dates and times as venue calendars write them, turned into the venue's own wall clock: `date` YYYY-MM-DD and `HH:MM` (24h).
 * An instant with an offset is converted to the venue's time zone; a local date-time without one is taken as written.
 * Free text ("Fri, Nov 14 · 8pm", "11/14/2026 7:30 PM", "Saturday, November 15th") is parsed loosely; a date with no
 * year resolves to the next matching date (checked against the weekday when one is given).
 */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const pad = (n: number) => String(n).padStart(2, "0");

export interface LocalDT { date: string; time?: string }

/** An instant as the venue's date and time. */
export function localOf(d: Date, tz: string): LocalDT {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Today's date at the venue. */
export const todayIn = (tz: string, now = new Date()) => localOf(now, tz).date;

/**
 * "2026-11-14T20:00:00-07:00" / "...Z" → converted to tz. "2026-11-14T20:00" / "2026-11-14 20:00:00" → as written.
 * "2026-11-14" → the date alone. Midnight exactly (an all-day item stored as 00:00) gives no time.
 */
export function resolveStartsAt(s: string, tz: string): LocalDT | undefined {
  const t = s.trim();
  const local = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(t);
  if (local) return { date: local[1], ...(local[2] !== undefined ? { time: `${pad(+local[2])}:${local[3]}` } : {}) };
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) return undefined;
  const r = localOf(new Date(ms), tz);
  return r;
}

const MER = String.raw`(a\.?m\.?|p\.?m\.?)(?![a-z])`;
const hhmm = (h: number, m: string) => (h < 24 && +m < 60 ? `${pad(h)}:${m}` : undefined);
const to24 = (h: number, mer: string) => (h % 12) + (/^p/i.test(mer) ? 12 : 0);

function firstTime(text: string): string | undefined {
  // A range ("6:00 - 7:00 PM", "8-11pm"): the start, with the end's am/pm when it has none ("11 - 1 PM" starts at 11 AM).
  const r = new RegExp(String.raw`\b(\d{1,2})(?::(\d{2}))?\s*(?:${MER})?\s*(?:-|–|—|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*${MER}`, "i").exec(text);
  if (r) {
    const sh = +r[1], eh = +r[4], endMer = r[6];
    const mer = r[3] ?? (/^p/i.test(endMer) && sh % 12 > eh % 12 ? "am" : endMer);
    return hhmm(to24(sh, mer), r[2] ?? "00");
  }
  const m = new RegExp(String.raw`\b(\d{1,2})(?::(\d{2}))?\s*${MER}`, "i").exec(text);
  if (m) return hhmm(to24(+m[1], m[3]), m[2] ?? "00");
  const n = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  return n ? `${pad(+n[1])}:${n[2]}` : undefined;
}

/**
 * "8pm", "8:30 PM", "20:00", "8 p.m." → "20:00": the first time in the text, or the start of a range. With a label
 * ("doors", "show"), the time right after that word wins: "Doors: 7 pm Show: 8 pm" gives 19:00 for doors, 20:00 for show.
 */
export function parseTime(text: string | undefined, label?: "doors" | "show"): string | undefined {
  if (!text) return undefined;
  if (label) {
    const words = label === "doors" ? "doors?" : "(?:show|music|starts?|start time)";
    const at = new RegExp(String.raw`\b${words}\b\s*(?:at|@|:)?\s*`, "i").exec(text);
    if (at) { const t = firstTime(text.slice(at.index + at[0].length)); if (t) return t; }
    // "Doors 7 / Show 8": asked for the show and only doors is labelled, take the second time.
    if (label === "show" && /\bdoors?\b/i.test(text)) {
      const after = /\bdoors?\b\s*(?:at|@|:)?\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?/i.exec(text);
      const t = after ? firstTime(text.slice(after.index + after[0].length)) : undefined;
      if (t) return t;
    }
  }
  return firstTime(text);
}

const weekdayOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;

/**
 * No year given: the next date with this month/day (and weekday, if named) within about eight months, else a date in the
 * last four months (a stale listing), else the next one at all. "Oct 28" seen on Nov 10 is last month, not next October.
 */
function resolveYear(m: number, d: number, wd: number | undefined, today: string): string | undefined {
  const [ty, tm, td] = today.split("-").map(Number);
  const t0 = Date.UTC(ty, tm - 1, td) - 86_400_000;
  const all: number[] = [];
  for (let y = ty - 1; y <= ty + 2; y++) {
    if (!valid(y, m, d)) continue;
    if (wd !== undefined && weekdayOf(y, m, d) !== wd) continue;
    all.push(Date.UTC(y, m - 1, d));
  }
  if (!all.length) return wd !== undefined ? resolveYear(m, d, undefined, today) : undefined; // a weekday typo on the page
  const next = all.find((x) => x >= t0), last = [...all].reverse().find((x) => x < t0);
  const DAY = 86_400_000;
  const near = next !== undefined && next - t0 <= 240 * DAY ? next : last !== undefined && t0 - last <= 120 * DAY ? last : undefined;
  // Only a long-past date matches the weekday: the weekday is the page's typo, the month and day are right.
  if (near === undefined && next === undefined && wd !== undefined) return resolveYear(m, d, undefined, today);
  const pick = near ?? next ?? last!;
  const x = new Date(pick);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

/**
 * Parse a calendar's date text. `format` is only a hint for numeric dates: "D/M" first means day-first. Returns the date and,
 * when the text has one, the time.
 */
export function parseDateText(text: string | undefined, opts: { tz: string; now?: Date; format?: string }): LocalDT | undefined {
  if (!text) return undefined;
  const s = text.replace(/\s+/g, " ").trim();
  const today = todayIn(opts.tz, opts.now);
  const time = parseTime(s.replace(/\b\d{4}-\d{2}-\d{2}\b/, ""));
  // ISO first.
  const iso = /\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?/.exec(s);
  if (iso) {
    if (iso[6] || iso[4]) return resolveStartsAt(iso[0], opts.tz);
    return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, ...(time ? { time } : {}) };
  }
  const lower = s.toLowerCase();
  const wdMatch = new RegExp(`\\b(${DAYS.join("|")})[a-z]*\\.?\\b`).exec(lower);
  const wd = wdMatch ? DAYS.indexOf(wdMatch[1]) : undefined;
  // "Nov 14", "November 14th, 2026", "14 Nov 2026"
  const md = new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`).exec(lower);
  const dm = md ? null : new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join("|")})[a-z]*\\.?(?:,?\\s+(\\d{4}))?`).exec(lower);
  let y: number | undefined, m: number | undefined, d: number | undefined;
  if (md) { m = MONTHS.indexOf(md[1]) + 1; d = +md[2]; y = md[3] ? +md[3] : undefined; }
  else if (dm) { d = +dm[1]; m = MONTHS.indexOf(dm[2]) + 1; y = dm[3] ? +dm[3] : undefined; }
  else {
    const num = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/.exec(lower);
    if (!num) return undefined;
    const dayFirst = !!opts.format && /^\s*(?:ddd+[^dDmM]*)?D{1,2}[/.-]M/.test(opts.format);
    m = dayFirst ? +num[2] : +num[1]; d = dayFirst ? +num[1] : +num[2];
    y = num[3] ? (num[3].length === 2 ? 2000 + +num[3] : +num[3]) : undefined;
  }
  if (y !== undefined) return valid(y, m, d) ? { date: `${y}-${pad(m)}-${pad(d)}`, ...(time ? { time } : {}) } : undefined;
  const date = resolveYear(m, d, wd, today);
  return date ? { date, ...(time ? { time } : {}) } : undefined;
}
