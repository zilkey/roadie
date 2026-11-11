/**
 * Squarespace events collections: the page's own JSON (`<events page>?format=json`). A list-style collection answers with
 * `upcoming` (paged by `?offset=`), a calendar-style one with `items` for one month (`?month=MM-YYYY`), so this and the next two
 * months are read. A calendar API URL (/api/open/GetItemsByMonth?month=MM-YYYY&collectionId=...) answers one month as an array.
 * A page that is not an events collection has no items here and gives an empty list.
 */
import { cleanTitle } from "../bill";
import type { RawEvent, Reader } from "../types";

interface Item {
  id?: string; title?: string; startDate?: number; endDate?: number; assetUrl?: string; fullUrl?: string; sourceUrl?: string;
  tags?: string[]; categories?: string[]; excerpt?: string; body?: string;
  structuredContent?: { startDate?: number };
}
interface Page { upcoming?: Item[]; items?: Item[]; calendarView?: boolean; pagination?: { nextPage?: unknown; nextPageOffset?: number } }

const MAX_PAGES = 10;
const text = (html: string | undefined) => cleanTitle((html ?? "").replace(/<\/(p|div|li|h\d)>/gi, " ")).slice(0, 400);
const mmYyyy = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
const withParam = (u: string, k: string, v: string) => { const x = new URL(u); x.searchParams.set(k, v); return x.href; };

function toRaw(it: Item, origin: string): RawEvent | undefined {
  const ms = it.startDate ?? it.structuredContent?.startDate;
  if (!it.title || typeof ms !== "number") return undefined;
  const path = it.fullUrl ?? "";
  return {
    sourceId: it.id, title: it.title, startsAt: new Date(ms).toISOString(),
    ...(it.assetUrl ? { imageUrl: it.assetUrl } : {}),
    ...(path ? { ticketUrl: new URL(path, origin).href } : it.sourceUrl ? { ticketUrl: it.sourceUrl } : {}),
    tags: [...(it.tags ?? []), ...(it.categories ?? [])],
    description: text(it.excerpt ?? it.body) || undefined,
  };
}

export const readSquarespace: Reader<"squarespace"> = async (cal, ctx) => {
  const u = new URL(cal.url);
  const items: Item[] = [];
  if (u.pathname.includes("/api/open/GetItemsByMonth")) {
    for (let i = 0; i < 3; i++) {
      const m = new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth() + i, 1));
      const arr = await ctx.net.json<Item[]>(withParam(cal.url, "month", mmYyyy(m)));
      if (Array.isArray(arr)) items.push(...arr);
    }
  } else {
    const base = withParam(cal.url, "format", "json");
    const first = await ctx.net.json<Page>(base);
    items.push(...(first.upcoming ?? []), ...(first.items ?? []));
    if (first.calendarView) {
      for (let i = 0; i < 3; i++) {
        const m = new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth() + i, 1));
        const p = await ctx.net.json<Page>(withParam(base, "month", mmYyyy(m)));
        items.push(...(p.items ?? []));
      }
    }
    let p = first;
    for (let n = 1; n < MAX_PAGES && p.upcoming?.length && p.pagination?.nextPage === true && p.pagination.nextPageOffset; n++) {
      p = await ctx.net.json<Page>(withParam(base, "offset", String(p.pagination.nextPageOffset)));
      items.push(...(p.upcoming ?? []));
    }
  }
  const floor = ctx.now.getTime() - 86_400_000;
  const seen = new Set<string>();
  const events: RawEvent[] = [];
  for (const it of items) {
    const r = toRaw(it, u.origin);
    if (!r || Date.parse(r.startsAt!) < floor) continue;
    const key = r.sourceId ?? `${r.startsAt}|${r.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(r);
  }
  return { events, bill: "title" };
};
