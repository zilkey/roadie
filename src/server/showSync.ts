/**
 * Keeps Google Calendar and Bandsintown in step with a show. Called by show commands AFTER their Firestore
 * transaction commits. Integration failures never fail the command: Calendar problems come back as warnings,
 * Bandsintown problems are recorded on the show as listings.bandsintown.state = "error".
 */
import { db, type Doc } from "./db";
import type { Ctx } from "./ctx";
import { IntegrationError, bandsintownClient, calendarClient } from "./integrations";
import { addDays, fmtTime, publicShowName, showAddress, showCity, showName, type ShowPlaceLike } from "@/lib/shows";
import { BAND_TIME_ZONE } from "@/lib/timezone";

export interface SyncResult { warnings: string[]; calendar?: "created" | "updated" | "removed"; bandsintown?: "listed" | "updated" | "removed" | "error" }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const notFound = (e: unknown) => e instanceof IntegrationError && e.status === 404;
const hhmm = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

/** Local (venue time) start and end as YYYY-MM-DDTHH:MM:00. Starts at load-in, ends after the set. */
export function eventTimes(show: { date: string; times: { loadIn?: string; set?: string; setLength?: number } }) {
  const t = show.times;
  const startMin = toMin(t.loadIn ?? t.set ?? "18:00");
  const endMin = t.set ? toMin(t.set) + (t.setLength ?? 60) : startMin + 180;
  const at = (min: number) => `${addDays(show.date, Math.floor(min / 1440))}T${hhmm(((min % 1440) + 1440) % 1440)}:00`;
  return { start: at(startMin), end: at(Math.max(endMin, startMin + 30)) };
}

export const bandsintownEligible = (s: Doc) => !!s.public && s.status === "confirmed";

async function syncCalendar(ctx: Ctx, show: Doc, create: boolean, remove: boolean, out: SyncResult) {
  const cal = calendarClient();
  const gone = !!show.deletedAt || show.status === "canceled" || remove;
  if (gone) {
    if (!show.calendarEventId) return;
    try { await cal.delete(show.calendarEventId); } catch (e) { if (!notFound(e)) throw e; }
    if (!show.deletedAt) await db.update(ctx, "shows", show.id, { calendarEventId: null });
    out.calendar = "removed";
    return;
  }
  if (!show.calendarEventId && !create) return;
  const [artist, musicians] = await Promise.all([db.get("artists", show.artistId), db.list("musicians")]);
  const cfg = (artist?.configurations as { id: string; billingName: string }[] | undefined)?.find((c) => c.id === show.billedAs);
  const who = cfg?.billingName ?? artist?.name ?? "Show";
  const attendees = musicians.filter((m) => (show.personnel as string[]).includes(m.id) && m.email).map((m) => m.email as string);
  const t = show.times as { loadIn?: string; soundcheck?: string; doors?: string; set?: string; setLength?: number };
  const lines = [
    t.loadIn && `Load in ${fmtTime(t.loadIn)}`, t.soundcheck && `Soundcheck ${fmtTime(t.soundcheck)}`, t.doors && `Doors ${fmtTime(t.doors)}`,
    t.set && `Set ${fmtTime(t.set)}${t.setLength ? ` (${t.setLength} min)` : ""}`,
    `Sound: ${show.sound.provider === "bandProvided" ? "we bring it" : "venue provides"}`, show.bandNotes,
  ].filter(Boolean).join("\n");
  const body = {
    title: `${show.status === "hold" ? "HOLD: " : ""}${who} at ${showName(show as ShowPlaceLike)}`, ...eventTimes(show as unknown as Parameters<typeof eventTimes>[0]), timeZone: BAND_TIME_ZONE,
    location: [show.venue?.name, showAddress(show as ShowPlaceLike) ?? showCity(show as ShowPlaceLike)].filter(Boolean).join(", "), description: lines, attendees,
  };
  if (show.calendarEventId) {
    try { await cal.update(show.calendarEventId, body); out.calendar = "updated"; return; } catch (e) { if (!notFound(e)) throw e; }
  }
  const ev = await cal.create(body);
  await db.update(ctx, "shows", show.id, { calendarEventId: ev.id });
  out.calendar = "created";
}

async function syncBandsintown(ctx: Ctx, show: Doc, out: SyncResult) {
  const bit = bandsintownClient();
  const cur = show.listings?.bandsintown as { eventId?: string; state: string } | undefined;
  const eligible = !show.deletedAt && bandsintownEligible(show);
  if (!eligible) {
    // A played show stays on the page as history; hold, private, canceled and deleted shows come off.
    if (show.status === "played" && !show.deletedAt) return;
    if (!cur) return;
    if (cur.eventId) { try { await bit.delete(cur.eventId); } catch (e) { if (!notFound(e)) throw e; } }
    if (!show.deletedAt) await db.update(ctx, "shows", show.id, { listings: {} });
    out.bandsintown = "removed";
    return;
  }
  const venue = show.venue ? await db.get("venues", show.venue.id) : null;
  const t = show.times as { set?: string; doors?: string };
  // Public listing: a house concert shows as "House concert" in its city, never the host or the address.
  const body = {
    datetime: `${show.date}T${t.set ?? t.doors ?? "20:00"}:00`, venueName: publicShowName(show as ShowPlaceLike), city: showCity(show as ShowPlaceLike) ?? venue?.address?.city ?? "",
    region: venue?.address?.state, country: "US", timeZone: BAND_TIME_ZONE, ticketUrl: show.ticketUrl, description: show.editionName,
  };
  const done = (eventId: string, how: "listed" | "updated") => {
    out.bandsintown = how;
    return db.update(ctx, "shows", show.id, { listings: { bandsintown: { eventId, state: "listed", syncedAt: new Date().toISOString() } } });
  };
  try {
    if (cur?.eventId) {
      try { await bit.update(cur.eventId, body); return await done(cur.eventId, "updated"); } catch (e) { if (!notFound(e)) throw e; }
    }
    const ev = await bit.create(body);
    await done(ev.id, "listed");
  } catch (e) {
    out.bandsintown = "error";
    out.warnings.push(`Bandsintown: ${msg(e)}`);
    await db.update(ctx, "shows", show.id, {
      listings: { bandsintown: { ...(cur?.eventId ? { eventId: cur.eventId } : {}), state: "error", error: msg(e), syncedAt: new Date().toISOString() } },
    });
  }
}

export async function syncShow(ctx: Ctx, showId: string, opts: { createCalendar?: boolean; removeCalendar?: boolean } = {}): Promise<SyncResult> {
  const out: SyncResult = { warnings: [] };
  const show = await db.get("shows", showId);
  if (!show) return out;
  try { await syncCalendar(ctx, show, !!opts.createCalendar, !!opts.removeCalendar, out); } catch (e) { out.warnings.push(`Google Calendar: ${msg(e)}`); }
  const fresh = (await db.get("shows", showId)) ?? show;
  try { await syncBandsintown(ctx, fresh, out); } catch (e) { out.warnings.push(`Bandsintown: ${msg(e)}`); }
  return out;
}
