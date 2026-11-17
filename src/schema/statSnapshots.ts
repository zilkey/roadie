import { z } from "zod";
import { entity, serverMask, id, dateStr, driveRef } from "./common";

export const statSource = z.enum(["spotifyApi", "spotifyForArtists", "instagram", "bandsintown"]);
/** Doc id is `${source}_${date}`. Never edited. */
export const StatSnapshot = entity({
  /** The artist this record belongs to (tenancy phase 2: optional until the prod backfill). */
  artistId: id,
  source: statSource,
  date: dateStr,
  followers: z.number().int().optional(),
  monthlyListeners: z.number().int().optional(),
  streams: z.number().int().optional(),
  popularity: z.number().int().min(0).max(100).optional(),
  importFile: driveRef.optional(),
});
export const StatSnapshotInput = StatSnapshot.omit(serverMask);
export type StatSnapshot = z.infer<typeof StatSnapshot>;
