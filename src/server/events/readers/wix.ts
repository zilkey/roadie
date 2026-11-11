/**
 * Wix sites embed what their widgets show in the page HTML, in `<script type="application/json">` blobs (wix-warmup-data). Wix
 * Events puts objects with a title, `scheduling.config.startDate` (an ISO instant), a slug and `mainImage` in there; they are
 * found by walking every JSON blob (the path to them changes per site), and the event page is `/event-details/<slug>`. A page
 * whose events load only in the browser, or come from another app, has none in its HTML: schema.org Event JSON-LD is tried,
 * and otherwise the list is empty.
 */
import * as cheerio from "cheerio";
import type { RawEvent, Reader } from "../types";

type J = Record<string, unknown>;
const isObj = (x: unknown): x is J => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown) => (typeof x === "string" && x ? x : undefined);

function walk(x: unknown, visit: (o: J) => void) {
  if (Array.isArray(x)) x.forEach((v) => walk(v, visit));
  else if (isObj(x)) { visit(x); for (const k in x) walk(x[k], visit); }
}

/** Wix Events (v1 numeric, v3 string): 4 / CANCELED is a cancelled event. */
const cancelled = (s: unknown) => s === 4 || (typeof s === "string" && /^cancel/i.test(s));

export const readWix: Reader<"wix"> = async (cal, ctx) => {
  const page = await ctx.net.raw(cal.url);
  const origin = new URL(page.url).origin;
  const $ = cheerio.load(page.body);
  const events: RawEvent[] = [];
  const seen = new Set<string>();
  const add = (e: RawEvent) => {
    const key = e.sourceId ?? `${e.startsAt}|${e.title}`;
    if (!seen.has(key)) { seen.add(key); events.push(e); }
  };
  $('script[type="application/json"]').each((_, el) => {
    let data: unknown;
    try { data = JSON.parse($(el).text()); } catch { return; }
    walk(data, (o) => {
      const cfg = isObj(o.scheduling) && isObj(o.scheduling.config) ? o.scheduling.config : undefined;
      const title = str(o.title), startsAt = str(cfg?.startDate);
      if (!title || !startsAt || cfg?.scheduleTbd === true) return;
      const img = isObj(o.mainImage) ? o.mainImage : undefined;
      const imgId = str(img?.id);
      const slug = str(o.slug);
      const loc = isObj(o.location) ? str(o.location.name) : undefined;
      add({
        sourceId: str(o.id) ?? slug, title, startsAt,
        ...(str(img?.url) || imgId ? { imageUrl: str(img?.url) ?? `https://static.wixstatic.com/media/${imgId}` } : {}),
        ...(slug ? { ticketUrl: `${origin}/event-details/${slug}` } : {}),
        ...(cancelled(o.status) ? { status: "cancelled" as const } : {}),
        ...(loc ? { venueName: loc } : {}),
        ...(str(o.description) ? { description: str(o.description)!.replace(/\s+/g, " ").slice(0, 400) } : {}),
      });
    });
  });
  if (!events.length) {
    $('script[type="application/ld+json"]').each((_, el) => {
      let data: unknown;
      try { data = JSON.parse($(el).text()); } catch { return; }
      walk(data, (o) => {
        const t = o["@type"];
        if (!(t === "Event" || (Array.isArray(t) && t.includes("Event") || (typeof t === "string" && /Event$/.test(t))))) return;
        const title = str(o.name), startsAt = str(o.startDate);
        if (!title || !startsAt) return;
        const img = Array.isArray(o.image) ? o.image[0] : o.image;
        add({ sourceId: str(o.url) ?? str(o["@id"]), title, startsAt, ...(str(img) ? { imageUrl: str(img) } : {}), ...(str(o.url) ? { ticketUrl: str(o.url) } : {}) });
      });
    });
  }
  const floor = ctx.now.getTime() - 86_400_000;
  return { events: events.filter((e) => !(Date.parse(e.startsAt!) < floor)), bill: "title" };
};
