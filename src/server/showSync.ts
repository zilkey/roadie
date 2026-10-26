/**
 * Keeps Bandsintown in step with a show. Called by show commands AFTER their Firestore transaction commits. Failures never
 * fail the command: they are recorded on the show as listings.bandsintown.state = "error". Google Calendar is not synced
 * here: an admin sends a show's event on purpose (src/server/calendarSync.ts).
 */
import { db, type Doc } from "./db";
import type { Ctx } from "./ctx";
import { IntegrationError, bandsintownClient } from "./integrations";
import { publicShowName, showCity, type ShowPlaceLike, isPublished } from "@/lib/shows";
import { BAND_TIME_ZONE } from "@/lib/timezone";

export interface SyncResult { warnings: string[]; bandsintown?: "listed" | "updated" | "removed" | "error" }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const notFound = (e: unknown) => e instanceof IntegrationError && e.status === 404;
export const bandsintownEligible = (s: Doc) => isPublished(s) && s.status === "confirmed";

async function syncBandsintown(ctx: Ctx, show: Doc, out: SyncResult) {
  const bit = bandsintownClient();
  const cur = show.listings?.bandsintown as { eventId?: string; state: string } | undefined;
  const eligible = !show.deletedAt && bandsintownEligible(show);
  if (!eligible) {
    // A played show stays on the page as history; hold, unpublished, canceled, dropped and deleted shows come off.
    if (show.status === "played" && !show.deletedAt) return;
    if (!cur) return;
    if (cur.eventId) { try { await bit.delete(cur.eventId); } catch (e) { if (!notFound(e)) throw e; } }
    if (!show.deletedAt) await db.update(ctx, "shows", show.id, { listings: {} });
    out.bandsintown = "removed";
    return;
  }
  const venue = show.venue ? await db.get("venues", show.venue.id) : null;
  const t = show.times as { set?: string; doors?: string };
  // The listing is public: a house concert shows as "House concert" in its city, never the host or the address.
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

export async function syncShow(ctx: Ctx, showId: string): Promise<SyncResult> {
  const out: SyncResult = { warnings: [] };
  const show = await db.get("shows", showId);
  if (!show) return out;
  try { await syncBandsintown(ctx, show, out); } catch (e) { out.warnings.push(`Bandsintown: ${msg(e)}`); }
  return out;
}
