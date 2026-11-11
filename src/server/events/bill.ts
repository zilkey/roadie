/**
 * The shared step after every reader: titles split into acts, non-music dropped, "support TBA" spotted. Plain rules, no model.
 * Most calendars pack the bill into the title ("Headliner w/ Support + Other", "Headliner with special guests"); only AEG,
 * Plot and venue.network have a real support-act field.
 */
import type { Act } from "@/schema";

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "’").replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&#8211;|&ndash;/g, "–").replace(/&#8212;|&mdash;/g, "—").replace(/&nbsp;|&#160;/g, " ");
/** One line, decoded, no stray tags or emoji-only decoration. */
export const cleanTitle = (s: string) => decode(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** A support act still to be announced: "special guests", "support TBA", "+ more". */
const TBA = /\b(?:special\s+guests?|support(?:ing acts?)?\s*(?::\s*)?(?:tba|tbd|to be announced)|guests?\s+tb[ad]|openers?\s+tb[ad]|tb[ad]|\+\s*more|and more|& more|more to be announced)\b/i;

/** "special guest(s)" or "musical guest(s)" followed by a name (not "TBA", "and more"). */
const GUEST = /(?:\s+(?:with|w\/|\+|&|and|plus)\s*|\s+|^)(?:very\s+)?(?:special|musical)\s+guests?\s*:?\s+(?!(?:tba|tbd|to be announced|and|&|more|\+|to)\b)(?=[\p{L}\p{N}])/iu;
/** "Trace Bundy 18th Annual Acoustic Holiday": the event's name after the act. */
const ANNUAL = /^(\S+(?:\s+\S+)+?)\s+\d+(?:st|nd|rd|th)\s+annual\b.*$/i;
/** "Deer Creek Sharpshooters (11/27) and Tonewood (11/28)": one act per night of a run. */
const PER_NIGHT = /\s*\(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\)\s*(?:,|and|&|\+)?\s*/i;

/** Words that mean the title is not a band's name: dropped before splitting. */
const PREFIX = /^(?:.*?\bpresents?\s*[:\-–—]?\s+|.{0,40}?\blive music\s*[:\-–—|]\s+|an evening (?:with|of)\s+|a night (?:with|of)\s+|live music(?: with| by|:|\s*[-–—])?\s+|music by\s+|live(?::|\s*[-–—])\s+|(?:free\s+)?(?:live\s+)?music\s*[:\-–—]\s+)/i;
/** A date written before the act: "Nov 4 – Lid Dixon", "Fri 11/14: ...". */
const LEAD_DATE = /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)(?:,?\s+\d{4})?\s*[-–—:|]\s+/i;
/** Tour names, release parties, ages and prices that follow the act. */
const TAIL = [
  /\s*[(\[](?:[^)\]]*\b(?:tour|release|album|ep|single|anniversary|celebration|show|ages|all ages|21\+|18\+|free|tickets?|sold out|night \d|two nights?|two-day|early|late|matinee|cd|solo|acoustic|dj set|afters)\b[^)\]]*)[)\]]\s*/gi,
  /\s*[-–—:|]\s*(?:the\s+)?[^-–—:|]*\b(?:tour|album release|ep release|release (?:show|party)|record release|anniversary|celebration)\b[^]*?(?=\s+(?:w\/|with|featuring|feat\.?|ft\.?|plus|\+)\s+|$)/i,
  // "Foy Vance World Tour | 2026": a named tour after the act
  /\s+(?:(?:the|world|north american|american|us|u\.s\.|european|fall|spring|summer|winter|farewell|reunion|anniversary|headline|headlining|\d{4})\s+)+tour\b.*$/i,
  /\s*[-–—|]\s*(?:all ages|21\+|18\+|free(?: show)?|sold out|\$\d.*)$/i,
  // "Assembly of Dust | Reid Genauer's Epic Two-Night Stand"
  /\s*[-–—|:]\s*[^-–—|:]*\b(?:two|three|four|\d)[- ]night\b.*$/i,
];
/** Between headliner and support. */
const WITH = /\s+(?:w\/|w\.|w|with|featuring|feat\.?|ft\.?|support(?:ed)? by|special guests?:?|plus|\+)\s+|\s+w\/\s*|\s*[|]\s*/i;
/** Between acts in a list. Not "&" or "and": too many band names have them ("Mumford & Sons"). */
const LIST = /\s*(?:,|\s\+\s|\s\/\s|•|·)\s*/;

const CANCELLED = /\s*[(\[]?\b(?:cancell?ed|postponed|rescheduled)\b[)\]]?\s*[:\-–—]?\s*/gi;
const notAnAct = (s: string) => !s || s.length < 2 || TBA.test(s) || /^(?:and|more|guests?|friends|tba|tbd|special guests?|the|(?:&\s*|and\s+)?(?:guest musicians|friends))$/i.test(s) || /^\$?\d+(?:\.\d+)?$/.test(s);
const tidy = (s: string) => s.replace(/^[\s"“”'’:;,.\-–—]+|[\s"“”'’:;,\-–—]+$/g, "").replace(/\s+/g, " ").trim();

export interface Bill { acts: Act[]; supportTba: boolean }

/** Split a title into acts: the first is the headliner; after "w/", "with", "+", the supports. */
export function splitTitle(raw: string): Bill {
  // "w/ Special Guest Forest Bailey", "+ Special Guests Kiss Bang", "with very special guest Andy McKee", "with musical guest
  // lighthearted": a named guest is a support act, not a TBA.
  let t = cleanTitle(raw).replace(GUEST, " with ").replace(/^\s*with\s+/i, "");
  const supportTba = TBA.test(t);
  t = t.replace(CANCELLED, " ").trim().replace(LEAD_DATE, "").replace(PREFIX, "").replace(/^[\s*•·]+/, "");
  for (const re of TAIL) t = t.replace(re, " ");
  t = t.replace(/\b(?:with\s+)?special\s+guests?\b.*$/i, "").replace(TBA, "").trim();
  const at = WITH.exec(t);
  const head = tidy(at ? t.slice(0, at.index) : t).replace(ANNUAL, "$1");
  const rest = at ? t.slice(at.index + at[0].length) : "";
  const acts: Act[] = [];
  const seen = new Set<string>();
  const add = (name: string, role: Act["role"]) => {
    const n = tidy(name.replace(/\s+(?:&|and)\s+(?:guest musicians|friends)$/i, ""));
    if (notAnAct(n) || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    acts.push({ name: n, role });
  };
  // "A / B / C" with no "with": a co-bill, roles unknown beyond the first.
  const coBill = !at && LIST.test(head) && head.split(LIST).length > 1;
  if (coBill) head.split(LIST).forEach((n, i) => add(n, i === 0 ? "headliner" : "support"));
  else add(head, "headliner");
  for (const n of rest.split(new RegExp(`${LIST.source}|${WITH.source}`, "i"))) {
    if (PER_NIGHT.test(n)) n.split(PER_NIGHT).forEach((x) => add(x, "support"));
    else add(n, "support");
  }
  return { acts, supportTba };
}

/** An act's name without tour names, "(CANCELLED)" and the like. */
export function cleanActName(raw: string): string {
  let t = cleanTitle(raw).replace(CANCELLED, " ");
  for (const re of TAIL) t = t.replace(re, " ");
  return tidy(t);
}

/** Acts a source named itself, tidied, with the title's TBA hint. */
export function billFromActs(acts: Act[], title: string): Bill {
  const seen = new Set<string>();
  const out: Act[] = [];
  for (const a of acts) {
    const n = cleanActName(a.name);
    if (notAnAct(n) || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push({ name: n, role: a.role });
  }
  return { acts: out, supportTba: TBA.test(cleanTitle(title)) };
}

/**
 * A source's own acts, checked against its title. Some list the lineup in set order (openers first) or leave an act out;
 * when the title names every listed act, the title's order and roles win (and its spelling).
 */
export function reconcileActs(source: Act[], title: string): Bill {
  const fromSource = billFromActs(source, title), fromTitle = splitTitle(title);
  const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const titleKeys = new Set(fromTitle.acts.map((a) => key(a.name)));
  if (fromTitle.acts.length > 1 && fromSource.acts.every((a) => titleKeys.has(key(a.name)))) return { acts: fromTitle.acts, supportTba: fromSource.supportTba || fromTitle.supportTba };
  return fromSource;
}

/** Not music: trivia, yoga, markets... The calendar's own include/exclude filter runs as well. */
const NOT_MUSIC = /\b(?:trivia|yoga|bingo|karaoke|paint(?:ing)?\s*(?:&|and|n)?\s*sip|sip\s*(?:&|and|n)\s*paint|craft(?:ing)? night|market|bazaar|brunch|workshop|class(?:es)?|lesson|meeting|book club|run club|running club|tasting|pairing|comedy|comedian|stand-?up|improv|drag (?:show|brunch|bingo)|movie|film screening|screening|game night|board games|trivia|puzzle|auction|fundraiser gala|private (?:event|party)|closed for|we(?:'| a)re closed|holiday hours|rental|wedding|lecture|talk:|panel|poetry|storytime|story time|kids craft|bootcamp|fitness|5k|10k|race|ted ?x|magic show|burlesque|wrestling|watch party|football|bike ride|group ride|sauna|hike|wildlife|nature walk|garden tour|cooking|members? (?:night|event)|nfl|super bowl|drawing club|meet ?up|happy hour|science on tap|artist talk|talk series|ya?rt sale|yard sale)\b|^(?:happy|merry) [a-z]+!*$/i;
const IS_MUSIC = /\b(?:live music|concert|band|music|songwriter|singer|dj\b|jazz|bluegrass|folk|rock|blues|americana|country|jam|acoustic|orchestra|quartet|trio|duo|open mic|album|ep release|tour)\b/i;

const LIVE = /\b(?:live music|concert|band|bluegrass|jazz|songwriter|acoustic|dj|album release|ep release|record release)\b/i;

/** True when the event looks like music. Tags that say music win over a word in the title. */
export function isMusic(title: string, tags: string[] = [], description = ""): boolean {
  const tagText = tags.join(" ");
  if (tagText && IS_MUSIC.test(tagText) && !NOT_MUSIC.test(tagText)) return true;
  // "Live music in the tasting room": a word for music in the title wins.
  if (NOT_MUSIC.test(title)) return LIVE.test(title);
  if (tagText && NOT_MUSIC.test(tagText)) return false;
  if (!description) return true;
  return !(NOT_MUSIC.test(description.slice(0, 300)) && !IS_MUSIC.test(`${title} ${description.slice(0, 300)}`));
}

