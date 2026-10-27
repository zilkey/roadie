import { routeNames, routeForRecord, type RouteName } from "@/lib/routes";
import { BAND_SETTINGS } from "./policy";
import { topicInWords } from "@/lib/help";

/**
 * The canned model's brain: what it decides for one turn, from the user's words and the tool results so far. Pure and
 * deterministic. It reads the user's text and the ids in tool results, never the text inside records (that is data).
 */
export interface Call { name: string; input: unknown }
export interface Step { name: string; input: unknown; output: unknown }
export type Scripted = { text?: string; calls?: Call[] };

export const OFF_TOPIC = "I just haul the band's stuff. Ask me about shows, tours or money.";
export const CANT_DO = "I can't do that. I don't know that tune.";
export const NOT_YET = "Not in my road case yet. I wrote it down.";
export const NO_PEOPLE = "I can't do that. I don't know that tune: invites and access stay with you, on the People page. Want me to take you there?";
/** Sending a stage plot by email isn't built (V1: download the PDF and attach it yourself, or share the engineer link). No tool call. */
export const PLOT_NOT_SENT = "I can't send a stage plot yet. Download the PDF from the plot (or the show's Stage plot card) and attach it to your email, or I can get you the engineer link.";
export const TAP_YES = "Tap Yes to go ahead, or Cancel.";
/** How Roadie opens a question it can't place (ui.ask). */
export const BAD_FINDER = "I could just be a bad finder, but I don't know what you mean.";
export const CALENDAR_OPTIONS = ["A pitch's next step", "A possible date on a pitch", "A hold show"];

// Page words -> named route. First match wins, so "ai keys" is checked before "keys".
const PAGES: [RegExp, RouteName][] = [
  [/\bpitch(?:es| list)\b/, "bookingPitches"], [/\bmoney\b|\bexpenses?\b/, "money"], [/\bshows\b/, "shows"], [/\bbooking\b/, "booking"], [/\bsongs\b/, "songs"],
  [/\bhistory\b/, "history"], [/\bhome\b/, "calendar"], [/\bmusicians\b|\busers\b|\bpeople\b/, "people"],
  [/\bartist\b/, "artist"],
];
const GO = /^(?:please |can you |could you )?(show me|take me to|take me|go to|open|pull up|navigate to)\s+(?:the |my |a )?(.+?)(?: page| tab)?[.!?]*$/;
const KIND_WORDS: Record<string, string> = { venue: "venue", pitch: "pitch", song: "song", promoter: "promoter", festival: "festival", contact: "contact" };
// Invites, access and feature switches belong to the person. "turn off the calendar for Saturday" (shows.calendar), "take X off the calendar" and "make a checklist" must not match.
const FORBIDDEN = new RegExp([
  String.raw`\binvit\w*`, String.raw`\b(ai|api) keys?\b`, String.raw`\bgive\b.*\b(access|admin)\b`, String.raw`\bchange\b.*\brole\b`,
  String.raw`\bdelete the band\b`, String.raw`\bturn (on|off)\b.*\bfeatures?\b`, String.raw`\bturn (on|off) (?:the )?(setlists|rehearsals|stats|booking|songs|money|sections?)\b(?! for\b)`, String.raw`\bremove\b.*\b(user|log ?in|access)\b`,
  String.raw`\bmake\b.*\badmin\b`, String.raw`\bmake\s+(?!a\b|an\b|the\b)\w+\s+(?:an? )?standard\b`,
  String.raw`\blet\b.*\b(log|sign) ?in\b`, String.raw`\bdemote\b`, String.raw`\bpromote\b.*\badmin\b`,
].join("|"));
// "rename the band", "change our URL": the person does these on General settings.
// Questions about the app itself, not its data: "what's on the pitch list?" stays a data question.
const EXPLAIN = /^(?:please |can you |could you )?(explain|help me understand|what am i looking at|tell me about|how do(?:es)? .*\bwork)\b|^what\b.*\b(mean|means|this page|this tab|a pitch|pitch statuses|statuses|shared|flag)\b/;
const THIS_PAGE = /\b(this page|this tab|this screen|what am i looking at|here)\b|^explain this\b/;
// "search the web for X", "google X", "look up X online" -> web.search. "read https://..." -> web.read.
const WEB_SEARCH = /^(?:please |can you |could you )?(?:search the web for|google|look up online)\s+(.+?)[.!?]*$|^(?:please |can you |could you )?(?:look up|check|find)\s+(.+?)\s+(?:online|on the web)[.!?]*$/;
const WEB_READ = /^(?:please |can you |could you )?read\s+(https:\/\/\S+?)[.!?]*$/i;
const BAND_RENAME = /\b(rename|change|update)\b.*\b(band'?s? name|name of the band|(?:our |the |band )?(?:url|web ?address))\b|\brename (?:the|our) band\b/;

export const unwrap = (o: unknown): any => (o as { untrustedContent?: unknown } | null)?.untrustedContent ?? o; // eslint-disable-line @typescript-eslint/no-explicit-any
const errorOf = (o: unknown): string | undefined => {
  const e = (o as { error?: unknown } | null)?.error;
  return typeof e === "string" ? e : (e as { message?: string } | undefined)?.message;
};

const hhmm = (h: number, m: number, ap?: string) => {
  const hour = ap === "am" ? h % 12 : ap === "pm" ? (h % 12) + 12 : h >= 1 && h <= 11 ? h + 12 : h; // a load-in with no am/pm is afternoon
  return `${String(hour).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
const category = (what: string) =>
  /\b(gas|fuel|parking|van|hotel|motel|toll|tolls|flight|uber)\b/.test(what) ? "travel" : /\b(strings?|cables?|gear|pedal|drum ?heads?|amp)\b/.test(what) ? "gear" : "other";

type Page = { kind?: string; id?: string; route?: string; tab?: string };

// "How many shows were canceled?" -> shows.list with that filter. Checked before the cancel command.
const FILTER_WORDS: [RegExp, string][] = [[/\bcancel(?:l?ed)?\b/, "canceled"], [/\bplayed\b/, "played"], [/\bdropped\b/, "dropped"], [/\b(upcoming|coming up)\b/, "upcoming"]];
const ASKS_LIST = /^(how many|which|what|list|any)\b/;
const FILTER_SAID: Record<string, string> = { upcoming: "coming up", played: "played", canceled: "canceled", dropped: "dropped" };

// "Oskar Blues canceled, they double-booked the patio." / "We're dropping the Drifters show, the money's not there." -> search, then cancel/drop with the reason.
const CANCELED = /^(.+?)\s+(?:canceled|cancelled|called it off)\s*(?:[,:;-]\s*(.*))?$/;
const DROPPING = /^we(?:['’]re| are)? (?:dropping|pulling out of)\s+(.+?)\s*(?:[,:;-]\s*(.*))?$/;
// "Why did we cancel Gold Hill?" -> search, records.get, read back the reason.
const WHY = /^why (?:did|was|were) (?:we |it |they )?(?:cancel(?:l?ed)?|drop(?:ped)?)\s+(.+?)[.!?]*$/;
const clip = (s?: string) => s?.replace(/[.!?]+$/, "").trim() || undefined;
const showQuery = (s: string) => s.replace(/\b(the|this|show|gig)\b/g, "").replace(/\s+/g, " ").trim();
/** What the person asked to do to a show by name, from their words: cancel or drop, with the reason they gave. */
function offIntent(t: string): { name: "shows.cancel" | "shows.drop"; q: string; reason?: string } | undefined {
  const d = DROPPING.exec(t);
  if (d) return { name: "shows.drop", q: showQuery(d[1]), reason: clip(d[2]) };
  const c = CANCELED.exec(t);
  if (c && !/^(how many|which|what|why)\b/.test(t)) return { name: "shows.cancel", q: showQuery(c[1]), reason: clip(c[2]) };
  return undefined;
}
/** The reason as the person wrote it (case kept). */
function reasonIn(raw: string, lower?: string) {
  if (!lower) return undefined;
  const i = raw.toLowerCase().lastIndexOf(lower);
  return i < 0 ? lower : clip(raw.slice(i, i + lower.length));
}

export function script(input: { text: string; steps?: Step[]; page?: Page }): Scripted {
  const raw = input.text.trim();
  const t = raw.toLowerCase();
  const steps = input.steps ?? [];
  return steps.length ? followUp(t, steps, input.page, raw) : first(t, input.page, raw);
}

function first(t: string, page?: Page, raw = t): Scripted {
  if (/^(hi|hey|hello|yo|sup|howdy|good (morning|evening))\b/.test(t)) return { text: "Hey. Roadie here. Shows, tours, money: what do you need?" };
  if (BAND_RENAME.test(t)) return { text: BAND_SETTINGS }; // before CANT_DO: no tool call
  if (FORBIDDEN.test(t)) return { text: NO_PEOPLE }; // no tool call at all
  const read = WEB_READ.exec(raw);
  if (read) return { calls: [{ name: "web.read", input: { url: read[1] } }] };
  if (/\b(send|email|mail)\b.*\b(stage ?plot|plot)\b/.test(t)) return { text: PLOT_NOT_SENT };
  if (/\bwho\b.*\b(still )?needs? the (new|latest|updated) (stage )?plot\b/.test(t)) return { calls: [{ name: "stagePlots.staleShows", input: {} }] };
  if (/\bhow many inputs\b/.test(t)) return { calls: [{ name: "stagePlots.list", input: {} }] };
  const ws = WEB_SEARCH.exec(t);
  if (ws) return { calls: [{ name: "web.search", input: { q: (ws[1] ?? ws[2]).trim() } }] };
  const listed = ASKS_LIST.test(t) && /\b(shows?|gigs?)\b/.test(t) ? FILTER_WORDS.find(([re]) => re.test(t)) : undefined;
  if (listed) return { calls: [{ name: "shows.list", input: { filter: listed[1] } }] };
  if (/\bundo\b/.test(t)) return { text: "On it.", calls: [{ name: "history.undoRun", input: /\b(everything|all|tonight|conversation)\b/.test(t) ? { all: true } : {} }] };

  // "Explain this page" / "what's a pitch?" -> help.explain: this page, or the topic they named.
  if (EXPLAIN.test(t)) {
    const named = THIS_PAGE.test(t) ? undefined : topicInWords(t);
    if (named || THIS_PAGE.test(t)) return { calls: [{ name: "help.explain", input: named ? { topic: named.id } : {} }] };
  }

  const exp = /\badd\s+(?:\$\s?(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:dollars?|bucks))\s*(?:for |of |in |on )?(.*)$/.exec(t);
  if (exp) {
    const what = exp[3].replace(/[.!?]+$/, "").trim() || "expense";
    return { calls: [{ name: "expenses.add", input: { amount: Math.round(parseFloat(exp[1] ?? exp[2]) * 100), what, category: category(what) } }] };
  }

  const mv = /\bmove (?:the )?load[- ]?in\s*(?:at |for |on )?(.*?)\s*to\s+(\d{1,2})(?::(\d\d))?\s*(am|pm)?\b/.exec(t);
  if (mv) {
    const q = mv[1].replace(/\b(the|show)\b/g, "").trim();
    if (!q && page?.kind === "show" && page.id) return { calls: [{ name: "records.get", input: { kind: "shows", id: page.id } }] };
    if (!q) return { text: "Which show? I won't guess on a time." };
    return { text: "On it.", calls: [{ name: "search", input: { q, kinds: ["show"] } }] };
  }

  const why = WHY.exec(t);
  if (why) return { calls: [{ name: "search", input: { q: showQuery(why[1]), kinds: ["show"] } }] };
  const off = offIntent(t);
  if (off) return off.q ? { calls: [{ name: "search", input: { q: off.q, kinds: ["show"] } }] } : { text: "Which show? I won't guess on that." };

  if (/\bcancel\b/.test(t)) {
    const q = t.replace(/^.*?\bcancel\b/, "").replace(/\b(the|this|show)\b/g, "").replace(/[.!?]+$/, "").trim();
    if (!q && page?.kind === "show" && page.id) return { calls: [{ name: "shows.cancel", input: { id: page.id } }] };
    if (!q) return { text: "Which show? I won't guess on a cancel." };
    return { calls: [{ name: "search", input: { q, kinds: ["show"] } }] };
  }

  if (/\bpay (everyone|everybody|the band|all)\b/.test(t)) {
    return { text: "Roadie doesn't track payouts right now. Enter the show's income on its Finances tab." };
  }

  const go = GO.exec(t);
  if (go) {
    const page2 = PAGES.find(([re]) => re.test(go[2]));
    if (page2) return { text: "On it.", calls: [{ name: "ui.navigate", input: { route: page2[1] } }] };
    const kind = Object.keys(KIND_WORDS).find((k) => new RegExp(`\\b${k}\\b`).test(go[2]));
    const q = go[2].replace(/\b(venue|pitch|song|promoter|festival|contact|show|page|tab|the)\b/g, "").replace(/\s+/g, " ").trim();
    if (q) return { text: "On it.", calls: [{ name: "search", input: { q, ...(kind ? { kinds: [kind] } : {}) } }] };
    return { text: "On it.", calls: [{ name: "ui.navigate", input: { route: go[2].replace(/\W+/g, "-") } }] };
  }
  // "Put a deadline on the calendar for Dec 5": a calendar thing could be several things here. Ask, don't guess.
  if (/\b(?:on|in|to|into) (?:the |my |our )?calendar\b|\bremind me\b/.test(t)) {
    return { calls: [{ name: "ui.ask", input: { question: `${BAD_FINDER} Did you want:`, options: CALENDAR_OPTIONS } }] };
  }
  if (/\b(delete|remove|send|pay|email|add|change|move|book|play|write|create)\b/.test(t)) return { text: CANT_DO };
  if (/\b(show|shows|gig|tour|money|song|setlist|rehearsal|load[- ]?in|band)\b/.test(t)) return { text: NOT_YET };
  return { text: OFF_TOPIC };
}

const COLLECTION: Record<string, string> = { show: "shows", venue: "venues", promoter: "promoters", festival: "festivals", edition: "editions", contact: "contacts", pitch: "pitches", song: "songs" };
type Hit = { kind: string; id: string; name: string };
function pick(hits: Hit[], prefer: string[]): Hit | undefined {
  for (const k of prefer) { const h = hits.find((x) => x.kind === k); if (h) return h; }
  return undefined;
}

function followUp(t: string, steps: Step[], page?: Page, raw = t): Scripted {
  const last = steps[steps.length - 1];
  const err = errorOf(last.output);
  const out = unwrap(last.output);
  if ((last.output as { needsConfirmation?: boolean } | null)?.needsConfirmation) return { text: TAP_YES };

  if (last.name === "ui.navigate") return { text: err ? "I can't do that. I don't know that page." : "There you go." };
  if (last.name === "help.explain") {
    if (err) return { text: `Couldn't do that: ${err}` };
    if (out?.topic) return { text: out.topic.text };
    return { text: `I don't have a write-up for this page yet. I can explain: ${((out?.topics ?? []) as { title: string }[]).map((x) => x.title).join(", ")}.` };
  }
  if (last.name === "history.undoRun") return { text: err ? "Nothing of mine to undo here." : "Undone." };
  // Web results are named by their links, never by their text (strangers wrote it).
  if (last.name === "web.search") {
    if (err) return { text: `Couldn't search: ${err}` };
    const local = (out?.local ?? []) as Hit[];
    const src = ((out?.web?.sources ?? []) as { url: string }[])[0];
    const book = local.length ? `In the book: ${local.slice(0, 3).map((h) => h.name).join(", ")}.` : "Nothing in the book.";
    return { text: `${book} ${src ? `The web has something: ${src.url}` : "Nothing on the web either."}` };
  }
  if (last.name === "web.read") return { text: err ? `Couldn't read it: ${err}` : `Read it: ${out?.page?.url ?? "the page"}` };

  if (last.name === "search") {
    const hits = (out?.results ?? []) as Hit[];
    if (err || !hits.length) return { text: "I can't do that. I don't know that one: nothing by that name in the book." };
    const off = WHY.test(t) ? undefined : offIntent(t);
    const wantsWhy = WHY.test(t);
    const wantsCancel = /\bcancel\b/.test(t) && !wantsWhy;
    const wantsMove = /\bmove\b/.test(t);
    if (off || wantsWhy || wantsCancel || wantsMove) {
      const shows = hits.filter((h) => h.kind === "show");
      if (shows.length !== 1) return { text: shows.length ? `Which one: ${shows.map((s) => s.name).join(" or ")}?` : "I can't find that show." };
      if (off) {
        const reason = reasonIn(raw, off.reason);
        return { calls: [{ name: off.name, input: { id: shows[0].id, ...(reason ? { reason } : {}) } }] };
      }
      return wantsCancel ? { calls: [{ name: "shows.cancel", input: { id: shows[0].id } }] } : { calls: [{ name: "records.get", input: { kind: "shows", id: shows[0].id } }] };
    }
    const asked = Object.keys(KIND_WORDS).find((k) => new RegExp(`\\b${k}\\b`).test(t));
    const h = pick(hits, asked ? [asked] : ["show", "venue", "pitch", "promoter", "festival", "edition", "contact", "song"]) ?? hits[0];
    const route = routeForRecord(COLLECTION[h.kind] ?? "");
    if (!route) return { text: `Found ${h.name}, but there's no page for it.` };
    return { text: `Found ${h.name}.`, calls: [{ name: "ui.navigate", input: { route, params: { id: h.id } } }] };
  }

  if (last.name === "stagePlots.staleShows") {
    if (err) return { text: `Couldn't do that: ${err}` };
    const rows = (out?.shows ?? []) as { name: string; date: string }[];
    if (!rows.length) return { text: "Every upcoming show has the right plot." };
    return { text: `${rows.length} show${rows.length === 1 ? " needs" : "s need"} a plot: ${rows.slice(0, 5).map((r) => `${r.name} · ${r.date}`).join(", ")}${rows.length > 5 ? `, and ${rows.length - 5} more` : ""}.` };
  }
  if (last.name === "stagePlots.list") {
    if (err) return { text: `Couldn't do that: ${err}` };
    const plots = (out?.plots ?? []) as { name: string; configurationId: string | null; summary: { inputs: number } }[];
    const word = /how many inputs (?:is|are|does|in)\s+(?:the |our )?(.+?)(?: have)?[?.!]*$/.exec(t)?.[1]?.trim();
    const hit = word ? plots.find((p) => `${p.name} ${p.configurationId ?? ""}`.toLowerCase().includes(word)) : undefined;
    return { text: hit ? `${hit.name} has ${hit.summary.inputs} inputs.` : "I don't have a stage plot by that name." };
  }

  if (last.name === "shows.list") {
    if (err) return { text: `Couldn't do that: ${err}` };
    const rows = (out?.shows ?? []) as { name: string; date: string }[];
    const n = out?.count ?? rows.length;
    const said = FILTER_SAID[out?.filter] ?? "";
    if (!n) return { text: `No shows ${said}.` };
    const named = rows.slice(0, 5).map((r) => `${r.name} · ${r.date}`).join(", ");
    return { text: `${n} show${n === 1 ? "" : "s"} ${said}: ${named}${n > 5 ? `, and ${n - 5} more` : ""}.` };
  }

  if (last.name === "context.now") {
    const unsettled = (out?.unsettledShows ?? []) as { id: string }[];
    if (!unsettled.length) return { text: "Every played show has its money in." };
    return { text: `${unsettled.length} played show${unsettled.length === 1 ? " has" : "s have"} no income entered yet.` };
  }

  if (last.name === "records.get" && WHY.test(t)) {
    if (err || !out) return { text: "I can't find that show." };
    const what = out.status === "dropped" ? "dropped" : out.status === "canceled" ? "canceled" : undefined;
    if (!what) return { text: "That show isn't canceled or dropped." };
    return { text: out.reason ? `It was ${what}: ${out.reason}` : `It was ${what}, but nobody wrote down why.` };
  }
  if (last.name === "records.get") {
    const m = /to\s+(\d{1,2})(?::(\d\d))?\s*(am|pm)?\b/.exec(t);
    if (err || !m) return { text: "I can't find that show." };
    return { calls: [{ name: "shows.update", input: { id: out.id, patch: { times: { ...(out.times ?? {}), loadIn: hhmm(Number(m[1]), Number(m[2] ?? 0), m[3]) } } } }] };
  }

  if (err) return { text: `Couldn't do that: ${err}` };
  if (last.name === "expenses.add") return { text: "Logged it." };
  if (last.name === "shows.update") return { text: "Done." };
  return { text: "Done." };
}

export const knownRouteNames: string[] = routeNames;
