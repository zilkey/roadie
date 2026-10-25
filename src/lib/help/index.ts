/**
 * "Explain this to me": hard-coded topics about the app, for Roadie's help.explain. Each page (named route plus tab) maps to
 * the topic that explains it; a topic can also be asked for by name ("what's a pitch?").
 */
import type { HelpTopic } from "./types";
import { BOOKING_TOPICS } from "./booking";
import { SHOW_TOPICS } from "./shows";
import { FAN_TOPICS } from "./fans";

export type { HelpTopic } from "./types";
export const HELP_TOPICS: readonly HelpTopic[] = [...SHOW_TOPICS, ...BOOKING_TOPICS, ...FAN_TOPICS];
export const HELP_TOPIC_IDS = HELP_TOPICS.map((t) => t.id) as [string, ...string[]];
export const helpTopic = (id: string) => HELP_TOPICS.find((t) => t.id === id);

/** Route -> topic; a function when the tab decides. Pages with no entry have no explanation yet. */
const BY_ROUTE: Record<string, string | ((tab?: string) => string)> = {
  shows: (tab) => ({ played: "playedShows", canceled: "canceledShows", dropped: "droppedShows" })[tab ?? ""] ?? "upcomingShows",
  showsPlayed: "playedShows", showsCanceled: "canceledShows", showsDropped: "droppedShows",
  show: (tab) => (tab === "setlist" ? "setlists" : tab === "finances" ? "income" : "showPage"),
  showSetlist: "setlists", showFinances: "income", showAfter: "showPage", newShow: "showPage",
  booking: "booking", bookingVenues: "booking", bookingFestivals: "booking", bookingPromoters: "booking", bookingContacts: "booking",
  promoter: "booking", festival: "booking", edition: "booking", contact: "booking",
  bookingPitches: "pitch", pitch: "pitch", venue: "venueSharing",
  songs: "songs", song: "songs", setlists: "setlistTemplates", setlist: "setlistTemplates",
  rehearsals: "rehearsals", rehearsal: "rehearsals", money: "money", fans: "fans", expense: "expenses", fields: "customFields",
};
/** The topic that explains this page, if there is one. */
export function topicForPage(route: string, tab?: string): HelpTopic | undefined {
  const t = BY_ROUTE[route];
  return t === undefined ? undefined : helpTopic(typeof t === "function" ? t(tab) : t);
}

/** A topic named in someone's words ("what's a pitch?", "explain the pitch statuses"). Most specific first. */
const WORDS: [RegExp, string][] = [
  [/\bpitch(?:es)? status(?:es)?\b|\bstatus(?:es)? (?:of|on) (?:a )?pitch|\b(?:pitched|declined)\b/, "pitchStatuses"],
  [/\bshared\b|\bevery band\b|\bother bands\b/, "venueSharing"],
  [/\bfans?\b|\bmailing list\b|\bemail list\b|\bbandzoogle\b/, "fans"],
  [/\bsetlist templates?\b/, "setlistTemplates"],
  [/\bchecklists?\b|\bto-?dos?\b/, "checklists"],
  [/\bcustom fields?\b/, "customFields"],
  [/\bpitch(?:es| list)?\b/, "pitch"],
  [/\bflag\b|\bbooking\b/, "booking"],
  [/\bupcoming\b|\bholds?\b/, "upcomingShows"], [/\bplayed\b/, "playedShows"], [/\bcancel(?:l?ed)?\b/, "canceledShows"], [/\bdropped\b/, "droppedShows"],
  [/\bsetlists?\b|\bset ?list\b/, "setlists"], [/\bsongs?\b/, "songs"], [/\brehearsals?\b/, "rehearsals"],
  [/\bincome\b|\bdeal\b|\bguarantee\b/, "income"], [/\bexpenses?\b|\bpay(?:ing)? back\b/, "expenses"], [/\bmoney\b/, "money"],
];
export function topicInWords(text: string): HelpTopic | undefined {
  const t = text.toLowerCase();
  const hit = WORDS.find(([re]) => re.test(t));
  return hit ? helpTopic(hit[1]) : undefined;
}
