/**
 * Posts: the band's social posts. For now, one photo from the band's Drive posted to the band's Instagram now
 * (posts.publishPhoto). Meta fetches the photo from a signed URL on our server (src/server/meta/media.ts), which streams it
 * from Drive, so nothing outside Drive keeps a copy. Photos uploaded on Posts go to Drive first (/api/posts/upload), into a
 * "{YYYY-MM}" folder in the Posts folder from Settings › Google.
 */
import { z } from "zod";
import { defineCommand } from "./types";
import { db } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { driveClient, type DriveFile } from "../integrations";
import { bandmates } from "../music";
import { findOrMakeFolder } from "./showPosters";
import { graph, GraphError, type Tok } from "../meta/graph";
import { freshToken } from "../meta/connection";
import { signMediaUrl } from "../meta/media";
import { dateInBandZone } from "@/lib/timezone";

export const NO_POSTS_FOLDER = "Choose a Posts folder in Settings › Google";
export const JPEG_ONLY = "Instagram takes JPEG photos";
export const JPEG = "image/jpeg";

const artistOf = (ctx: Ctx) => {
  if (!ctx.artistId) throw new AppError("artist_required", "Say which artist this is for", 400);
  return ctx.artistId;
};

/** This month's folder ("2026-10") in the Posts folder, made and shared with the band on the month's first upload. */
export async function postsMonthFolder(ctx: Ctx, now = ctx.now ?? new Date()): Promise<DriveFile> {
  const artistId = artistOf(ctx);
  const parent = (await db.get("artists", artistId))?.postsFolderId as string | undefined;
  if (!parent) throw new AppError("no_posts_folder", NO_POSTS_FOLDER, 400);
  return findOrMakeFolder(driveClient({ artistId }), parent, dateInBandZone(now).slice(0, 7), await bandmates());
}

/** How long to wait for Instagram to take the photo. Tests shorten it. */
export const publishTiming = { pollMs: 1500, tries: 40 };

/** Wait until the container is FINISHED; ERROR or EXPIRED fail with Instagram's status text. */
async function finished(containerId: string, token: Tok) {
  for (let i = 0; i < publishTiming.tries; i++) {
    const c = await graph.container(containerId, token);
    if (c.status_code === "FINISHED") return;
    if (c.status_code === "ERROR" || c.status_code === "EXPIRED") throw new GraphError(400, `Instagram couldn't take the photo: ${c.status || c.status_code}`);
    await new Promise((r) => setTimeout(r, publishTiming.pollMs));
  }
  throw new GraphError(504, "Instagram is still working on the photo. Check Instagram in a few minutes before posting it again.");
}

export const postsPublishPhoto = defineCommand({
  name: "posts.publishPhoto", roles: ["admin"],
  description: "Post one JPEG from the band's Drive (driveFileId) to the band's Instagram now, with a caption. Renews the Instagram sign-in first when it's due. Saves the post with its Instagram link, or with Instagram's reason when it fails.",
  input: z.strictObject({ driveFileId: z.string().min(1), caption: z.string().max(2200) }),
  async run(ctx, { driveFileId, caption }) {
    const artistId = artistOf(ctx);
    const { igId, ...token } = await freshToken(artistId);
    let f: DriveFile;
    try { f = await driveClient({ artistId }).get(driveFileId); } catch { throw new AppError("not_found", "Drive can't find that photo", 404); }
    if (f.mimeType !== JPEG) throw new AppError("invalid_input", JPEG_ONLY, 400);
    const { id } = await db.create(ctx, "posts", {
      artistId, caption, media: [{ driveFileId: f.id, mimeType: f.mimeType, url: f.webViewLink }], status: "publishing", createdVia: ctx.via,
    });
    try {
      const container = await graph.createImage(igId, token, signMediaUrl(artistId, id), caption);
      await finished(container.id, token);
      const media = await graph.publish(igId, token, container.id);
      const permalink = (await graph.permalink(media.id, token).catch(() => ({ permalink: undefined }))).permalink ?? null;
      await db.update(ctx, "posts", id, { status: "posted", instagram: { mediaId: media.id, permalink } });
      return { id, status: "posted" as const, permalink };
    } catch (e) {
      // Anything else still leaves the post failed (never stuck on publishing), then goes up as an error.
      const msg = e instanceof Error ? e.message : String(e);
      const error = !(e instanceof GraphError) ? `Something went wrong: ${msg}` : msg.startsWith("Instagram") ? msg : `Instagram said: ${msg}`;
      await db.update(ctx, "posts", id, { status: "failed", error });
      if (!(e instanceof GraphError)) throw e;
      return { id, status: "failed" as const, error };
    }
  },
});

export const postCommands = [postsPublishPhoto];
