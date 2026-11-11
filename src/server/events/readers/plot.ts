/**
 * Plot (WordPress venue sites). The site's listings API, <site>/api/plot/v1/listings, is a JSON array of upcoming listings;
 * `?currentpage=N` pages it (every row carries maxPages). Each has `day` (YYYYMMDD), startTime/doors as text ("7pm"),
 * lineup.standard[] (the whole bill in order, no roles: first is the headliner) and a ticket link.
 */
import type { Act } from "@/schema";
import { todayIn } from "../dates";
import type { RawEvent, Reader } from "../types";

interface Listing {
  id?: number | string;
  title?: string;
  image?: string;
  day?: string;
  startTime?: string;
  doors?: string;
  hasTickets?: boolean;
  ticket?: { link?: string };
  url?: string;
  permalink?: string;
  maxPages?: number;
  lineup?: { standard?: { title?: string }[] };
  listingTypes?: unknown[];
}

const MAX_PAGES = 10;

export const readPlot: Reader<"plot"> = async (cal, ctx) => {
  const today = todayIn(ctx.tz, ctx.now).replace(/-/g, "");
  const events: RawEvent[] = [];
  let pages = 1;
  for (let p = 1; p <= Math.min(pages, MAX_PAGES); p++) {
    const u = new URL(cal.url);
    if (p > 1) u.searchParams.set("currentpage", String(p));
    const rows = await ctx.net.json<Listing[]>(u.href);
    if (!Array.isArray(rows) || !rows.length) break;
    pages = rows[0].maxPages ?? 1;
    for (const r of rows) {
      const day = String(r.day ?? "");
      if (!r.title || !/^\d{8}$/.test(day) || day < today) continue;
      const names = (r.lineup?.standard ?? []).map((x) => (x.title ?? "").trim()).filter(Boolean);
      const acts: Act[] | undefined = names.length ? names.map((name, i) => ({ name, role: i === 0 ? "headliner" : "support" })) : undefined;
      events.push({
        sourceId: r.id !== undefined ? String(r.id) : undefined,
        title: r.title, date: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`,
        timeText: r.startTime, doorsText: r.doors, acts,
        imageUrl: r.image || undefined, ticketUrl: r.ticket?.link || r.url || r.permalink || undefined,
      });
    }
  }
  return { events, bill: "full" };
};
