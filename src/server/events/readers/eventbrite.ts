/**
 * Eventbrite organizer pages. No API key: https://www.eventbrite.com/o/<organizerId> is a Next.js page whose __NEXT_DATA__
 * carries pageProps.upcomingEvents (name, url, start_date, start_time in the event's zone, image, is_cancelled, sold-out flag).
 * Eventbrite has no bill field, so the title carries it ("title" bill). The page lists upcoming events only; an organizer with
 * none (or whose list failed to load) gives an empty calendar.
 */
import { todayIn } from "../dates";
import type { RawEvent, Reader } from "../types";

interface EbEvent {
  id?: string;
  name?: string;
  url?: string;
  start_date?: string;
  start_time?: string;
  is_cancelled?: boolean;
  summary?: string;
  image?: { url?: string };
  ticket_availability?: { is_sold_out?: boolean };
  event_sales_status?: { sales_status?: string };
}

export const readEventbrite: Reader<"eventbrite"> = async (cal, ctx) => {
  const page = await ctx.net.raw(`https://www.eventbrite.com/o/${encodeURIComponent(cal.organizerId)}`, { accept: "text/html,*/*;q=0.5" });
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(page.body);
  let rows: EbEvent[] = [];
  try { rows = m ? (JSON.parse(m[1]).props?.pageProps?.upcomingEvents ?? []) : []; } catch { rows = []; }
  const today = todayIn(ctx.tz, ctx.now);
  const events: RawEvent[] = [];
  for (const e of rows) {
    if (!e.name || !e.start_date || e.start_date < today) continue;
    events.push({
      sourceId: e.id, title: e.name, startsAt: e.start_time ? `${e.start_date}T${e.start_time}` : e.start_date,
      imageUrl: e.image?.url, ticketUrl: e.url, description: e.summary || undefined,
      status: e.is_cancelled ? "cancelled" : e.ticket_availability?.is_sold_out || e.event_sales_status?.sales_status === "sold_out" ? "soldout" : "onsale",
    });
  }
  return { events, bill: "title" };
};
