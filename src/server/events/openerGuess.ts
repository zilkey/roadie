/**
 * The import's best guess at a show's opener slot (VenueEvent.openerSlot), made once, when refresh first sees an upcoming show.
 * The rules in src/lib/venueEvents.ts (openerChance) work out what they can from the listing; Sonnet gets that read, the
 * weekday, how far out it is and the room (its type, size and record) and says yes or no for each show, with a short reason.
 * Plain cases never reach the model: support already listed, cancelled, gone or past is a no.
 *
 * Without a Claude key, in fake mode (emulators, tests), or when the call fails, the rules' "likely" is the guess, so a refresh
 * never fails over it. A person's x or "+ Opener slot" is never re-guessed (refresh.ts keeps it).
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { booksOpeners, openerChance } from "@/lib/venueEvents";
import type { OpenerSlot, VenueEvent } from "@/schema";
import { modelMode } from "../assistant/ai";
import { DEFAULT_CLAUDE } from "../assistant/claude";

export type GuessShow = Pick<VenueEvent, "acts" | "bill" | "title" | "date" | "status"> & Partial<Pick<VenueEvent, "supportTba" | "nights" | "start" | "tourStops">> & { id: string };
export interface GuessRoom { name: string; type?: string; capacity?: number; city?: string; stats?: { supportShare?: number; billsSeen?: number } | null }

/** Shows per model call. */
const BATCH = 40;
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const weekday = (d: string) => WEEKDAY.format(new Date(`${d}T12:00:00Z`));
const daysOut = (today: string, d: string) => Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);

/** Which model guesses: Sonnet when there's a key and the model isn't faked; else none (the rules decide). */
export function guessModel(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (modelMode(env) === "fake" || !env.ANTHROPIC_API_KEY) return undefined;
  return env.ROADIE_OPENER_MODEL || DEFAULT_CLAUDE;
}

export const SYSTEM = [
  "You help a local Colorado band find opener (support) slots to pitch. For each upcoming show on a venue's calendar, decide",
  "whether it is likely to have an opener slot a local band could still get. Say yes only when it really is likely: a person",
  "pitches every yes, so a wrong yes wastes their time, and a wrong no just hides one show.",
  "",
  "Each show comes with what the listing says and a rules-based read (likely / maybe / unlikely, with reasons). Weigh it, but",
  "use judgment. What usually matters:",
  "- The room: clubs, theaters and listening rooms with ticketed touring headliners often add a local opener. Bars, pubs and",
  "  breweries mostly book one act a night, especially on weeknights (Monday to Thursday); a weeknight at a pub is almost",
  "  never a pitchable opener slot. The room's own record (how often its past bills had support) is strong evidence.",
  "- The show: a touring headliner with no support listed, or \"support TBA\", is the best case. Tribute, theme, DJ, karaoke,",
  "  open mic, residency, trivia, \"an evening with\" and multi-night runs don't take openers. A solo singer-songwriter's",
  "  weeknight set at a bar is not an opener slot. A headliner on a run through several Colorado rooms often needs a local opener.",
  "- Timing: 3 to 10 weeks out is the time to ask; under 2 weeks, bills are usually set.",
  "",
  "Give every show a yes or no and one short reason (under 12 words), in plain words, the way a booker would say it.",
].join("\n");

const Out = z.object({ shows: z.array(z.object({ id: z.string(), open: z.boolean(), why: z.string() })) });
/** The reply's shape, as structured output (Sonnet 5.5 refuses a forced tool call). */
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["shows"],
  properties: {
    shows: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["id", "open", "why"], properties: { id: { type: "string" }, open: { type: "boolean" }, why: { type: "string" } } },
    },
  },
};

/** The rules alone: what a show gets when the model doesn't decide it. */
export function ruleGuess(e: GuessShow, room: GuessRoom, today: string): { open: boolean; why: string } {
  const o = openerChance(e, room.stats, today);
  return { open: o.chance === "likely", why: o.reasons[0] ?? (o.chance === "likely" ? "Looks open" : "No sign of an open slot") };
}

/** Settled without the model: support listed, cancelled, gone or past. */
function plainNo(e: GuessShow, today: string): string | undefined {
  if (e.status === "cancelled") return "Cancelled";
  if (e.status === "gone") return "No longer on the venue’s calendar";
  if (e.date < today) return "Already happened";
  if (e.acts.some((a) => a.role !== "headliner")) return "Support already listed";
  return undefined;
}

/** What the model reads about one show: the listing, worked out, and the rules' read. */
export function showFacts(e: GuessShow, room: GuessRoom, today: string) {
  const o = openerChance(e, room.stats, today);
  return {
    id: e.id, date: e.date, weekday: weekday(e.date), daysOut: daysOut(today, e.date), ...(e.start ? { start: e.start } : {}),
    title: e.title, acts: e.acts.map((a) => `${a.name} (${a.role})`),
    calendarListsSupportActs: e.bill === "full", ...(e.supportTba ? { supportTba: true } : {}),
    ...((e.nights ?? 1) > 1 ? { nightsInARow: e.nights } : {}), ...((e.tourStops ?? 0) >= 2 ? { coloradoRoomsOnThisRun: e.tourStops } : {}),
    ...(e.status === "soldout" ? { soldOut: true } : {}),
    rules: { read: o.chance, reasons: o.reasons },
  };
}

export function roomFacts(room: GuessRoom) {
  const b = booksOpeners(room.stats);
  return {
    name: room.name, ...(room.type ? { type: room.type } : {}), ...(room.capacity ? { capacity: room.capacity } : {}), ...(room.city ? { city: room.city } : {}),
    booksOpeners: b === "unknown" ? "not enough past bills to say" : `${b} (${Math.round((room.stats?.supportShare ?? 0) * 100)}% of ${room.stats?.billsSeen} past bills had support)`,
  };
}

let client: Anthropic | undefined;
const getClient = () => (client ??= new Anthropic({ maxRetries: 1, timeout: 90_000 }));

/** One call: Sonnet's yes/no for these shows, by id. Throws when the reply is unusable. */
export async function askModel(model: string, room: GuessRoom, shows: GuessShow[], today: string, c: Pick<Anthropic, "messages"> = getClient()): Promise<Map<string, { open: boolean; why: string }>> {
  const prompt = `Today is ${today} (${weekday(today)}).\n\nThe venue:\n${JSON.stringify(roomFacts(room), null, 1)}\n\nIts upcoming shows:\n${JSON.stringify(shows.map((s) => showFacts(s, room, today)), null, 1)}`;
  const res = await c.messages.create({
    model, max_tokens: 8000, system: SYSTEM, output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const out = Out.parse(JSON.parse(text));
  return new Map(out.shows.map((s) => [s.id, { open: s.open, why: s.why.trim().slice(0, 140) }]));
}

/**
 * The guess for each of these shows (new to the calendar, no openerSlot yet), by id. Never throws: a show the model skipped, or
 * every show when the call fails, gets the rules' guess.
 */
export async function guessOpenerSlots(shows: GuessShow[], room: GuessRoom, today: string, opts: { now?: Date; model?: string | null; client?: Pick<Anthropic, "messages"> } = {}): Promise<Map<string, OpenerSlot>> {
  const at = (opts.now ?? new Date()).toISOString();
  const out = new Map<string, OpenerSlot>();
  const ask: GuessShow[] = [];
  for (const e of shows) {
    const no = plainNo(e, today);
    if (no) out.set(e.id, { open: false, by: "guess", why: no, at });
    else ask.push(e);
  }
  const model = opts.model === null ? undefined : opts.model ?? guessModel();
  for (let i = 0; i < ask.length; i += BATCH) {
    const batch = ask.slice(i, i + BATCH);
    let got = new Map<string, { open: boolean; why: string }>();
    if (model) {
      try { got = await askModel(model, room, batch, today, opts.client); }
      catch (e) { console.warn(`[openerGuess] ${room.name}: ${e instanceof Error ? e.message : e}; using the rules`); }
    }
    for (const e of batch) out.set(e.id, { ...(got.get(e.id) ?? ruleGuess(e, room, today)), by: "guess", at });
  }
  return out;
}
