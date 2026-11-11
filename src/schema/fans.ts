import { z } from "zod";
import { entity, serverMask, id, email, ts } from "./common";

/** A place a fan signed up from. lat/lng come from geocoding (ORS) and are missing when that failed or has not run. */
export const FanCity = z.strictObject({
  city: z.string().min(1).max(80),
  state: z.string().max(40).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

/**
 * One person on an artist's email list: fans/{sha256(artistId:email)}. Private to the artist's admins (rules + commands);
 * members only ever see counts. Written by the public signup (src/server/fans.ts) and the fans.* commands.
 */
export const Fan = entity({
  artistId: id,
  email,
  firstName: z.string().max(60).optional(),
  /** Every place they signed up from, oldest first; the last one is the most recent (it names their Bandzoogle group). */
  cities: z.array(FanCity),
  /** Every show they signed up at. */
  showIds: z.array(id),
  /** "list" = the public page; "paper" = typed in by an admin from a paper sheet. */
  source: z.enum(["list", "paper"]),
  /** What they agreed to, set on their FIRST join through the public page only. Paper signups have none. */
  consent: z.strictObject({ text: z.string(), at: z.string(), page: z.string().max(300) }).optional(),
  lastSeenAt: ts,
  /** Stamped by fans.markSynced once the address is in Bandzoogle: never offered again. */
  bandzoogle: z.strictObject({ addedAt: ts, group: z.string() }).optional(),
});
export const FanInput = Fan.omit(serverMask);
export type Fan = z.infer<typeof Fan>;
export type FanCity = z.infer<typeof FanCity>;
