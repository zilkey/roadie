/**
 * venue.network (venue-run ticketing sites). Its public API, https://venue.network/api/public/tickets/events?venue=<slug>,
 * answers {data[], meta} with date, start_time, door_time (venue-local), artists[] with a role (headliner, support, opener,
 * promoter) and ticketing_status (the API gives no ticket link). Rows with only a promoter are not shows with a bill: their title is used.
 */
import type { Act } from "@/schema";
import { todayIn } from "../dates";
import type { RawEvent, Reader } from "../types";

interface VnEvent {
  id?: number | string;
  title?: string;
  date?: string;
  start_date?: string;
  start_time?: string | null;
  door_time?: string | null;
  poster_11x17_thumbnail_url?: string | null;
  ticketing_image_url?: string | null;
  image_url?: string | null;
  poster_url?: string | null;
  ticketing_status?: string;
  category?: string | null;
  description?: string | null;
  artists?: { name?: string; role?: string }[];
}
interface VnPage { data?: VnEvent[]; meta?: { has_more?: boolean; limit?: number; offset?: number } }

const MAX_PAGES = 10;
const hhmm = (s?: string | null) => (s && /^(\d{2}:\d{2})/.exec(s)?.[1]) || undefined;

export const readVenueNetwork: Reader<"venue-network"> = async (cal, ctx) => {
  const today = todayIn(ctx.tz, ctx.now);
  const events: RawEvent[] = [];
  let offset = 0;
  for (let p = 0; p < MAX_PAGES; p++) {
    const page = await ctx.net.json<VnPage>(`https://venue.network/api/public/tickets/events?venue=${encodeURIComponent(cal.slug)}&offset=${offset}`);
    const rows = page.data ?? [];
    for (const r of rows) {
      const date = r.date ?? r.start_date;
      if (!r.title || !date || date < today) continue;
      const acts: Act[] = [];
      for (const a of r.artists ?? []) {
        const name = a.name?.trim();
        if (!name || a.role === "promoter") continue;
        acts.push({ name, role: a.role === "headliner" ? "headliner" : "support" });
      }
      if (acts.length && !acts.some((a) => a.role === "headliner")) acts[0].role = "headliner";
      const st = r.ticketing_status ?? "";
      events.push({
        sourceId: r.id !== undefined ? String(r.id) : undefined,
        title: r.title, date, start: hhmm(r.start_time), doors: hhmm(r.door_time),
        acts: acts.length ? acts : undefined,
        // The signed S3 poster URLs expire within the hour; the thumbnail URL on venue.network itself is stable.
        imageUrl: r.image_url || r.ticketing_image_url || r.poster_11x17_thumbnail_url || undefined,
        status: /sold/i.test(st) ? "soldout" : /cancel/i.test(st) ? "cancelled" : "onsale",
        tags: r.category ? [r.category] : undefined, description: r.description ?? undefined,
      });
    }
    if (!page.meta?.has_more || !rows.length) break;
    offset += rows.length;
  }
  return { events, bill: "full" };
};
