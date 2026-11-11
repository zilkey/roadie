/**
 * Pages that carry schema.org Event JSON-LD (<script type="application/ld+json">): Event, MusicEvent and the like, bare, in
 * arrays, under @graph or inside an ItemList. Three shapes of calendar url, no venue-specific code:
 *  1. a page with Events in it: read them;
 *  2. a sitemap XML: follow up to 40 page <loc>s (newest lastmod first) and read each page's JSON-LD;
 *  3. a page with few or no Events that links to event detail pages on its own host (paths containing /event): follow up to 30.
 * JSON-LD names performers but not roles: one performer is the headliner; with several, the first is the headliner and the rest support.
 */
import * as cheerio from "cheerio";
import type { Act } from "@/schema";
import { cleanTitle } from "../bill";
import { resolveStartsAt, todayIn } from "../dates";
import type { Net } from "../fetch";
import type { RawEvent, Reader } from "../types";

const MAX_SITEMAP_PAGES = 40;
const MAX_LINKED_PAGES = 30;
const FEW = 3;
type J = Record<string, unknown>;

const arr = <T,>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const isObj = (v: unknown): v is J => !!v && typeof v === "object" && !Array.isArray(v);

/** Every Event-typed object in a JSON-LD value. */
function eventsIn(v: unknown, out: J[] = []): J[] {
  if (Array.isArray(v)) { for (const x of v) eventsIn(x, out); return out; }
  if (!isObj(v)) return out;
  if (arr(v["@type"] as string | string[]).some((t) => typeof t === "string" && /Event$/.test(t) && t !== "EventSeries")) out.push(v);
  for (const k of ["@graph", "itemListElement", "item", "subEvent", "mainEntity"]) if (v[k]) eventsIn(v[k], out);
  return out;
}

const imageOf = (v: unknown, base: string): string | undefined => {
  for (const x of arr(v as unknown)) {
    const u = str(x) ?? (isObj(x) ? str(x.url) ?? str(x.contentUrl) : undefined);
    if (u) return abs(u, base);
  }
  return undefined;
};
const abs = (u: string, base: string) => { try { return new URL(u, base).href; } catch { return undefined; } };

/** "November 13, Band" (some sites put the date first in the name). */
const DATE_PREFIX = /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\s*[,:\-–—]\s+(?=\S)/i;

function toRaw(e: J, base: string, tz: string): RawEvent | undefined {
  const name = str(e.name);
  const title = name?.replace(DATE_PREFIX, "");
  const startsAt = str(e.startDate);
  if (!title || !startsAt) return undefined;
  const offers = arr(e.offers as unknown).filter(isObj);
  const performers: Act[] = [];
  for (const p of arr(e.performer as unknown)) {
    const name = cleanTitle(str(p) ?? (isObj(p) ? str(p.name) ?? "" : ""));
    if (name) performers.push({ name, role: performers.length ? "support" : "headliner" });
  }
  const status = `${str(e.eventStatus) ?? ""}`;
  const soldOut = offers.length > 0 && offers.every((o) => /SoldOut/i.test(str(o.availability) ?? ""));
  const doorTime = str(e.doorTime);
  const url = str(offers[0]?.url) ?? str(e.url);
  return {
    sourceId: `${(url && abs(url, base)) || base}|${startsAt.slice(0, 10)}`, // a series shares one url
    title, startsAt,
    ...(doorTime ? { doors: resolveStartsAt(doorTime, tz)?.time } : {}),
    acts: performers.length ? performers : undefined,
    imageUrl: imageOf(e.image, base),
    ticketUrl: url ? abs(url, base) : undefined,
    status: /Cancel/i.test(status) || /\bcancell?ed\b/i.test(name ?? "") ? "cancelled" : soldOut ? "soldout" : "onsale",
    description: str(e.description)?.slice(0, 400),
  };
}

/** Event rows from one page's JSON-LD blocks. */
function pageEvents(html: string, base: string, tz: string): RawEvent[] {
  const $ = cheerio.load(html);
  const out: RawEvent[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let j: unknown;
    try { j = JSON.parse($(el).text().trim()); } catch { return; }
    for (const e of eventsIn(j)) { const r = toRaw(e, base, tz); if (r) out.push(r); }
  });
  return out;
}

/** Pages from a sitemap, newest lastmod first. Image <loc>s inside <image:image> are not pages. */
function sitemapUrls(xml: string): string[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const rows: { loc: string; mod: string }[] = [];
  $("url").each((_, el) => { const loc = $(el).children("loc").first().text().trim(); if (loc) rows.push({ loc, mod: $(el).children("lastmod").first().text().trim() }); });
  return rows.sort((a, b) => b.mod.localeCompare(a.mod)).map((r) => r.loc).slice(0, MAX_SITEMAP_PAGES);
}

/** Same-host links whose path says "event", without the page itself. */
function eventLinks(html: string, base: string): string[] {
  const $ = cheerio.load(html);
  const host = new URL(base).host;
  const seen = new Set<string>([base.split("#")[0]]);
  const out: string[] = [];
  $("a[href]").each((_, el) => {
    const u = abs($(el).attr("href") ?? "", base);
    if (!u) return;
    const url = new URL(u);
    url.hash = "";
    if (url.host !== host || !/\/event/i.test(url.pathname) || url.pathname.replace(/\/+$/, "") === new URL(base).pathname.replace(/\/+$/, "") || seen.has(url.href)) return;
    seen.add(url.href);
    out.push(url.href);
  });
  return out.slice(0, MAX_LINKED_PAGES);
}

/** Read pages a few at a time; a page that fails is skipped. */
async function readPages(net: Net, urls: string[], tz: string): Promise<RawEvent[]> {
  const out: RawEvent[] = [];
  for (let i = 0; i < urls.length; i += 5) {
    const got = await Promise.all(urls.slice(i, i + 5).map(async (u) => {
      try { const p = await net.raw(u, { accept: "text/html,*/*;q=0.5" }); return pageEvents(p.body, p.url, tz); } catch { return []; }
    }));
    out.push(...got.flat());
  }
  return out;
}

export const readJsonLd: Reader<"jsonld"> = async (cal, ctx) => {
  const page = await ctx.net.raw(cal.url, { accept: "text/html,application/xml,*/*;q=0.5" });
  let rows: RawEvent[];
  if (/^\s*(?:<\?xml[^>]*>\s*)?<(?:urlset|sitemapindex)\b/i.test(page.body)) rows = await readPages(ctx.net, sitemapUrls(page.body), ctx.tz);
  else {
    rows = pageEvents(page.body, page.url, ctx.tz);
    if (rows.length < FEW) rows.push(...(await readPages(ctx.net, eventLinks(page.body, page.url), ctx.tz)));
  }
  const today = todayIn(ctx.tz, ctx.now);
  const seen = new Set<string>();
  const events = rows.filter((r) => {
    const d = resolveStartsAt(r.startsAt ?? "", ctx.tz)?.date;
    const key = `${r.sourceId ?? ""}|${r.title}|${d}`;
    if (!d || d < today || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const withActs = events.filter((e) => e.acts?.length);
  const bill = !withActs.length ? "title" : withActs.filter((e) => e.acts!.length > 1).length * 2 > withActs.length ? "full" : "headliner";
  return { events, bill };
};
