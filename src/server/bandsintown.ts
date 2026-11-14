/**
 * Bandsintown, as far as Roadie can reach it. Bandsintown has no way to add an event from outside, so a confirmed venue
 * show gets an "Add to Bandsintown" checklist item (ensureBandsintownItem, after every show write). Someone adds the event
 * on Bandsintown for Artists ("Open Bandsintown") and ticks it, or checkBandsintown ticks it when the band's events
 * (the read-only public API, with the band's appId from General Settings) list one that day in that city or venue.
 */
import { randomUUID } from "node:crypto";
import { run, type Doc, type Writer } from "./db";
import type { Ctx } from "./ctx";
import { kindOf, showCity, type ChecklistLike, type ChecklistItem, type ShowPlaceLike } from "@/lib/shows";
import { dateInBandZone } from "@/lib/timezone";
import { BANDSINTOWN_ITEM_LABEL, bandsintownEligible } from "@/lib/bandsintown";

const newId = () => randomUUID().slice(0, 8);

/** The artist's show templates in order: the first one typed Promotion is where the Bandsintown item goes. */
async function firstPromotionTemplate(w: Writer, artistId: string): Promise<Doc | undefined> {
  const ts = (await w.query("checklistTemplates", (q) => q.where("artistId", "==", artistId)))
    .filter((t) => (t.appliesTo ?? "show") === "show" && t.type === "promotion")
    .sort((a, b) => (a.order as number) - (b.order as number));
  return ts[0];
}

const hasItem = (lists: ChecklistLike[]) => lists.some((l) => l.items.some((i) => i.bandsintown));
export const bandsintownItem = (): ChecklistItem => ({ id: newId(), label: BANDSINTOWN_ITEM_LABEL, done: false, bandsintown: true });

/**
 * The show's checklists with the Bandsintown item added, or null when nothing changes. It goes at the end of the list made
 * from the first Promotion template, else of any list made from a Promotion template, else into a new "Promotion" list.
 */
export function withBandsintownItem(lists: ChecklistLike[], promotionIds: string[], firstPromotionId?: string): ChecklistLike[] | null {
  if (hasItem(lists)) return null;
  const target = lists.find((l) => firstPromotionId && l.templateId === firstPromotionId) ?? lists.find((l) => l.templateId && promotionIds.includes(l.templateId));
  if (target) return lists.map((l) => (l.id === target.id ? { ...l, items: [...l.items, bandsintownItem()] } : l));
  return [...lists, { id: newId(), name: "Promotion", templateId: null, items: [bandsintownItem()] }];
}

/** Give a confirmed, upcoming venue or festival show its "Add to Bandsintown" item. After the show's write commits; never throws. */
export async function ensureBandsintownItem(ctx: Ctx, showId: string): Promise<void> {
  try {
    await run(ctx, async (w) => {
      const show = await w.get("shows", showId);
      if (!show || !bandsintownEligible(show as never, dateInBandZone(w.now.toDate()))) return;
      const lists = (show.checklists ?? []) as ChecklistLike[];
      if (hasItem(lists)) return;
      const promos = (await w.query("checklistTemplates", (q) => q.where("artistId", "==", show.artistId as string)))
        .filter((t) => (t.appliesTo ?? "show") === "show" && t.type === "promotion").sort((a, b) => (a.order as number) - (b.order as number));
      const next = withBandsintownItem(lists, promos.map((t) => t.id), promos[0]?.id);
      if (next) await w.update("shows", showId, { checklists: next });
    });
  } catch (e) {
    console.error("ensureBandsintownItem", showId, e);
  }
}

/** For checklists.add: true when a list made from this template should carry the show's Bandsintown item. */
export async function templateTakesBandsintown(w: Writer, show: Doc, template: Doc): Promise<boolean> {
  if (!bandsintownEligible(show as never, dateInBandZone(w.now.toDate()))) return false;
  if (hasItem((show.checklists ?? []) as ChecklistLike[])) return false;
  return (await firstPromotionTemplate(w, show.artistId as string))?.id === template.id;
}

// ---------- reading Bandsintown ----------

export interface BitEvent { id: string; datetime: string; url?: string; venue?: { name?: string; city?: string; region?: string } }

const API = () => process.env.BANDSINTOWN_API_URL ?? "https://rest.bandsintown.com";
const words = (s = "") => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((x) => x.length > 2 && !["the", "and", "live", "music", "bar", "club", "venue", "hall", "room"].includes(x)));
const norm = (s = "") => s.toLowerCase().replace(/[^a-z]+/g, "");

/** The band's upcoming events on Bandsintown. */
export async function fetchBandsintownEvents(artistId: string, appId: string): Promise<BitEvent[]> {
  const url = `${API()}/artists/id_${encodeURIComponent(artistId)}/events?app_id=${encodeURIComponent(appId)}&date=upcoming`;
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (r.status === 403 || r.status === 401) throw new Error("Bandsintown refused the API key. Check it in General Settings › Bandsintown.");
  if (!r.ok) throw new Error(`Bandsintown answered ${r.status}`);
  const body = await r.json() as unknown;
  return Array.isArray(body) ? (body as BitEvent[]) : [];
}

/** The listing for this show: same date, and the same city or a venue name sharing a word ("The Magic Rat" ~ "Magic Rat Live Music"). */
export function matchEvent(show: ShowPlaceLike & { date: string }, venueName: string | undefined, events: BitEvent[]): BitEvent | undefined {
  const city = norm(showCity(show) ?? "");
  const vw = words(venueName ?? (show as { venue?: { name?: string } }).venue?.name);
  return events.find((e) => {
    if (e.datetime?.slice(0, 10) !== show.date) return false;
    if (city && norm(e.venue?.city) === city) return true;
    const ew = words(e.venue?.name);
    return [...vw].some((x) => ew.has(x));
  });
}
const eventLink = (e: BitEvent) => `https://www.bandsintown.com/e/${e.id}`;

/**
 * Tick the Bandsintown item on every eligible show (or just `showId`) that Bandsintown already lists. Returns the show ids it
 * ticked. Does nothing (skipped) without the band's Bandsintown artist ID and API key.
 */
export async function checkBandsintown(ctx: Ctx, artistId: string, showId?: string): Promise<{ ticked: string[]; skipped?: "no_key" }> {
  const artist = await run(ctx, (w) => w.get("artists", artistId));
  const bit = artist?.bandsintown as { artistId?: string; appId?: string } | undefined;
  if (!bit?.artistId || !bit.appId) return { ticked: [], skipped: "no_key" };
  const events = await fetchBandsintownEvents(bit.artistId, bit.appId);
  const ticked: string[] = [];
  await run(ctx, async (w) => {
    const today = dateInBandZone(w.now.toDate());
    const shows = showId ? [await w.get("shows", showId)].filter((s): s is Doc => !!s)
      : (await w.query("shows", (q) => q.where("artistId", "==", artistId))).filter((s) => (s.date as string) >= today);
    for (const s of shows) {
      if (s.deletedAt || s.artistId !== artistId || kindOf(s as never) === "house") continue;
      const lists = (s.checklists ?? []) as ChecklistLike[];
      const item = lists.flatMap((l) => l.items).find((i) => i.bandsintown && !i.done);
      if (!item) continue;
      const ev = matchEvent(s as never, (s.venue as { name?: string } | undefined)?.name, events);
      if (!ev) continue;
      const at = w.now.toDate().toISOString();
      const next = lists.map((l) => ({ ...l, items: l.items.map((i) => (i.id === item.id ? { ...i, done: true, doneAt: at, doneBy: ctx.uid, eventUrl: eventLink(ev) } : i)) }));
      await w.update("shows", s.id, { checklists: next });
      ticked.push(s.id);
    }
  });
  return { ticked };
}
