/** Pure show logic shared by the UI and server commands (no server or browser imports). */

export type Sound = { provider: "venueProvided" | "bandProvided"; notes?: string };
export type Needs = { poster: boolean; backline: boolean; merch: boolean };
export interface TemplateLike { label: string; when: "always" | "bandSound" | "venueSound" | "poster" | "backline" | "merch"; daysBefore: number }
export interface ChecklistItem { id: string; label: string; done: boolean; ownerId?: string; due?: string }
export interface GearItem { id: string; label: string; musicianId?: string; packed: boolean }
export interface GearSpec { label: string; musicianId?: string }
export interface ArtistLike {
  configurations: { id: string; name: string; billingName: string; musicianIds: string[]; gear: GearSpec[] }[];
  soundGear: { bandProvided: GearSpec[]; venueProvided: GearSpec[] };
}

/** A sensible starting set; scripts/seed.ts creates these as checklistTemplates. */
export const DEFAULT_CHECKLIST_TEMPLATES: TemplateLike[] = [
  { label: "Confirm load-in and set times", when: "always", daysBefore: 7 },
  { label: "Confirm day-of contact", when: "always", daysBefore: 2 },
  { label: "Share the setlist with the band", when: "always", daysBefore: 3 },
  { label: "Book sound engineer", when: "bandSound", daysBefore: 21 },
  { label: "Load PA and cables", when: "bandSound", daysBefore: 1 },
  { label: "Send stage plot and input list to the venue", when: "venueSound", daysBefore: 7 },
  { label: "Post the poster", when: "poster", daysBefore: 14 },
  { label: "Order or print posters", when: "poster", daysBefore: 21 },
  { label: "Confirm backline with the venue", when: "backline", daysBefore: 10 },
  { label: "Pack merch table", when: "merch", daysBefore: 2 },
  { label: "Count merch stock and card reader", when: "merch", daysBefore: 5 },
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

export function templateApplies(when: TemplateLike["when"], show: { sound: Sound; needs: Needs }): boolean {
  switch (when) {
    case "always": return true;
    case "bandSound": return show.sound.provider === "bandProvided";
    case "venueSound": return show.sound.provider === "venueProvided";
    default: return show.needs[when];
  }
}
export function buildChecklist(templates: TemplateLike[], show: { date: string; sound: Sound; needs: Needs }, newId: () => string): ChecklistItem[] {
  return templates.filter((t) => templateApplies(t.when, show))
    .map((t) => ({ id: newId(), label: t.label, done: false, due: addDays(show.date, -t.daysBefore) }))
    .sort((a, b) => a.due!.localeCompare(b.due!));
}
/** Add template items not already on the list (matched by label). Existing items are never touched. */
export function mergeChecklist(existing: ChecklistItem[], built: ChecklistItem[]): ChecklistItem[] {
  const have = new Set(existing.map((i) => i.label.toLowerCase()));
  return [...existing, ...built.filter((i) => !have.has(i.label.toLowerCase()))];
}

// ---------- gear ----------

export function buildGear(artist: ArtistLike, billedAs: string | undefined, provider: Sound["provider"], newId: () => string, previous: GearItem[] = []): GearItem[] {
  const cfg = artist.configurations.find((c) => c.id === billedAs);
  const specs = [...(cfg?.gear ?? []), ...artist.soundGear[provider]];
  const key = (g: GearSpec) => `${g.label}|${g.musicianId ?? ""}`;
  const was = new Map(previous.map((g) => [key(g), g]));
  return specs.map((g) => ({ id: was.get(key(g))?.id ?? newId(), label: g.label, ...(g.musicianId ? { musicianId: g.musicianId } : {}), packed: was.get(key(g))?.packed ?? false }));
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

interface ShowLike { id: string; date: string; status: "hold" | "confirmed" | "played" | "canceled" }
export const RECENT_DAYS = 3;
/** A show whose date has passed counts as played even if nobody has rated it yet. */
export const isPlayed = (s: ShowLike, today: string) => s.status === "played" || (s.status === "confirmed" && s.date < today);

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
  const live = i.shows.filter((s) => s.status !== "canceled");
  const today = live.filter((s) => s.date === i.today).sort((a, b) => a.id.localeCompare(b.id));
  const since = addDays(i.today, -RECENT_DAYS);
  const recent = live.filter((s) => s.date < i.today && s.date >= since && isPlayed(s, i.today) && (i.role === "member" || i.unsettled?.has(s.id)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const upcoming = live.filter((s) => s.date > i.today && s.status !== "played").sort((a, b) => a.date.localeCompare(b.date));
  const asks = i.asks.filter((a) => !a.closedAt && !!i.musicianId && a.askedMusicianIds.includes(i.musicianId) && !a.responses[i.musicianId]);
  return { today, asks, recent, next: upcoming[0], upcoming };
}
