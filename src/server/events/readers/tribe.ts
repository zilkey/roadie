/**
 * The Events Calendar (WordPress) REST API: `<site>/wp-json/tribe/events/v1/events`, 50 a page from today, following
 * `next_rest_url`. `category` is a category slug. Dates are the site's local wall clock.
 */
import { cleanTitle } from "../bill";

/** Tribe sends titles HTML-encoded (&#038;, &#8217;): decode every numeric entity, then the usual ones. */
const decode = (s: string) => cleanTitle(s.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16))));
import { todayIn } from "../dates";
import type { RawEvent, Reader } from "../types";

interface TribeEvent {
  id?: number | string; title?: string; start_date?: string; url?: string; status?: string; description?: string; excerpt?: string;
  image?: { url?: string } | false; categories?: { name?: string }[]; tags?: { name?: string }[]; venue?: { venue?: string } | unknown[];
}
interface TribePage { events?: TribeEvent[]; next_rest_url?: string }

const MAX_PAGES = 10;

export const readTribe: Reader<"tribe"> = async (cal, ctx) => {
  const base = cal.baseUrl.replace(/\/+$/, "");
  let url: string | undefined = `${base}/wp-json/tribe/events/v1/events?per_page=50&start_date=${todayIn(ctx.tz, ctx.now)}${cal.category ? `&categories=${encodeURIComponent(cal.category)}` : ""}`;
  const events: RawEvent[] = [];
  for (let n = 0; url && n < MAX_PAGES; n++) {
    // Some hosts reset a connection that claims to be Chrome from a script; a bare UA gets through.
    const page: TribePage = await ctx.net.json<TribePage>(url).catch(() => ctx.net.json<TribePage>(url!, { headers: { "user-agent": "Mozilla/5.0" } }));
    for (const e of page.events ?? []) {
      if (!e.title || !e.start_date) continue;
      const venue = e.venue && !Array.isArray(e.venue) ? e.venue.venue : undefined;
      events.push({
        sourceId: e.id !== undefined ? String(e.id) : e.url, title: decode(e.title), startsAt: e.start_date,
        ...(e.image && e.image.url ? { imageUrl: e.image.url } : {}),
        ...(e.url ? { ticketUrl: e.url } : {}),
        ...(e.status === "canceled" || e.status === "cancelled" ? { status: "cancelled" as const } : {}),
        ...(venue ? { venueName: decode(venue) } : {}),
        tags: [...(e.categories ?? []), ...(e.tags ?? [])].map((t) => decode(t.name ?? "")).filter(Boolean),
        description: decode(e.excerpt || e.description || "").slice(0, 400) || undefined,
      });
    }
    url = page.next_rest_url;
  }
  return { events, bill: "title" };
};
