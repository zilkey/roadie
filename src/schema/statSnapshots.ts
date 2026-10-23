import { z } from "zod";
import { entity, serverMask, dateStr, driveRef } from "./common";

export const statSource = z.enum(["spotifyApi", "spotifyForArtists", "instagram", "bandsintown"]);
/** Doc id is `${source}_${date}`. Never edited. */
export const StatSnapshot = entity({
  source: statSource,
  date: dateStr,
  followers: z.number().int().optional(),
  monthlyListeners: z.number().int().optional(),
  streams: z.number().int().optional(),
  popularity: z.number().int().min(0).max(100).optional(),
  topTracks: z.array(z.strictObject({ title: z.string(), streams: z.number().int() })).optional(),
  importFile: driveRef.optional(),
});
export const StatSnapshotInput = StatSnapshot.omit(serverMask);
export type StatSnapshot = z.infer<typeof StatSnapshot>;
