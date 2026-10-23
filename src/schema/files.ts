import { z } from "zod";
import { entity, serverMask, id, ts } from "./common";

export const FileDoc = entity({
  kind: z.enum(["chart", "demo", "rehearsal", "recording", "lyrics", "stems", "other"]),
  title: z.string().min(1),
  songId: id.optional(),
  rehearsalId: id.optional(),
  key: z.string().optional(),
  driveFileId: z.string(),
  url: z.string(),
  mimeType: z.string().optional(),
  ownerEmail: z.string(),
  inBandFolder: z.boolean(),
  sharing: z.union([z.literal("ok"), z.strictObject({ missing: z.array(id) })]),
  checkedAt: ts,
});
export const FileInput = FileDoc.omit(serverMask);
export type FileDoc = z.infer<typeof FileDoc>;
