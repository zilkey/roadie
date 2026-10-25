import { z } from "zod";
import { entity, serverMask, id, ts } from "./common";

export const FileDoc = entity({
  kind: z.enum(["chart", "demo", "rehearsal", "recording", "lyrics", "stems", "other"]),
  title: z.string().min(1),
  songId: id.optional(),
  rehearsalId: id.optional(),
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
