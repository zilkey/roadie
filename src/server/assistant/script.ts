import { routeNames, routeForRecord, type RouteName } from "@/lib/routes";

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
export const NO_PEOPLE = "I can't do that. I don't know that tune: invites and access stay with you, on the Users page.";
export const TAP_YES = "Tap Yes to go ahead, or Cancel.";

// Page words -> named route. First match wins, so "ai keys" is checked before "keys".
const PAGES: [RegExp, RouteName][] = [
  [/\bmoney\b|\bexpenses?\b/, "money"], [/\bshows\b/, "shows"], [/\bbooking\b/, "booking"], [/\bsongs\b/, "songs"],
  [/\bhistory\b/, "history"], [/\bstats\b/, "stats"], [/\bhome\b/, "home"], [/\bmusicians\b/, "musicians"],
  [/\busers\b/, "users"], [/\bai keys\b/, "aiKeys"], [/\bgear\b|\bartist\b/, "artist"],
];
const GO = /^(?:please |can you |could you )?(show me|take me to|take me|go to|open|pull up|navigate to)\s+(?:the |my |a )?(.+?)(?: page| tab)?[.!?]*$/;
const KIND_WORDS: Record<string, string> = { venue: "venue", pitch: "pitch", song: "song", promoter: "promoter", festival: "festival", contact: "contact" };
const FORBIDDEN = /\binvit\w*|\b(ai|api) keys?\b|\bgive\b.*\b(access|admin)\b|\bchange\b.*\brole\b|\bdelete the band\b|\bturn (on|off)\b.*\bfeatures?\b|\bremove\b.*\buser\b/;

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

type Page = { kind?: string; id?: string };

// "How many shows were canceled?" -> shows.list with that filter. Checked before the cancel command.
const FILTER_WORDS: [RegExp, string][] = [[/\bcancel(?:l?ed)?\b/, "canceled"], [/\bplayed\b/, "played"], [/\bdropped\b/, "dropped"], [/\b(upcoming|coming up)\b/, "upcoming"]];
const ASKS_LIST = /^(how many|which|what|list|any)\b/;
const FILTER_SAID: Record<string, string> = { upcoming: "coming up", played: "played", canceled: "canceled", dropped: "dropped (holds that never confirmed)" };

export function script(input: { text: string; steps?: Step[]; page?: Page }): Scripted {
  const t = input.text.toLowerCase().trim();
  const steps = input.steps ?? [];
  return steps.length ? followUp(t, steps, input.page) : first(t, input.page);
}

function first(t: string, page?: Page): Scripted {
  if (/^(hi|hey|hello|yo|sup|howdy|good (morning|evening))\b/.test(t)) return { text: "Hey. Roadie here. Shows, tours, money: what do you need?" };
  if (FORBIDDEN.test(t)) return { text: NO_PEOPLE }; // no tool call at all
  const listed = ASKS_LIST.test(t) && /\b(shows?|gigs?)\b/.test(t) ? FILTER_WORDS.find(([re]) => re.test(t)) : undefined;
  if (listed) return { calls: [{ name: "shows.list", input: { filter: listed[1] } }] };
  if (/\bundo\b/.test(t)) return { text: "On it.", calls: [{ name: "history.undoRun", input: /\b(everything|all|tonight|conversation)\b/.test(t) ? { all: true } : {} }] };

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

  if (/\bcancel\b/.test(t)) {
    const q = t.replace(/^.*?\bcancel\b/, "").replace(/\b(the|this|show)\b/g, "").replace(/[.!?]+$/, "").trim();
    if (!q && page?.kind === "show" && page.id) return { calls: [{ name: "shows.cancel", input: { id: page.id } }] };
    if (!q) return { text: "Which show? I won't guess on a cancel." };
    return { calls: [{ name: "search", input: { q, kinds: ["show"] } }] };
  }

  if (/\bpay (everyone|everybody|the band|all)\b/.test(t)) {
    if (page?.kind === "show" && page.id) return { calls: [{ name: "payouts.pay", input: { showId: page.id, musicianId: "all" } }] };
    return { calls: [{ name: "context.now", input: {} }] };
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

function followUp(t: string, steps: Step[], page?: Page): Scripted {
  const last = steps[steps.length - 1];
  const err = errorOf(last.output);
  const out = unwrap(last.output);
  if ((last.output as { needsConfirmation?: boolean } | null)?.needsConfirmation) return { text: TAP_YES };

  if (last.name === "ui.navigate") return { text: err ? "I can't do that. I don't know that page." : "There you go." };
  if (last.name === "history.undoRun") return { text: err ? "Nothing of mine to undo here." : "Undone." };

  if (last.name === "search") {
    const hits = (out?.results ?? []) as Hit[];
    if (err || !hits.length) return { text: "I can't do that. I don't know that one: nothing by that name in the book." };
    const wantsCancel = /\bcancel\b/.test(t);
    const wantsMove = /\bmove\b/.test(t);
    if (wantsCancel || wantsMove) {
      const shows = hits.filter((h) => h.kind === "show");
      if (shows.length !== 1) return { text: shows.length ? `Which one: ${shows.map((s) => s.name).join(" or ")}?` : "I can't find that show." };
      return wantsCancel ? { calls: [{ name: "shows.cancel", input: { id: shows[0].id } }] } : { calls: [{ name: "records.get", input: { kind: "shows", id: shows[0].id } }] };
    }
    const asked = Object.keys(KIND_WORDS).find((k) => new RegExp(`\\b${k}\\b`).test(t));
    const h = pick(hits, asked ? [asked] : ["show", "venue", "pitch", "promoter", "festival", "edition", "contact", "song"]) ?? hits[0];
    const route = routeForRecord(COLLECTION[h.kind] ?? "");
    if (!route) return { text: `Found ${h.name}, but there's no page for it.` };
    return { text: `Found ${h.name}.`, calls: [{ name: "ui.navigate", input: { route, params: { id: h.id } } }] };
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
    if (!unsettled.length) return { text: "No show is waiting on payouts." };
    return { calls: [{ name: "payouts.pay", input: { showId: unsettled[0].id, musicianId: "all" } }] };
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
