import { z } from "zod";
import { entity, serverMask, driveRef, id } from "./common";

export const Song = entity({
  title: z.string().min(1),
  /** What a printed setlist shows when "Short titles" is on (a long title that would wrap). */
  shortTitle: z.string().optional(),
  writers: z.string().optional(),
  key: z.string().optional(),
  bpm: z.number().int().optional(),
  lengthSec: z.number().int().optional(),
  status: z.enum(["active", "learning", "idea", "retired"]),
  lyricsDoc: driveRef.optional(),
  notes: z.string().optional(),
  /** Values for the artist's songFields, by field id (not label: a rename keeps them). No entry = no value; never an empty string. */
  fields: z.array(z.strictObject({ fieldId: id, value: z.string() })).default([]),
});
export const SongInput = Song.omit(serverMask);
export type Song = z.infer<typeof Song>;
