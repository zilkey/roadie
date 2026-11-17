/**
 * The time zone a server call works in (tenancy phase 8): the artist's own `artists.timeZone`, read once per call (cached on the
 * ctx object). A call with no artist (a SystemCtx job, a person with no band yet) gets DEFAULT_TIME_ZONE; such a job that knows a
 * venue uses the venue's zone first. A show at a venue with its own `timeZone` uses that, not this (`showZone`).
 */
import type { AnyCtx } from "./ctx";
import { db, type Doc } from "./db";
import { DEFAULT_TIME_ZONE } from "@/lib/timezone";

const cache = new WeakMap<AnyCtx, Promise<string>>();

/** The artist's zone for this call; DEFAULT_TIME_ZONE when the call has no artist. */
export function zoneOf(ctx: AnyCtx): Promise<string> {
  if (!ctx.artistId) return Promise.resolve(DEFAULT_TIME_ZONE);
  let z = cache.get(ctx);
  if (!z) {
    z = db.get(ctx, "artists", ctx.artistId).then((a) => (typeof a?.timeZone === "string" && a.timeZone) || DEFAULT_TIME_ZONE);
    cache.set(ctx, z);
  }
  return z;
}

/** A venue's own zone when it has one, else `fallback` (the artist's, or DEFAULT_TIME_ZONE for a job with no artist). */
export const venueZoneOr = (venue: { timeZone?: unknown } | Record<string, unknown> | null | undefined, fallback: string): string =>
  (typeof venue?.timeZone === "string" && venue.timeZone) || fallback;

/** The zone a show's wall-clock times are in: its venue's own zone, else the artist's (a house concert or festival: the artist's). */
export async function showZone(ctx: AnyCtx, show: Doc | { venue?: { id?: string } | null }): Promise<string> {
  const venue = show.venue?.id ? await db.get(ctx, "venues", show.venue.id) : null;
  return venueZoneOr(venue, await zoneOf(ctx));
}
