/**
 * AEG Presents venue sites. Each site's events are one public JSON file on AEG's blob store,
 * https://aegwebprod.blob.core.windows.net/json/events/<siteId>/events.json: {meta, events[]} with the headliner and
 * supporting text, local show and door times, ticketing and media. Headliners and supports are real fields, so the bill is "full".
 */
import type { Act } from "@/schema";
import { todayIn } from "../dates";
import type { RawEvent, Reader } from "../types";

interface AegEvent {
  eventId?: string | number;
  active?: boolean;
  private?: boolean;
  title?: { headlinersText?: string | null; supportingText?: string | null; eventTitleText?: string | null };
  eventDateTime?: string;
  eventDateTimeISO?: string;
  doorDateTime?: string | null;
  ticketing?: { status?: string; url?: string | null; eventUrl?: string | null };
  media?: Record<string, { width?: number; file_name?: string }>;
  tour?: string;
}

/** The widest picture in the media map. */
const bestImage = (m: AegEvent["media"]) => Object.values(m ?? {}).filter((x) => x.file_name).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.file_name;
/** "2026-11-11T19:00:00" → "19:00". */
const hhmm = (s?: string | null) => (s && /T(\d{2}:\d{2})/.exec(s)?.[1]) || undefined;

export const readAeg: Reader<"aeg"> = async (cal, ctx) => {
  const j = await ctx.net.json<{ events?: AegEvent[] }>(`https://aegwebprod.blob.core.windows.net/json/events/${encodeURIComponent(cal.siteId)}/events.json`);
  const today = todayIn(ctx.tz, ctx.now);
  const events: RawEvent[] = [];
  for (const e of j.events ?? []) {
    if (e.active === false || e.private) continue;
    const head = (e.title?.headlinersText ?? "").trim();
    const title = head || (e.title?.eventTitleText ?? "").trim();
    const startsAt = e.eventDateTime ?? e.eventDateTimeISO;
    if (!title || !startsAt || startsAt.slice(0, 10) < today) continue;
    const acts: Act[] = [{ name: title, role: "headliner" }];
    for (const s of (e.title?.supportingText ?? "").split(",")) if (s.trim()) acts.push({ name: s.trim(), role: "support" });
    const status = e.ticketing?.status ?? "";
    events.push({
      sourceId: e.eventId !== undefined ? String(e.eventId) : undefined,
      title, startsAt, doors: hhmm(e.doorDateTime), acts,
      imageUrl: bestImage(e.media),
      ticketUrl: e.ticketing?.url ?? e.ticketing?.eventUrl ?? undefined,
      status: /cancel/i.test(status) ? "cancelled" : /sold\s*out/i.test(status) ? "soldout" : "onsale",
    });
  }
  return { events, bill: "full" };
};
