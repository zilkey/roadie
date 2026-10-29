/**
 * Which tools a message gets. All 190-odd commands at once drowned the model: it picked wrong or asked instead of
 * acting. So every message gets the core (the band's places, pitches, shows, money, the web, navigation) and the groups
 * its words or page call for; `tools.load` lets the model pull in any other group mid-message. Policy (what Roadie may
 * do at all) stays in policy.ts; this only decides what is offered first.
 */
import type { PageContext } from "@/schema/assistant";
import type { ToolDef } from "./tools";

export interface ToolGroup { key: string; title: string; match: (name: string) => boolean; words: RegExp; routes?: RegExp }
const prefixes = (...ps: string[]) => (name: string) => ps.some((p) => (p.endsWith(".") ? name.startsWith(p) : name === p));

export const GROUPS: ToolGroup[] = [
  { key: "stagePlots", title: "stage plots (inputs, monitors, the stage, engineer link)", match: prefixes("stagePlots.", "shows.setStagePlot"), words: /stage ?plot|\bplot\b|input list|monitor|engineer|backline/i, routes: /stagePlot/ },
  { key: "checklists", title: "show checklists and checklist templates", match: (n) => /^shows\..*[Cc]hecklist|^shows\.checkItem$|^checklistTemplates\./.test(n), words: /check ?list|to-?dos?\b|check (?:it |that |this )?off|tick(?:ed)? off|\bdone\b.*\bitem|^(?:did|have) we\b/i },
  { key: "setlists", title: "setlists and setlist templates, printing", match: prefixes("setlists.", "setlistTemplates."), words: /set ?lists?|\bset\b|print|encore|running order/i, routes: /setlist/ },
  { key: "albums", title: "albums, EPs and singles: tracklists, mixes, masters, artwork, the record's Drive folder", match: prefixes("albums."), words: /\balbums?\b|\bep\b|\bsingle\b|\blp\b|\brecord\b|track ?list|\btracks?\b|\bmix(?:es|ing)?\b|\bmaster(?:s|ing|ed)?\b|\bstems\b|\bisrc\b|\bartwork\b|\bcover art\b|\brelease\b|\bvinyl\b/i, routes: /album/ },
  { key: "songs", title: "songs, charts, lyrics, demos, Drive files and rehearsal recordings", match: prefixes("songs.", "files.", "drive.", "rehearsals.folder", "rehearsals.newRecordings", "rehearsals.adoptRecording"), words: /\bsongs?\b|\btunes?\b|chart|lyric|demo|recording|\bfiles?\b|drive|folder|\bkey of\b|\bbpm\b|tempo/i, routes: /song/ },
  { key: "rehearsals", title: "rehearsals", match: (n) => n.startsWith("rehearsals.") && !/folder|Recording|calendar/.test(n), words: /rehears|practice/i, routes: /rehearsal/ },
  { key: "email", title: "email: send or draft from Gmail, email templates", match: prefixes("pitches.sendEmail", "pitches.draftEmail", "email.", "emailTemplates."), words: /e-?mail|\bmail\b|draft|template|reply|\bsend\b|follow[- ]?up|pitch (?:them|it|him|her)/i, routes: /template|pitch/ },
  { key: "availability", title: "who can play: asking the band and their answers", match: prefixes("availability."), words: /availab|who.?s (?:free|in|out)|can (?:you |they |everyone )?(?:play|make it)|can't (?:play|make)|ask the band|poll/i },
  { key: "fans", title: "fans and the mailing list (Bandzoogle)", match: prefixes("fans."), words: /\bfans?\b|mailing list|bandzoogle|newsletter|sign-?ups?/i, routes: /fan/ },
  { key: "calendar", title: "the band's Google Calendar and Bandsintown", match: prefixes("shows.calendar", "shows.calendarPreview", "shows.calendarLink", "rehearsals.calendar", "rehearsals.calendarPreview", "rehearsals.calendarLink", "shows.sync", "bandsintown.reconcile"), words: /calendar|google|sync|bandsintown|invite the band/i },
  { key: "people", title: "band members (roster, instruments, driving), the People page", match: prefixes("musicians.", "users.addToBand", "people.list", "me."), words: /musician|band ?member|\bpeople\b|roster|driving|instrument|\bplays\b|\bjoin(?:s|ed)?\b|\bleft the band|\bdrummer|bassist|guitar|singer|keys\b/i, routes: /people|musician/ },
  { key: "band", title: "band settings: custom song and show fields, lineups, links, page sections, phone shortcut", match: prefixes("artists.", "sections.", "shortcut."), words: /\bfields?\b|column|lineup|configuration|band (?:name|link|site)|setting|section|shortcut|custom|spotify|instagram link|website link|\bhide\b|\bshow the\b/i, routes: /artist|settings/ },
  { key: "stats", title: "Spotify and streaming stats", match: prefixes("stats."), words: /spotify|\bstats?\b|stream|listener|follower/i, routes: /stats/ },
];
/** Everything in no group is core: Roadie's own tools, records, the band's places, contacts, pitches, shows, money. */
export const groupOf = (name: string) => GROUPS.find((g) => g.match(name))?.key;
export const groupKeys = GROUPS.map((g) => g.key);

/** The groups a message calls for: its words, the last few things the person said, and the page they're on. */
export function groupsFor(message: string, history: { role: string; text: string }[], page: PageContext | undefined): string[] {
  const said = [...history.filter((h) => h.role === "user").slice(-3).map((h) => h.text), message].join("\n");
  const route = `${page?.route ?? ""} ${page?.recordKind ?? ""}`;
  return GROUPS.filter((g) => g.words.test(said) || (g.routes && g.routes.test(route))).map((g) => g.key);
}

/** The tools offered for a step: the core, plus the named groups. Anything in no group is core. */
export function selectTools<T extends Pick<ToolDef, "name">>(defs: T[], groups: Iterable<string>): T[] {
  const on = new Set(groups);
  return defs.filter((d) => { const g = groupOf(d.name); return !g || on.has(g); });
}
