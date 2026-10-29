import { z } from "zod";
import { entity, serverMask, id, ts } from "./common";

/** What a file is. The release kinds (mix, master, session, artwork, liner, promo) only appear on files with an releaseId. */
export const fileKind = z.enum(["chart", "demo", "rehearsal", "recording", "lyrics", "stems", "other", "mix", "master", "session", "artwork", "liner", "promo"]);
export type FileKindValue = z.infer<typeof fileKind>;

/** A note someone left on a mix ("Guitar solo a touch quieter."). */
export const fileNote = z.strictObject({ id: z.string().min(1), authorId: z.string().min(1), name: z.string(), body: z.string().min(1), at: z.string() });
export type FileNote = z.infer<typeof fileNote>;

export const FileDoc = entity({
  kind: fileKind,
  title: z.string().min(1),
  songId: id.optional(),
  rehearsalId: id.optional(),
  /** Release-only files (mixes, masters, artwork...): the release, and the track when it is a track's. They carry no songId. */
  releaseId: id.optional(),
  releaseTrackId: id.optional(),
  /** Mixes and masters: v1, v2... (the number). */
  version: z.number().int().positive().optional(),
  /** The band signed off on this mix or master. */
  approved: z.boolean().optional(),
  notes: z.array(fileNote).optional(),
  key: z.string().optional(),
  // Drive files carry driveFileId (and the three Drive-only checks below); a Spotify/YouTube/web link has only a url, which is its identity.
  driveFileId: z.string().optional(),
  // Absent on files written before links existed: read as "drive" when driveFileId is set (see providerFor in lib/music).
  provider: z.enum(["drive", "spotify", "youtube", "web"]).optional(),
  url: z.string(),
  mimeType: z.string().optional(),
  // ownerEmail, inBandFolder and sharing are Drive facts. Left UNSET for non-Drive links on purpose: a fake owner or sharing "ok"
  // would make the Music tab's sharing warnings claim a check that never happened.
  ownerEmail: z.string().optional(),
  inBandFolder: z.boolean().optional(),
  sharing: z.union([z.literal("ok"), z.strictObject({ missing: z.array(id) })]).optional(),
  checkedAt: ts,
});
export const FileInput = FileDoc.omit(serverMask);
export type FileDoc = z.infer<typeof FileDoc>;
