/**
 * Which tools a message gets. All 190-odd commands at once drowned the model: it picked wrong or asked instead of
 * acting. So every message gets the core (the band's places, pitches, shows, money, the web, navigation) and the groups
 * its words or page call for; `tools.load` lets the model pull in any other group mid-message. Policy (what Roadie may
 * do at all) stays in policy.ts; this only decides what is offered first.
 *
 * Core is a list, not "whatever is in no group": that rule let every new feature land in core until each model call
 * carried 130 tools (2026-11-18: about 27K tokens of every call, docs/designs/sonnet/plan.md). A unit test fails when a
 * tool is in neither CORE nor a group.
 */
import type { PageContext } from "@/schema/assistant";
import type { ToolDef } from "./tools";

export interface ToolGroup { key: string; title: string; match: (name: string) => boolean; words: RegExp; routes?: RegExp }
const prefixes = (...ps: string[]) => (name: string) => ps.some((p) => (p.endsWith(".") ? name.startsWith(p) : name === p));

/** Tour tools every message gets: "put the Kilby show on Mountain West" names no tour word, and shows are core. */
const TOUR_CORE = ["tours.list", "tours.summary", "tours.addShow"];

/** Every message gets these: what prod traces use and what the system prompt's guides need. */
export const CORE: readonly string[] = [
  // Roadie's own
  "context.now", "search", "records.get", "records.list", "web.search", "web.read", "venues.draft", "tools.load", "history.undoRun", "ui.ask", "ui.navigate", "help.explain", "geo.autocomplete",
  // places and contacts
  "venues.create", "venues.update", "venueTypes.add", "contacts.create", "contacts.update",
  // pitches
  "pitches.flag", "pitches.update", "pitches.move", "pitches.comment", "pitches.log", "pitches.remove", "pitches.needingFollowUp",
  // shows
  "shows.list", "shows.create", "shows.update", "shows.setStatus", "shows.cancel", "shows.drop", "shows.setFields", "shows.afterShow", "showDeals.update",
  // money
  "income.add", "income.addMany", "income.update", "income.remove", "income.setReceived", "income.assign",
  "payouts.add", "payouts.update", "payouts.remove", "payouts.markPaid",
  "expenses.add", "expenses.update", "expenses.remove", "expenses.setPaidBack", "expenses.markPaid", "expenses.payPerson", "expenses.estimateGas", "shows.setExpenses",
  // tours (see TOUR_CORE)
  "tours.list", "tours.summary", "tours.addShow",
];

export const GROUPS: ToolGroup[] = [
  { key: "stagePlots", title: "stage plots (inputs, monitors, the stage, engineer link)", match: prefixes("stagePlots.", "shows.setStagePlot"), words: /stage ?plot|\bplot\b|input list|monitor|engineer|backline/i, routes: /stagePlot/ },
  { key: "checklists", title: "show checklists and checklist templates", match: (n) => /^shows\..*[Cc]hecklist|^shows\.checkItem$|^checklistTemplates\.|^checklists\.|^todos\./.test(n), words: /check ?list|to-?dos?\b|check (?:it |that |this )?off|tick(?:ed)? off|\bdone\b.*\bitem|^(?:did|have) we\b/i },
  { key: "setlists", title: "setlists and setlist templates, printing", match: prefixes("setlists.", "setlistTemplates."), words: /set ?lists?|\bset\b|print|encore|running order/i, routes: /setlist/ },
  { key: "releases", title: "releases (albums, EPs and singles): tracklists, mixes, masters, artwork, the record's Drive folder", match: prefixes("releases."), words: /\breleases?\b|\balbums?\b|\bep\b|\bsingle\b|\blp\b|\brecord\b|track ?list|\btracks?\b|\bmix(?:es|ing)?\b|\bmaster(?:s|ing|ed)?\b|\bstems\b|\bisrc\b|\bartwork\b|\bcover art\b|\brelease\b|\bvinyl\b/i, routes: /release/ },
  { key: "songs", title: "songs, charts, lyrics, demos, Drive files and rehearsal recordings", match: prefixes("songs.", "files.", "drive.", "rehearsals.folder", "rehearsals.newRecordings", "rehearsals.adoptRecording"), words: /\bsongs?\b|\btunes?\b|chart|lyric|demo|recording|\bfiles?\b|drive|folder|\bkey of\b|\bbpm\b|tempo/i, routes: /song/ },
  { key: "tours", title: "tours: the plan by day (shows, options, drives, stays, notes), booking an option, how a tour is doing", match: (n) => n.startsWith("tours.") && !TOUR_CORE.includes(n), words: /\btours?\b|\bon the road\b|\b(?:a|the) drive\b(?! folder)|\bdrives\b|\bcamping\b|\bcamp\b|\bstay(?:ing)?\b|\bairbnb\b|\bmotel\b|\bhotel\b|\bleave by\b|\boptions?\b|\bthe \d{1,2}(?:st|nd|rd|th)\b/i, routes: /tour/ },
  { key: "rehearsals", title: "rehearsals", match: (n) => n.startsWith("rehearsals.") && !/folder|Recording|calendar/.test(n), words: /rehears|practice/i, routes: /rehearsal/ },
  { key: "email", title: "email: send or draft from Gmail, email templates", match: prefixes("pitches.sendEmail", "pitches.draftEmail", "email.", "emailTemplates."), words: /e-?mail|\bmail\b|draft|template|reply|\bsend\b|follow[- ]?up|pitch (?:them|it|him|her)/i, routes: /template|pitch/ },
  { key: "campaigns", title: "booking campaigns: start, rename, close or reopen one; put pitches in a campaign (or back to Ongoing)", match: prefixes("campaigns.", "pitches.setCampaign"), words: /campaign|\bongoing\b/i, routes: /campaign|bookingPitches/i },
  { key: "availability", title: "who can play: asking the band and their answers", match: prefixes("availability."), words: /availab|who.?s (?:free|in|out)|can (?:you |they |everyone )?(?:play|make it)|can't (?:play|make)|ask the band|poll/i },
  { key: "website", title: "the band's website (draft pages; a person publishes)", match: prefixes("site."), words: /\bweb ?site\b|\bweb ?page\b|\bhome ?page\b|\bsite\b|\bbio\b|\bepk\b|\babout page\b/i, routes: /\/website/ },
  { key: "fans", title: "fans and the mailing list (Bandzoogle)", match: prefixes("fans."), words: /\bfans?\b|mailing list|bandzoogle|newsletter|sign-?ups?/i, routes: /fan/ },
  { key: "calendar", title: "the band's Google Calendar, and which tours show on the Calendar page", match: prefixes("shows.calendar", "shows.calendarPreview", "shows.calendarLink", "rehearsals.calendar", "rehearsals.calendarPreview", "rehearsals.calendarLink", "calendar."), words: /calendar|google|sync|invite the band/i },
  { key: "people", title: "band members (roster, instruments, driving), the People page", match: prefixes("musicians.", "users.addToBand", "people.list", "people.updateDriving", "me."), words: /musician|band ?member|\bpeople\b|roster|driving|instrument|\bplays\b|\bjoin(?:s|ed)?\b|\bleft the band|\bdrummer|bassist|guitar|singer|keys\b/i, routes: /people|musician/ },
  { key: "band", title: "band settings: genres, bio, custom song and show fields, lineups, links, page sections, phone shortcut, your light or dark theme", match: prefixes("artists.", "sections.", "shortcut.", "theme."), words: /dark mode|light mode|\btheme\b|\bgenres?\b|\bbio\b|\bfields?\b|column|lineup|configuration|band (?:name|link|site)|setting|section|shortcut|custom|spotify|instagram link|website link|\bhide\b|\bshow the\b/i, routes: /artist|settings/ },
  { key: "acts", title: "acts: bands on venue calendars to open for or trade shows with, the ones we watch, our take on them", match: prefixes("acts.", "bandsintown.check"), words: /\bacts?\b|bandsintown|shortlist|\bwatch(?:ing|ed|es|list)?\b|open(?:ing)? for|opener|support (?:slot|act)|headlin|on tour|trade shows|\bpeers?\b|not a fit|bigger than us|our size/i, routes: /\/acts/ },
  { key: "venueCalendars", title: "shows on venue calendars (other acts' upcoming shows at rooms we might play): find and count them, Not a fit, Pitch this, opener slots", match: prefixes("venueEvents."), words: /venue ?calendars?|\bcalendars?\b.*\b(?:shows?|events?)\b|\b(?:shows?|events?)\b.*\bcalendars?\b|upcoming (?:shows|events)|opener slot|not a fit|good fit|pitch(?:ed)? (?:this|the|that) show|\bbills?\b/i, routes: /venue-?calendars|calendars/i },
  { key: "places", title: "venue types, promoters, festivals and their years, merging or deleting a venue", match: (n) => /^(promoters|venueTypes|festivals|editions)\./.test(n) || n === "venues.remove" || n === "venues.mergeInto", words: /venue ?types?|\btypes? of venue|promoter|festival|\bedition|\bmerge\b|(?:delete|remove) (?:the |this |that )?(?:venue|place|room)/i, routes: /festival|promoter/i },
  { key: "contacts", title: "a contact's roles, linking contacts to venues and promoters, deleting a contact", match: prefixes("contacts.remove", "contacts.attach", "contacts.detach", "contacts.setRoles"), words: /\bcontacts?\b|\broles?\b|\battach|\bdetach|\blink\b|\bunlink|\bbooker\b|talent buyer/i, routes: /contact/i },
  { key: "showExtras", title: "show comments, posters, the show's Drive folder, opening or closing its Quick entry card, deleting a show", match: prefixes("shows.comment", "shows.editComment", "shows.removeComment", "shows.remove", "shows.folder", "shows.posters.", "shows.setQuickEntryOpen"), words: /quick ?entry|\bcomments?\b|poster|flyer|\bfolder\b|(?:delete|remove) (?:the |this |that )?(?:show|gig)/i },
  { key: "projects", title: "money projects (open, rename, close, reopen) and receipts", match: (n) => n.startsWith("projects.") || n === "receipts.search", words: /\bprojects?\b|receipt/i, routes: /project/i },
  { key: "posts", title: "Instagram posts: ideas, drafts, carousels, photos, publishing and scheduling", match: prefixes("posts."), words: /\bposts?\b|instagram|\bcarousel|caption|\bphotos?\b|publish|\breels?\b/i, routes: /post/i },
  { key: "stats", title: "Spotify and streaming stats", match: prefixes("stats."), words: /spotify|\bstats?\b|stream|listener|follower/i, routes: /stats/ },
];
/** The group a tool is in; undefined for core (and for a tool that is in neither, which the unit test catches). */
export const groupOf = (name: string) => (CORE.includes(name) ? undefined : GROUPS.find((g) => g.match(name))?.key);
export const groupKeys = GROUPS.map((g) => g.key);

/** The groups a message calls for: its words, the last few things the person said, and the page they're on. */
export function groupsFor(message: string, history: { role: string; text: string }[], page: PageContext | undefined): string[] {
  const said = [...history.filter((h) => h.role === "user").slice(-3).map((h) => h.text), message].join("\n");
  const route = `${page?.route ?? ""} ${page?.recordKind ?? ""}`;
  return GROUPS.filter((g) => g.words.test(said) || (g.routes && g.routes.test(route))).map((g) => g.key);
}

/** The tools offered for a step: the core, plus the named groups, in the defs' order (a stable order keeps Claude's cache). A tool in neither is offered, as before CORE was a list. */
export function selectTools<T extends Pick<ToolDef, "name">>(defs: T[], groups: Iterable<string>): T[] {
  const on = new Set(groups);
  return defs.filter((d) => { const g = groupOf(d.name); return !g || on.has(g); });
}
