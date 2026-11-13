/**
 * The day-of banner (#66): which of today's shows and rehearsals are "on" right now, in what order, and what each row says.
 * Pure: every function takes `now`, so the unit tests and the banner agree.
 *
 * A show or rehearsal is on from 3 hours before the earliest time we have for it until it is over:
 *   - a show is over 3 hours after its last time (usually Set starts);
 *   - a rehearsal is over at its end time, or 3 hours after its start when it has no end time;
 *   - with no times at all it is on all day on its date, midnight to midnight.
 * Clock times are the venue's (its time zone, else the band's); rehearsals use the band's.
 *
 * A show's row turns into the after-show invite an hour after its last time, until it leaves (dayOfAfter): "Congrats on the
 * Deep End show!", and for admins "Record the deets", which opens the show and starts Roadie's after-show interview.
 */
import { BAND_TIME_ZONE } from "./timezone";
import { addDays, fmtTime, showName, type ShowPlaceLike } from "./shows";

export const DAY_OF_LEAD_MS = 3 * 60 * 60 * 1000;
export const DAY_OF_TAIL_MS = 3 * 60 * 60 * 1000;
/** How long after a show's last time (usually Set starts) its row becomes the after-show invite. */
export const DAY_OF_AFTER_MS = 60 * 60 * 1000;

export type DayOfKind = "show" | "rehearsal";
export interface DayOfTimes { loadIn?: string; soundcheck?: string; doors?: string; showStart?: string; set?: string }
export interface DayOfShow extends ShowPlaceLike { id: string; date: string; status: string; artistId?: string; times?: DayOfTimes; fanPage?: { amountCents?: number } }
export interface DayOfRehearsal { id: string; date: string; startTime?: string; endTime?: string; location?: { name?: string; address?: string; lat?: number; lng?: number } }

/** One clock time of a show or rehearsal, as an instant. */
export interface DayOfPoint { label: string; time: string; at: number }
export interface DayOfItem {
  /** What a dismissal is stored under: kind, id and date, so one moved to another day comes back. */
  key: string;
  kind: DayOfKind; id: string; date: string;
  /** Artist-relative link to its page. */
  href: string;
  /** The venue (or "House concert · hosts", the festival); a rehearsal's place, "" when it has none. */
  title: string;
  city?: string;
  /** Where Directions goes in Google Maps; absent when the show or rehearsal has no place. */
  mapsQuery?: string;
  /** A show whose fan page line has an amount, so its preview shows something. */
  fanPreview?: boolean;
  zone: string;
  /** The banner shows while start <= now < end. */
  start: number; end: number;
  /** Its known times, earliest first; empty when it has none. */
  points: DayOfPoint[];
  /** A rehearsal's end time, when it has one. */
  until?: DayOfPoint;
}

/** Dismissals are stored per kind, id and date. */
export const dayOfKey = (kind: DayOfKind, id: string, date: string) => `${kind}:${id}:${date}`;

const offsetFmt = new Map<string, Intl.DateTimeFormat>();
/** How far `zone`'s clock is ahead of UTC at instant `t`, in ms. */
function zoneOffset(t: number, zone: string): number {
  let f = offsetFmt.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    offsetFmt.set(zone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}

/** The instant a wall clock in `zone` reads `date` + `minutes` after midnight (minutes may pass 1440: the next day). */
export function zonedInstant(date: string, minutes: number, zone: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  const guess = wall - zoneOffset(wall, zone);
  return wall - zoneOffset(guess, zone); // the offset at the guess settles a daylight-saving change between the two
}

const minutesOf = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const safeZone = (zone?: string) => {
  if (!zone) return BAND_TIME_ZONE;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return zone; } catch { return BAND_TIME_ZONE; }
};

const SHOW_TIMES: [keyof DayOfTimes, string][] = [["loadIn", "Load-in"], ["soundcheck", "Soundcheck"], ["doors", "Doors"], ["showStart", "Show starts"], ["set", "Set starts"]];

/**
 * A show's row. Its times are read in the order a night runs (load-in, soundcheck, doors, show, set); one that is more than
 * 12 hours earlier than the one before it (doors 22:00, set 00:30) is after midnight, the same night.
 */
export function showItem(s: DayOfShow, zone?: string): DayOfItem {
  const z = safeZone(zone);
  const points: DayOfPoint[] = [];
  let prev: number | null = null;
  for (const [field, label] of SHOW_TIMES) {
    const time = s.times?.[field];
    if (!time) continue;
    let min = minutesOf(time);
    if (prev !== null && min < prev - 720) min += 1440;
    prev = min;
    points.push({ label, time, at: zonedInstant(s.date, min, z) });
  }
  points.sort((a, b) => a.at - b.at);
  const base = { key: dayOfKey("show", s.id, s.date), kind: "show" as const, id: s.id, date: s.date, href: `/shows/${s.id}`, title: showName(s), city: s.venue?.city ?? s.place?.city, mapsQuery: showMapsQuery(s), fanPreview: !!s.fanPage?.amountCents, zone: z, points };
  if (!points.length) return { ...base, start: zonedInstant(s.date, 0, z), end: zonedInstant(s.date, 1440, z) };
  return { ...base, start: points[0].at - DAY_OF_LEAD_MS, end: points[points.length - 1].at + DAY_OF_TAIL_MS };
}

/** A show's Directions query: the venue's name with its address, else with its city; a house concert's address, else its city. */
export function showMapsQuery(s: DayOfShow): string | undefined {
  const address = s.venue?.address ?? s.place?.address;
  const city = s.venue?.city ?? s.place?.city;
  const q = [s.venue?.name, address || city].filter((x) => x?.trim()).join(", ");
  return q || undefined;
}

/** A rehearsal's Directions query: its address, else its coordinates, else its name. */
export function rehearsalMapsQuery(r: DayOfRehearsal): string | undefined {
  const l = r.location;
  if (!l) return undefined;
  return l.address?.trim() || (l.lat !== undefined && l.lng !== undefined ? `${l.lat},${l.lng}` : l.name?.trim()) || undefined;
}

/** Google Maps directions to the place, from wherever the phone is. */
export const dayOfDirectionsHref = (q: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;

/** A rehearsal's row, on the band's clock. An end time at or before the start is after midnight. */
export function rehearsalItem(r: DayOfRehearsal, zone: string = BAND_TIME_ZONE): DayOfItem {
  const base = { key: dayOfKey("rehearsal", r.id, r.date), kind: "rehearsal" as const, id: r.id, date: r.date, href: `/rehearsals/${r.id}`, title: r.location?.name?.trim() ?? "", mapsQuery: rehearsalMapsQuery(r), zone };
  const midnight = zonedInstant(r.date, 0, zone);
  if (!r.startTime) {
    const until = r.endTime ? { label: "Until", time: r.endTime, at: zonedInstant(r.date, minutesOf(r.endTime), zone) } : undefined;
    return { ...base, points: [], until, start: midnight, end: until && until.at > midnight ? until.at : zonedInstant(r.date, 1440, zone) };
  }
  const startMin = minutesOf(r.startTime);
  const start: DayOfPoint = { label: "Starts", time: r.startTime, at: zonedInstant(r.date, startMin, zone) };
  let until: DayOfPoint | undefined;
  if (r.endTime) {
    const endMin = minutesOf(r.endTime);
    until = { label: "Until", time: r.endTime, at: zonedInstant(r.date, endMin <= startMin ? endMin + 1440 : endMin, zone) };
  }
  return { ...base, points: [start], until, start: start.at - DAY_OF_LEAD_MS, end: until ? until.at : start.at + DAY_OF_TAIL_MS };
}

/** The dates whose shows and rehearsals could be on at `now`: yesterday (a late night), today and tomorrow (a time just after midnight). */
export function dayOfDates(today: string): string[] {
  return [addDays(today, -1), today, addDays(today, 1)];
}

/**
 * The banner's rows at `now`: this artist's confirmed shows and the band's rehearsals that are on and not dismissed,
 * by when each first appears (earliest first), then by its first time, shows before rehearsals.
 * `zones` maps a venue id to its time zone; a venue without one is on the band's clock.
 */
export function dayOfItems(i: {
  shows: DayOfShow[]; rehearsals: DayOfRehearsal[]; now: number; artistId?: string;
  zones?: ReadonlyMap<string, string | undefined>; dismissed?: readonly string[];
}): DayOfItem[] {
  const hidden = new Set(i.dismissed ?? []);
  const items = [
    ...i.shows.filter((s) => s.status === "confirmed" && (!i.artistId || !s.artistId || s.artistId === i.artistId)).map((s) => showItem(s, s.venue ? i.zones?.get(s.venue.id) : undefined)),
    ...i.rehearsals.map((r) => rehearsalItem(r)),
  ];
  const first = (x: DayOfItem) => x.points[0]?.at ?? x.start;
  return items
    .filter((x) => x.start <= i.now && i.now < x.end && !hidden.has(x.key))
    .sort((a, b) => a.start - b.start || first(a) - first(b) || (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === "show" ? -1 : 1));
}

/** "MST", "CDT": the zone's short name at that instant, for a venue that isn't on the band's clock. */
function zoneName(at: number, zone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value ?? "";
}
const clock = (p: DayOfPoint, zone: string) => `${fmtTime(p.time)}${zone === BAND_TIME_ZONE ? "" : ` ${zoneName(p.at, zone)}`}`;

/**
 * What the row says after the name: the next time still ahead ("Load-in 5:00 pm", then "Doors 7:00 pm"...), "On now" after
 * the last one, "Today" when it has no times. A rehearsal: "Starts 7:00 pm", then "On now, until 9:00 pm".
 */
export function dayOfText(item: DayOfItem, now: number): string {
  const until = item.until && item.until.at > now ? `, until ${clock(item.until, item.zone)}` : "";
  if (!item.points.length) return `Today${until}`;
  const next = item.points.find((p) => p.at > now);
  if (next) return `${next.label} ${clock(next, item.zone)}`;
  return `On now${until}`;
}

/** The dismiss button's name: "Hide the banner for Velour", "Hide the banner for the rehearsal at Woodshed". */
export function dayOfDismissLabel(item: DayOfItem): string {
  if (item.kind === "show") return `Hide the banner for ${item.title}`;
  return `Hide the banner for the rehearsal${item.title ? ` at ${item.title}` : ""}`;
}

/** Stored dismissals worth keeping: those whose date is within a week of `today` (older ones can never show again). */
export function pruneDismissed(keys: readonly string[], today: string): string[] {
  const oldest = addDays(today, -7);
  return keys.filter((k) => (k.split(":")[2] ?? "") >= oldest);
}

/** True once a show's row is the after-show invite: an hour after its last time. A show with no times never is (it is "Today" all day). */
export function dayOfAfter(item: DayOfItem, now: number): boolean {
  const last = item.points[item.points.length - 1];
  return item.kind === "show" && !!last && now >= last.at + DAY_OF_AFTER_MS;
}

/** "the Deep End show", "the Red Barn show" (not "the The Red Barn"), "the house concert". */
function theShow(item: DayOfItem): string {
  return item.title.startsWith("House concert") ? "the house concert" : `the ${item.title.replace(/^the\s+/i, "")} show`;
}
/** The after-show row: "Congrats on the Deep End show!" */
export const dayOfCongrats = (item: DayOfItem) => `Congrats on ${theShow(item)}!`;
/** What the after-show row sends to Roadie for you: "Ask me about the Deep End show". */
export const dayOfAsk = (item: DayOfItem) => `Ask me about ${theShow(item)}`;
