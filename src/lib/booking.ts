/** Pure helpers shared by the booking UI and server commands (no server or browser imports). */

import { dateInBandZone } from "./timezone";

export const STATUSES = ["idea", "toPitch", "pitched", "waiting", "talking", "booked", "declined", "dropped"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = {
  idea: "Idea", toPitch: "To pitch", pitched: "Pitched", waiting: "Waiting", talking: "Talking",
  booked: "Booked", declined: "Declined", dropped: "Dropped",
};
/** Statuses that mean the effort is still going: a flag on the target shows as filled. */
export const ACTIVE_STATUSES: Status[] = ["idea", "toPitch", "pitched", "waiting", "talking"];
export const isActive = (s: string) => (ACTIVE_STATUSES as string[]).includes(s);

// ---------- {{field}} fill-in ----------

export type TemplateContext = Record<string, string | undefined>;
const FIELD = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Replace {{a.b}} with ctx["a.b"]. Unknown or empty fields are left as {{a.b}} so they are visible. */
export function fillTemplate(text: string, ctx: TemplateContext): string {
  return text.replace(FIELD, (whole, key: string) => (ctx[key] ? ctx[key]! : whole));
}
/** Fields still unfilled in `text`. */
export function unfilledFields(text: string): string[] {
  return [...new Set([...text.matchAll(FIELD)].map((m) => m[1]))];
}
/** Names a template author can use. */
export const TEMPLATE_FIELDS = [
  "venue.name", "venue.city", "promoter.name", "edition.name", "festival.name", "target.name",
  "contact.name", "contact.firstName", "artist.name", "artist.video", "pitch.configuration", "user.name", "user.firstName",
  "stats.monthlyListeners", "stats.followers",
];

interface CtxInput {
  target?: { kind: string; name: string; city?: string; festivalName?: string };
  contact?: { name: string } | null;
  artist?: { name: string; links?: { website?: string; spotify?: string; instagram?: string } } | null;
  configurationName?: string;
  user?: { name: string } | null;
  /** From statsTemplateFields(snapshots). */
  stats?: Record<string, string | undefined>;
}
export function buildTemplateContext(i: CtxInput): TemplateContext {
  const first = (n?: string) => n?.trim().split(/\s+/)[0];
  const t = i.target;
  const ctx: TemplateContext = {
    "target.name": t?.name,
    "contact.name": i.contact?.name, "contact.firstName": first(i.contact?.name),
    "artist.name": i.artist?.name, "artist.video": i.artist?.links?.website ?? i.artist?.links?.spotify,
    "pitch.configuration": i.configurationName,
    "user.name": i.user?.name, "user.firstName": first(i.user?.name),
    ...i.stats,
  };
  if (t?.kind === "venue") { ctx["venue.name"] = t.name; ctx["venue.city"] = t.city; }
  if (t?.kind === "promoter") ctx["promoter.name"] = t.name;
  if (t?.kind === "edition") { ctx["edition.name"] = t.name; ctx["festival.name"] = t.festivalName; }
  return ctx;
}

// ---------- search ----------

export interface SearchItem { kind: "venue" | "promoter" | "festival" | "contact"; id: string; name: string; sub: string; haystack: string }
interface Named { id: string; name: string; contactIds?: string[] }
export function buildSearchItems(d: {
  venues: (Named & { address?: { city?: string; state?: string }; capacity?: number })[];
  promoters: Named[];
  festivals: (Named & { type?: string })[];
  contacts: (Named & { emails?: string[]; title?: string })[];
}): SearchItem[] {
  const byId = new Map(d.contacts.map((c) => [c.id, c]));
  const people = (ids: string[] = []) => ids.map((i) => byId.get(i)).filter(Boolean).map((c) => `${c!.name} ${(c!.emails ?? []).join(" ")}`).join(" ");
  const out: SearchItem[] = [];
  for (const v of d.venues) {
    out.push({ kind: "venue", id: v.id, name: v.name, sub: ["Venue", v.address?.city, v.capacity].filter(Boolean).join(" · "), haystack: `${v.name} ${v.address?.city ?? ""} ${people(v.contactIds)}` });
  }
  for (const p of d.promoters) out.push({ kind: "promoter", id: p.id, name: p.name, sub: "Promoter", haystack: `${p.name} ${people(p.contactIds)}` });
  for (const f of d.festivals) out.push({ kind: "festival", id: f.id, name: f.name, sub: f.type === "series" ? "Series" : "Festival", haystack: `${f.name} ${people(f.contactIds)}` });
  for (const c of d.contacts) out.push({ kind: "contact", id: c.id, name: c.name, sub: ["Contact", c.title].filter(Boolean).join(" · "), haystack: `${c.name} ${(c.emails ?? []).join(" ")} ${c.title ?? ""}` });
  return out;
}
/** Every word in the query must appear (case-insensitive) somewhere in the item. */
export function searchItems(items: SearchItem[], q: string): SearchItem[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((i) => { const h = i.haystack.toLowerCase(); return words.every((w) => h.includes(w)); });
}

// ---------- dates ----------

export const todayStr = (d = new Date()) => dateInBandZone(d);

interface EditionDates {
  appOpens?: { date: string }; appDeadline?: { date: string };
}
/** Applications that open this calendar month, or are open now (opened and not past deadline). */
export function appsOpenThisMonth<T extends EditionDates>(editions: T[], today = todayStr()): T[] {
  const month = today.slice(0, 7);
  return editions.filter((e) => {
    const o = e.appOpens?.date, dl = e.appDeadline?.date;
    if (o && o.startsWith(month)) return true;
    return !!o && o <= today && (!dl || dl >= today);
  });
}
/** Deadlines from today through `days` ahead, soonest first. */
export function upcomingDeadlines<T extends EditionDates>(editions: T[], today = todayStr(), days = 90): T[] {
  const [y, m, d] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  return editions.filter((e) => { const d = e.appDeadline?.date; return !!d && d >= today && d <= last; })
    .sort((a, b) => a.appDeadline!.date.localeCompare(b.appDeadline!.date));
}
export const fmtDate = (s?: string) => {
  if (!s) return "";
  const d = new Date(s + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/** A pitch date is just a "YYYY-MM-DD" string. Docs written before that were `{date, endDate?, note?}`; reading one still works (until migrate:pitch-dates has run). */
export type PitchDateIn = string | { date: string };
/** A pitch's dates, sorted and unique (missing = none). */
export const sortedDates = (dates?: readonly PitchDateIn[]): string[] =>
  [...new Set((dates ?? []).map((d) => (typeof d === "string" ? d : d.date)))].sort();
/** A date has passed once it is before today. */
export const datePast = (d: string, today: string) => d < today;
/** "Sat, Nov 21". */
export function fmtPitchDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** What a pitch row's Pitch cell says: the configuration it was pitched as, and its dates in order. */
export function pitchCellText(p: { pitchedAs?: string | null; dates?: readonly PitchDateIn[] }, configs: { id: string; name: string }[]): { config: string; dates: string } {
  return {
    config: configs.find((c) => c.id === p.pitchedAs)?.name ?? "Not sure yet",
    dates: sortedDates(p.dates).map(fmtPitchDate).join(", ") || "No dates yet",
  };
}
