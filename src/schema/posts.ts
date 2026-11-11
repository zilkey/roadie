import { z } from "zod";
import { entity, serverMask, id, via } from "./common";

export const postStatus = z.enum(["publishing", "posted", "failed"]);
export type PostStatus = z.infer<typeof postStatus>;

/**
 * posts/{id}: something Roadie posted (or tried to) for the band. For now one photo to the band's Instagram (posts.publishPhoto);
 * platforms, schedules and per-platform results come with their stages (#19). Admins read; the server writes.
 */
export const Post = entity({
  artistId: id,
  caption: z.string().max(2200),
  /** The photo, from the band's Drive. `url` is its Drive link (thumbnails and "open in Drive"). */
  media: z.array(z.strictObject({ driveFileId: z.string().min(1), mimeType: z.string(), url: z.string().optional() })).min(1),
  status: postStatus,
  instagram: z.strictObject({ mediaId: z.string(), permalink: z.string().nullable() }).optional(),
  /** Why it failed, in Instagram's words. */
  error: z.string().optional(),
  /** Where the post was asked for: the app now, Roadie and MCP later. */
  createdVia: via,
});
export const PostInput = Post.omit(serverMask);
export type Post = z.infer<typeof Post>;
