/**
 * Posts: the band's social posts. Photos live in the band's Socials folder (Settings › Google), laid out as in
 * docs/designs/posts-carousels/folder-model.md: the inbox, plus Socials/Posts with one folder per post. posts.setup makes
 * Posts/ and lets the band add to Socials. For now one photo from the band's Drive is posted to the band's Instagram now
 * (posts.publishPhoto). Meta fetches the photo from a signed URL on our server (src/server/meta/media.ts), which streams it
 * from Drive, so nothing outside Drive keeps a copy. Photos uploaded on Posts go to Drive first (/api/posts/upload), into
 * the Socials root.
 */
import { z } from "zod";
import { defineCommand } from "./types";
import { db } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { driveClient, type DriveFile } from "../integrations";
import { bandmates } from "../music";
import { findOrMakeFolder } from "../driveFolders";
import { POSTS_FOLDER_NAME, socialsOf } from "../postFolder";
import { PHOTOS_ONLY, photoType } from "@/lib/photos";
import { graph, GraphError, type Tok } from "../meta/graph";
import { freshToken } from "../meta/connection";
import { signMediaUrl } from "../meta/media";

/** Upload and Make the draft are off until posts.setup has made Socials/Posts. */
export const NOT_SET_UP = "Set up the Socials folder in Settings › Google";
export const NEEDS_CONTENT_MANAGER = "Roadie's Google account needs Content manager on the band's Shared Drive to move photos";

const artistOf = (ctx: Ctx) => {
  if (!ctx.artistId) throw new AppError("artist_required", "Say which artist this is for", 400);
  return ctx.artistId;
};

/** The Socials folder and its Posts/ folder, once Set up has made it; else NOT_SET_UP. */
export async function setUpSocials(artistId: string): Promise<{ socialsId: string; postsId: string }> {
  const { socialsId, postsId } = await socialsOf(artistId);
  if (!postsId) throw new AppError("posts_not_set_up", NOT_SET_UP, 400);
  return { socialsId, postsId };
}

export const postsSetup = defineCommand({
  name: "posts.setup", roles: ["admin", "mcp"],
  description: "Set up the Socials folder chosen in Settings › Google: find or make its Posts folder (one folder per post goes in it) and share Socials with everyone in the band as writer, so they can add photos. " +
    "Checks first that the band's Google account can move files in Socials (Content manager on the Shared Drive); nothing changes if it can't. Safe to run again: it finds Posts and shares with members who joined since.",
  input: z.strictObject({}),
  async run(ctx) {
    const artistId = artistOf(ctx);
    const { socialsId } = await socialsOf(artistId);
    const drive = driveClient({ artistId });
    if (!(await drive.canMoveIn(socialsId))) throw new AppError("drive_permission", NEEDS_CONTENT_MANAGER, 400);
    const socials = await drive.get(socialsId);
    const { folder, made } = await findOrMakeFolder(drive, socialsId, POSTS_FOLDER_NAME);
    const emails = (await bandmates()).map((m) => m.email);
    if (emails.length) await drive.share(socialsId, emails, "writer");
    await db.update(ctx, "artists", artistId, { postFoldersId: folder.id });
    return { socials: { id: socials.id, name: socials.name }, posts: { id: folder.id, made }, sharedWithBand: emails.length };
  },
});

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
  description: "Post one photo (JPEG, HEIC, PNG or WebP) from the band's Drive (driveFileId) to the band's Instagram now, with a caption. Renews the Instagram sign-in first when it's due. Saves the post with its Instagram link, or with Instagram's reason when it fails.",
  input: z.strictObject({ driveFileId: z.string().min(1), caption: z.string().max(2200) }),
  async run(ctx, { driveFileId, caption }) {
    const artistId = artistOf(ctx);
    const { igId, ...token } = await freshToken(artistId);
    let f: DriveFile;
    try { f = await driveClient({ artistId }).get(driveFileId); } catch { throw new AppError("not_found", "Drive can't find that photo", 404); }
    const mimeType = photoType(f.name, f.mimeType);
    if (!mimeType) throw new AppError("invalid_input", PHOTOS_ONLY, 400);
    const { id } = await db.create(ctx, "posts", {
      artistId, caption, media: [{ driveFileId: f.id, mimeType, url: f.webViewLink }], status: "publishing", createdVia: ctx.via,
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

export const postCommands = [postsSetup, postsPublishPhoto];
