import { z } from "zod";
import { entity, serverMask, id, via } from "./common";

/** draft: being edited (its photos sit in Socials/Posts/DRAFT - <title>). publishing: going out now. posted. failed: Instagram refused it; editable again. */
export const postStatus = z.enum(["draft", "publishing", "posted", "failed"]);
export type PostStatus = z.infer<typeof postStatus>;

/** Where the photo is centred in the crop: CSS object-position fractions on the upright photo. */
const Focus = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });

/** One photo or video of a post, from the band's Drive. A video (mimeType video/*) isn't cropped and has no alt text or focus. */
export const PostMedia = z.strictObject({
  driveFileId: z.string().min(1),
  mimeType: z.string(),
  /** The photo's Drive link ("Open in Drive"). */
  url: z.string().optional(),
  /** The file name when it was picked. */
  name: z.string().optional(),
  /** Size after EXIF rotation. */
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  /** A video's length and size, when Drive knows them: checked against Instagram's limits before posting. */
  durationMs: z.number().int().optional(),
  bytes: z.number().int().optional(),
  /** Drive's modifiedTime when picked; refreshed by posts.get. Signs the thumbnail, so an edited photo gets a new URL. */
  modifiedTime: z.string().optional(),
  alt: z.string().max(1000).optional(),
  /** Missing = { x: 0.5, y: 0.5 }. */
  focus: Focus.optional(),
  /** The inbox folder it came from: where taking it out of the draft sends it back. */
  from: z.strictObject({ folderId: z.string() }).optional(),
});
export type PostMedia = z.infer<typeof PostMedia>;

/**
 * posts/{id}: one Instagram post, a single photo, a Reel (a single video) or a carousel of photos and videos (media.length),
 * from its draft to posted. A draft's photos sit
 * in its own folder in Socials/Posts (driveFolderId); Roadie alone keeps the status and the carousel order. Posts made by #49
 * have no title, aspect or driveFolderId until scripts/migrate-posts-49.ts moves them. Admins read; the server writes.
 */
export const Post = entity({
  artistId: id,
  /** The folder is "DRAFT - <title>", then "YYYY-MM-DD - <title>" once it's posted. */
  title: z.string().trim().min(1).max(100).optional(),
  caption: z.string().max(2200),
  /** Missing = "4:5". */
  aspect: z.enum(["4:5", "1:1"]).optional(),
  /** In carousel order. */
  media: z.array(PostMedia).min(1).max(10),
  /** The post's folder in Socials/Posts. */
  driveFolderId: z.string().optional(),
  status: postStatus,
  /** When it went out (ISO). */
  postedAt: z.string().optional(),
  instagram: z.strictObject({ mediaId: z.string(), permalink: z.string().nullable() }).optional(),
  /**
   * The Instagram containers a publish made and hadn't posted yet (a video still processing when the request ran out of
   * time): the next publish picks them up, unless the post has changed since (`key` is a hash of what they were made from).
   */
  pending: z.strictObject({ key: z.string(), creationId: z.string().optional(), children: z.array(z.string()).optional() }).optional(),
  /** Why it failed, in Instagram's words. */
  error: z.string().optional(),
  /** Posted, but renaming its folder failed: posts.tidy tries again. */
  driveTidy: z.strictObject({ error: z.string() }).optional(),
  /** Where the post was asked for: the app, Roadie or MCP. */
  createdVia: via,
});
export const PostInput = Post.omit(serverMask);
export type Post = z.infer<typeof Post>;
