/** Pure show logic shared by the UI and server commands (no server or browser imports). */
import { roleIn } from "@/schema/users";

export type Sound = { provider: "venueProvided" | "bandProvided"; notes?: string };
export type Needs = { poster: boolean; backline: boolean; merch: boolean };
export interface ChecklistItem { id: string; label: string; done: boolean; ownerId?: string; doneAt?: string; doneBy?: string }
/** LEGACY gear item (shows not yet migrated): read as an ordinary list named "Gear". */
export interface GearItem { id: string; label: string; musicianId?: string; packed: boolean }
/** templateId is missing only on lists not yet written in the new shape (read: none). */
export interface ChecklistLike { id: string; name: string; templateId?: string | null; items: ChecklistItem[] }
export interface ChecklistTemplateLike { id: string; name: string; order: number; items: { id: string; label: string }[] }
export interface ArtistLike {
  configurations: { id: string; name: string; billingName: string; musicianIds: string[] }[];
}

// ---------- where a show is ----------

/** The fields that say where a show is. A show has a venue, or (house concerts) hosts and a place. */
export interface ShowPlaceLike {
  kind?: "venue" | "house" | "festival" | "radio" | "other";
  venue?: { id: string; name: string; address?: string; city?: string };
  place?: { city: string; address?: string };
  hostName?: string;
  editionName?: string;
}
export const KIND_LABEL: Record<NonNullable<ShowPlaceLike["kind"]>, string> = {
  venue: "Venue", house: "House concert", festival: "Festival", radio: "Radio", other: "Other",
};
export const kindOf = (s: ShowPlaceLike) => s.kind ?? (s.venue ? "venue" : s.hostName ? "house" : "other");
/** The show's name everywhere in the app: the venue, else "House concert · <hosts>", else the festival. */
export function showName(s: ShowPlaceLike): string {
  if (s.venue) return s.venue.name;
  if (kindOf(s) === "house") return s.hostName ? `House concert · ${s.hostName}` : "House concert";
  return s.editionName ?? KIND_LABEL[kindOf(s)];
}
/** What the outside world sees (Bandsintown): never a host's name or a home address. */
export const publicShowName = (s: ShowPlaceLike) => (s.venue ? s.venue.name : kindOf(s) === "house" ? "House concert" : showName(s));
export const showCity = (s: ShowPlaceLike) => s.venue?.city ?? s.place?.city;
export const showAddress = (s: ShowPlaceLike) => s.venue?.address ?? s.place?.address;
/** Published to Bandsintown (or, on a show not yet migrated, the old "public show" flag). */
export const isPublished = (s: object) => { const x = s as { publishToBandsintown?: boolean; public?: boolean }; return x.publishToBandsintown ?? x.public ?? false; };
/** "Robin Castellano & Priya Nair" */
export const joinNames = (names: string[]) => names.filter(Boolean).join(" & ");

/**
 * Who a show's calendar invitations go to (musician ids): members of the configuration who are on the team (a signed-in admin or
 * member of this artist, linked either way: musician.userId or user.musicianId) and have an email to send to.
 * The Booked it! form shows this list and shows.create sends to exactly it.
 */
export function calendarInvitees(
  configMusicianIds: readonly string[],
  musicians: readonly { id: string; email?: string | null; userId?: string | null }[],
  users: readonly { id: string; musicianId?: string | null; artists?: unknown }[],
  artistId: string,
): string[] {
  const team = users.filter((u) => { const r = roleIn(u, artistId); return r === "admin" || r === "member"; });
  return configMusicianIds.filter((mid) => {
    const m = musicians.find((x) => x.id === mid);
    return !!m?.email && team.some((u) => u.id === m.userId || u.musicianId === m.id);
  });
}

/** The templates every new artist starts with (seedDefaultTemplates: artists.create, scripts/seed.ts, migrate:checklists). */
export const DEFAULT_TEMPLATES: { name: string; items: string[] }[] = [
  { name: "Promo", items: ["Make show poster", "Post on social media", "Send email to email list"] },
  { name: "Follow Up", items: ["Post on social media"] },
];

// ---------- dates and times ----------

export const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
export const daysBetween = (from: string, to: string) => {
  const t = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(to) - t(from)) / 86400000);
};
/** "19:15" -> "7:15 pm" */
export function fmtTime(t?: string): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
export const fmtLong = (s?: string) => (s ? new Date(s + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "");
export const fmtLongYear = (s?: string) => (s ? new Date(s + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "");
export const fmtDur = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

// ---------- checklist ----------

/** A show's checklists: `checklists`, or for a show not yet migrated its old checklist ("Gig prep") and gear list ("Gear"), as ordinary lists. */
export function checklistsOf(s: { checklists?: ChecklistLike[]; checklist?: (ChecklistItem & { due?: string })[]; gear?: GearItem[] }): ChecklistLike[] {
  if (s.checklists) return s.checklists;
  const out: ChecklistLike[] = [];
  if (s.checklist?.length) out.push({ id: "gigprep", name: "Gig prep", templateId: null, items: s.checklist.map(({ due: _due, ...i }) => i) });
  if (s.gear?.length) {
    out.push({ id: "gear", name: "Gear", templateId: null, items: s.gear.map((g) => ({ id: g.id, label: g.label, done: g.packed, ...(g.musicianId ? { ownerId: g.musicianId } : {}) })) });
  }
  return out;
}
/** "5 of 9" across every list. */
export function checklistCount(lists: ChecklistLike[]) {
  const items = lists.flatMap((l) => l.items);
  return { done: items.filter((i) => i.done).length, total: items.length };
}
/** Open items for one person across every list, in list order: assigned to them (their musicianId) or to nobody (Home). */
export function openItemsFor(lists: ChecklistLike[], musicianId?: string): (ChecklistItem & { listId: string; listName: string })[] {
  return lists.flatMap((l) => l.items.filter((i) => !i.done && (!i.ownerId || i.ownerId === musicianId)).map((i) => ({ ...i, listId: l.id, listName: l.name })));
}

// ---------- availability ----------

export type Answer = "yes" | "no" | "maybe";
export type AskState = Answer | "waiting" | "notAsked";
interface AvLike { askedMusicianIds: string[]; responses: Record<string, { answer: Answer } | undefined>; closedAt?: unknown }
export function askState(av: AvLike, musicianId: string): AskState {
  const r = av.responses[musicianId];
  if (r) return r.answer;
  return av.askedMusicianIds.includes(musicianId) ? "waiting" : "notAsked";
}
export const ASK_LABEL: Record<AskState, string> = { yes: "Yes", no: "No", maybe: "Maybe", waiting: "Waiting", notAsked: "Not asked" };

// ---------- Home ----------

interface ShowLike { id: string; date: string; status: "hold" | "confirmed" | "played" | "canceled" | "dropped" }
export const RECENT_DAYS = 3;
/** A show whose date has passed counts as played even if nobody has rated it yet. */
/** Canceled (they called it off) or dropped (we pulled out). */
export const isOff = (s: { status: string } | { [k: string]: unknown }) => s.status === "canceled" || s.status === "dropped";
export const isPlayed = (s: ShowLike, today: string) => s.status === "played" || (s.status === "confirmed" && s.date < today);

/** The Shows filter. Every show is in exactly one: dropped is status "dropped", or a hold whose date passed without being confirmed. */
export const SHOW_FILTERS = ["upcoming", "played", "canceled", "dropped"] as const;
export type ShowFilter = (typeof SHOW_FILTERS)[number];
export const SHOW_FILTER_LABEL: Record<ShowFilter, string> = { upcoming: "Upcoming", played: "Played", canceled: "Canceled", dropped: "Dropped" };
export function showFilter(s: ShowLike, today: string): ShowFilter {
  if (s.status === "canceled") return "canceled";
  if (s.status === "dropped") return "dropped";
  if (isPlayed(s, today)) return "played";
  return s.status === "hold" && s.date < today ? "dropped" : "upcoming";
}

export interface HomePlan<S extends ShowLike, A> {
  today: S[];
  /** Open "Can you play?" questions for this person. */
  asks: A[];
  /** Played in the last few days; for admins only those whose money is not entered. */
  recent: S[];
  next?: S;
  upcoming: S[];
}
export function planHome<S extends ShowLike, A extends AvLike & { id: string }>(i: {
  role: "admin" | "member"; musicianId?: string; shows: S[]; asks: A[]; today: string; unsettled?: Set<string>;
}): HomePlan<S, A> {
  const live = i.shows.filter((s) => !isOff(s));
  const today = live.filter((s) => s.date === i.today).sort((a, b) => a.id.localeCompare(b.id));
  const since = addDays(i.today, -RECENT_DAYS);
  const recent = live.filter((s) => s.date < i.today && s.date >= since && isPlayed(s, i.today) && (i.role === "member" || i.unsettled?.has(s.id)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const upcoming = live.filter((s) => s.date > i.today && s.status !== "played").sort((a, b) => a.date.localeCompare(b.date));
  const asks = i.asks.filter((a) => !a.closedAt && !!i.musicianId && a.askedMusicianIds.includes(i.musicianId) && !a.responses[i.musicianId]);
  return { today, asks, recent, next: upcoming[0], upcoming };
}
