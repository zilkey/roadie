import { routeNames, type RouteName } from "@/lib/routes";

/** What the canned model decides for one turn. Pure and deterministic. */
export type Scripted = { text: string } | { text?: string; navigate: { route: string; params?: Record<string, string> } };

export const OFF_TOPIC = "I just haul the band's stuff. Ask me about shows, tours or money.";
export const CANT_DO = "I can't do that. I don't know that tune.";
export const NOT_YET = "Not in my road case yet. I wrote it down.";

// Page words -> named route. First match wins, so "ai keys" is checked before "keys".
const PAGES: [RegExp, RouteName][] = [
  [/\bmoney\b|\bexpenses?\b/, "money"], [/\bshows\b/, "shows"], [/\bbooking\b/, "booking"], [/\bsongs\b/, "songs"],
  [/\bhistory\b/, "history"], [/\bstats\b/, "stats"], [/\bhome\b/, "home"], [/\bmusicians\b/, "musicians"],
  [/\busers\b/, "users"], [/\bai keys\b/, "aiKeys"], [/\bgear\b|\bartist\b/, "artist"],
];
const GO = /^(?:please |can you |could you )?(?:show me|take me to|take me|go to|open|pull up|navigate to)\s+(?:the |my |a )?(.+?)(?: page| tab)?[.!?]*$/;

/** Reply to a tool result (the navigate step) or to the user's last message. */
export function script(input: { text: string; tool?: { ok: boolean } }): Scripted {
  if (input.tool) return { text: input.tool.ok ? "There you go." : "I can't do that. I don't know that page." };
  const t = input.text.toLowerCase().trim();
  if (/^(hi|hey|hello|yo|sup|howdy|good (morning|evening))\b/.test(t)) return { text: "Hey. Roadie here. Shows, tours, money: what do you need?" };
  const go = GO.exec(t);
  if (go) {
    const page = PAGES.find(([re]) => re.test(go[1]));
    // An unknown page still becomes a tool call (with a name that is not in the registry): the flow refuses it safely.
    return { text: "On it.", navigate: { route: page ? page[1] : go[1].replace(/\W+/g, "-") } };
  }
  if (/\b(delete|remove|send|pay|email|add|change|move|book|play|write|create|cancel)\b/.test(t)) return { text: CANT_DO };
  if (/\b(show|shows|gig|tour|money|song|setlist|rehearsal|load[- ]?in|band)\b/.test(t)) return { text: NOT_YET };
  return { text: OFF_TOPIC };
}

export const knownRouteNames: string[] = routeNames;
