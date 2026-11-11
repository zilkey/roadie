/**
 * Acts (issue #77), the pure half shared by the server and the pages: which bill names are acts at all (and their clean name),
 * and what venue calendars say about each act (rooms, next show, opened at our rooms, on tour).
 */
import { actKey } from "@/schema/normalize";
import type { ActRelationship } from "@/schema/acts";

// ---------- names ----------

/** Things on a bill that are an event, not a band: open mics, jams, talks, parties, series. Whole words, any case. */
const EVENT_WORDS = new RegExp(String.raw`\b(?:${[
  "open mic", "open decks", "open pick", "open sing", "open jam", "jam session", "jazz jam", "bluegrass jam", "blues jam", "old-time jam", "pickers",
  "karaoke", "trivia", "bingo", "comedy", "improv", "drag", "burlesque", "cabaret", "lucha", "magic show", "poetry", "poletry",
  "author", "authors", "talks?", "reading", "lecture", "workshop", "class", "lessons?", "screening", "film", "filmmakers?", "movie",
  "party", "parties", "dance party", "disco", "social", "mixer", "meetup", "support group", "language exchange", "craft", "sip", "puzzles?",
  "dinner", "brunch", "happy hour", "tasting", "market", "sale", "art show", "gallery", "galleries",
  "kids", "family", "families", "all ages", "sing along", "singalong", "residency", "series", "sessions", "showcase", "festival", "fest",
  "benefit", "fundraiser", "charity", "celebration", "spectacular", "anniversary", "gala", "vip",
  "night", "nights", "evening", "every", "weekly", "mondays", "tuesdays", "wednesdays", "thursdays", "fridays", "saturdays", "sundays",
  "christmas", "holiday", "holidays", "new year'?s", "nye", "halloween", "thanksgiving", "friendsgiving", "solstice", "krampus",
  "live music", "local music", "music in the", "tour", "history", "geology", "welcomes", "presents", "hosted by", "and more", "& more", "tba", "tbd",
  "mixtape", "industry", "on tap", "tap house", "meet-?up", "meet up", "rave", "toy drive", "blood drive", "mahjongg", "crawl", "community event",
  "event hall", "discussion", "bogo", "mimosas", "wine", "high tea", "deal", "open house", "storyslam", "writing", "podcasts?", "songwriters at",
  "unplugged at", "first friday", "birthday", "bash", "run", "trail of lights", "pony rides", "nutcracker", "warren miller", "battle of the bands",
  "dance company", "concert", "annual", "album release", "release party", "release show",
].join("|")})\b`, "i");

/** Bits of a bill that name no act at all. */
const FILLER = /^(?:with|w\/|and|&|\+|plus|feat\.?|featuring|ft\.?|very special guests?|special guests?|musical guests?|guests?|support|more|and more|& more|tba|tbd|very|live|presents|music|closed|event|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?)$/i;
/** "with Seven Suns", "and Mercy Club": the name after it is the act. */
const JOINER = /^(?:with|w\/|and|&|\+|plus|feat\.?|featuring|ft\.?)\s+/i;
const LEADS_WITH_FILLER = /^(?:very special|special guests?|musical guests?)\b/i;
const DATE = /\b\d{1,2}\/\d{1,2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?\b|\b20\d\d\b/i;
/** After "Name: " or "Name - ", words that make the rest a show's subtitle, so the name before it is the act. */
const SUBTITLE = /\b(?:tour|years?|anniversary|live|tribute|tributes|experience|album|release|holiday|christmas|show|nights?|returns?|acoustic|solo|duo|trio|in concert)\b|\d/i;
/** "LIVE at the Lodge - Denson": a room's own series prefix. */
const SERIES_PREFIX = /^live at (?:the )?[\w' ]+? [-–] /i;
const MAX_WORDS = 8, MAX_LEN = 48;

export type ActName = { name: string; key: string } | { drop: string };

/**
 * A bill name as an act: the name to keep ("BJ Barham (of American Aquarium)" → "BJ Barham", "Key Glock - Big5 Live!" → "Key Glock")
 * and its matchKey, or why it is not an act ("Open Mic Night", "& More!", "Fridays)", "Deer Creek Sharpshooters (11/27) and …").
 * A lineup still in one string ("JAMØ – Earl Grey – Crisco") is dropped, not guessed at: splitting bills is the refresh's job (bill.ts).
 */
export function cleanActName(raw: string): ActName {
  let s = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!s) return { drop: "empty" };
  const opens = (s.match(/[([]/g) ?? []).length, closes = (s.match(/[)\]]/g) ?? []).length;
  if (opens !== closes) return { drop: "cut off" };
  if (DATE.test(s)) return { drop: "a date" };
  s = s.replace(JOINER, "");
  if (FILLER.test(s.replace(/[!.,…]+$/, "")) || LEADS_WITH_FILLER.test(s)) return { drop: "not a name" };
  s = s.replace(SERIES_PREFIX, "");
  // Trailing qualifiers: "(Indoors)", "(solo)", "(of Leprous)", "(DJ set)".
  s = s.replace(/(?:\s*[([][^)\]]*[)\]])+\s*$/, "").trim();
  if (/[([]/.test(s)) return { drop: "not a name" };
  const dashes = s.split(/\s+[-–—]\s+/);
  if (dashes.length > 2) return { drop: "a lineup in one name" };
  if (dashes.length === 2) s = dashes[0];
  const colon = /^(.+?)\s*:\s+(.+)$/.exec(s);
  if (colon) {
    if (!SUBTITLE.test(colon[2])) return { drop: "a show title" };
    s = colon[1];
  }
  s = s.replace(/[!,;]+$/, "").trim();
  if (!s || FILLER.test(s)) return { drop: "not a name" };
  if (EVENT_WORDS.test(s)) return { drop: "an event, not an act" };
  if (s.length > MAX_LEN || s.split(" ").length > MAX_WORDS) return { drop: "too long for a name" };
  const key = actKey(s);
  if (!key) return { drop: "not a name" };
  return { name: s, key };
}

// ---------- what venue calendars say ----------

export interface EvLike { id: string; venueId: string; date: string; status: string; acts: { name: string; role: string; actId?: string }[] }
export interface VenueLike { id: string; name: string; address?: { city?: string; state?: string } }
export interface Room { venueId: string; name: string; city?: string; roles: ("headliner" | "support")[] }
export interface ActStats {
  /** Every room they're on a calendar at, past or upcoming. */
  rooms: Room[];
  next?: { date: string; venueId: string; name: string; role: "headliner" | "support"; eventId: string };
  /** The rooms they played support at that are on this band's list. */
  openedAt: string[];
  /** 2+ Colorado rooms within TOUR_DAYS, from today on. */
  tour: boolean;
  cities: string[];
}
export const TOUR_DAYS = 28;

const roleOf = (r: string): "headliner" | "support" => (r === "support" ? "support" : "headliner");
const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;

/**
 * Per act: the rooms it's on a calendar at, its next show, the rooms on our list it opened at (`ours`: venue ids the band has notes,
 * a pitch or a show at), whether it's on tour, and its cities. Gone shows (off the calendar) don't count.
 */
export function actStats(events: EvLike[], venues: Map<string, VenueLike>, ours: Set<string>, today: string): Map<string, ActStats> {
  const out = new Map<string, ActStats>();
  const coDays = new Map<string, { day: number; venueId: string }[]>();
  for (const e of [...events].sort((a, b) => a.date.localeCompare(b.date))) {
    if (e.status === "gone") continue;
    const v = venues.get(e.venueId);
    if (!v) continue;
    for (const a of e.acts) {
      if (!a.actId) continue;
      let s = out.get(a.actId);
      if (!s) out.set(a.actId, (s = { rooms: [], openedAt: [], tour: false, cities: [] }));
      const role = roleOf(a.role);
      let room = s.rooms.find((r) => r.venueId === e.venueId);
      if (!room) s.rooms.push((room = { venueId: e.venueId, name: v.name, city: v.address?.city, roles: [] }));
      if (!room.roles.includes(role)) room.roles.push(role);
      if (role === "support" && ours.has(e.venueId) && !s.openedAt.includes(e.venueId)) s.openedAt.push(e.venueId);
      if (v.address?.city && !s.cities.includes(v.address.city)) s.cities.push(v.address.city);
      if (e.date >= today && e.status !== "cancelled") {
        if (!s.next) s.next = { date: e.date, venueId: e.venueId, name: v.name, role, eventId: e.id };
        if ((v.address?.state ?? "").toUpperCase() === "CO") coDays.set(a.actId, [...(coDays.get(a.actId) ?? []), { day: dayNum(e.date), venueId: e.venueId }]);
      }
    }
  }
  for (const [id, days] of coDays) {
    const s = out.get(id)!;
    s.tour = days.some((d, i) => days.slice(i + 1).some((x) => x.venueId !== d.venueId && x.day - d.day <= TOUR_DAYS));
  }
  return out;
}

/** "Aggie Theatre (opening) · Bluebird Theater (headlining)". */
export const roomsLine = (rooms: Room[]) => rooms.map((r) => `${r.name} (${r.roles.length === 2 ? "headlining, opening" : r.roles[0] === "support" ? "opening" : "headlining"})`).join(" · ");

export type ActFilter = "shortlist" | "opened" | "tour" | "all";
export const ACT_FILTERS: [ActFilter, string][] = [["shortlist", "Shortlist"], ["opened", "Opened at our rooms"], ["tour", "On tour"], ["all", "All acts"]];

export interface ActTake { shortlist?: boolean; relationship?: ActRelationship | string; note?: string }
/**
 * Whether an act is on the list for a filter, a city and a search. "Not a fit" acts are hidden unless searched for by name.
 */
export function actListed(a: { name: string }, s: ActStats | undefined, take: ActTake | undefined, f: { filter: ActFilter; city?: string; q?: string }): boolean {
  const q = f.q?.trim().toLowerCase();
  if (q && !a.name.toLowerCase().includes(q)) return false;
  if (!q && take?.relationship === "notFit") return false;
  if (f.city && !s?.cities.includes(f.city)) return false;
  if (f.filter === "shortlist") return !!take?.shortlist;
  if (f.filter === "opened") return !!s?.openedAt.length;
  if (f.filter === "tour") return !!s?.tour;
  return true;
}
