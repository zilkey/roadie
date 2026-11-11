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
  /** "writing": still being written (the Songwriting tab); its uploaded audio goes to the Songwriting folder, not Demos. */
  status: z.enum(["active", "learning", "retired", "writing"]),
  lyricsDoc: driveRef.optional(),
  notes: z.string().optional(),
  /** Values for the artist's songFields, by field id (not label: a rename keeps them). No entry = no value; never an empty string. */
  fields: z.array(z.strictObject({ fieldId: id, value: z.string() })).default([]),
  /** Set by songs.merge on a duplicate that was folded into another song (the doc is soft-deleted; its page redirects there). */
  mergedInto: id.optional(),
  /** Set by songs.merge on the song that was kept: the songs folded into it, so its history can say "Merged The Bliss (learning) into this song". */
  mergedFrom: z.array(z.strictObject({ id, title: z.string(), status: z.enum(["active", "learning", "retired", "writing"]) })).optional(),
});
/** What db.ts validates for `songs` (the merge markers are written by songs.merge only). */
export const SongRecord = Song.omit(serverMask);
/** What the songs commands accept. */
export const SongInput = SongRecord.omit({ mergedInto: true, mergedFrom: true });
export type Song = z.infer<typeof Song>;
