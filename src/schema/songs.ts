import { z } from "zod";
import { entity, serverMask, driveRef } from "./common";

export const Song = entity({
  title: z.string().min(1),
  writers: z.string().optional(),
  key: z.string().optional(),
  bpm: z.number().int().optional(),
  lengthSec: z.number().int().optional(),
  status: z.enum(["active", "learning", "idea", "retired"]),
  lyricsDoc: driveRef.optional(),
  notes: z.string().optional(),
});
export const SongInput = Song.omit(serverMask);
export type Song = z.infer<typeof Song>;
