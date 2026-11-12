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
import { POSTS_FOLDER_NAME, inboxFolders, listAll, socialsOf } from "../postFolder";
import { thumbUrl } from "../signedUrl";
import { dateTimeInBandZone } from "@/lib/timezone";
import { PHOTOS_ONLY, photoType } from "@/lib/photos";
import { postStatus, type PostMedia } from "@/schema/posts";
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

// ---------- reading: the inbox's photos, and the posts ----------

/** A photo in the inbox, as Posts › Photos shows it. width/height are upright; takenAt is "YYYY-MM-DD HH:MM", camera-local. */
export interface Photo {
  driveFileId: string; name: string; mimeType: string; width?: number; height?: number; takenAt: string; folderId: string; thumb: string;
}
export interface PhotoFolder { id: string; name: string; parentId: string; count: number }

/** How many photos Photos reads at most (the most recently added). Tests lower it. */
export const photosLimits = { max: 2000 };
export const CAPPED = "Showing the 2,000 most recently added";
export const NOT_IN_SOCIALS = "That folder isn't in Socials";

/** "YYYY:MM:DD HH:MM:SS" (imageMediaMetadata.time) → "YYYY-MM-DD HH:MM"; null when it isn't that shape. */
const exifTime = (t?: string) => {
  const m = t && /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/.exec(t);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : null;
};

/** A Drive photo as a Photo: upright size (an odd rotation swaps width and height), when it was taken, and a signed thumbnail. */
function photoOf(artistId: string, f: DriveFile, mimeType: string, folderId: string): Photo {
  const im = f.image, odd = (im?.rotation ?? 0) % 2 === 1;
  const created = Date.parse(f.createdAt);
  return {
    driveFileId: f.id, name: f.name, mimeType,
    ...(im ? { width: odd ? im.height : im.width, height: odd ? im.width : im.height } : {}),
    takenAt: exifTime(im?.time) ?? (Number.isNaN(created) ? "" : dateTimeInBandZone(new Date(created))),
    folderId, thumb: thumbUrl(artistId, f.id, f.modifiedTime, 400),
  };
}

export const postsPhotos = defineCommand({
  name: "posts.photos", roles: ["admin", "mcp"],
  description: "The photos in the band's Socials inbox (Socials and every folder under it except Posts, where photos already used in a post live), newest added first, at most the 2,000 most recently added. " +
    "Also lists the inbox folders, each with how many photos it holds itself. Give `folder` (a folder id) for that folder and its subfolders only. Each photo says when it was taken (camera time) and which folder it's in.",
  input: z.strictObject({ folder: z.string().min(1).optional() }),
  async run(ctx, { folder }) {
    const artistId = artistOf(ctx);
    const { socialsId } = await socialsOf(artistId);
    const drive = driveClient({ artistId });
    const all = await inboxFolders(drive, artistId);
    let within = [socialsId, ...all.map((f) => f.id)];
    if (folder && folder !== socialsId) {
      if (!all.some((f) => f.id === folder)) throw new AppError("not_in_socials", NOT_IN_SOCIALS, 400);
      const under = new Set([folder]);
      for (let grew = true; grew;) { grew = false; for (const f of all) if (!under.has(f.id) && under.has(f.parentId)) { under.add(f.id); grew = true; } }
      within = within.filter((id) => under.has(id));
    }
    // Every photo in every inbox folder, so each folder's count is whole; then only the asked-for folders, newest added first, capped.
    const known = new Set([socialsId, ...all.map((f) => f.id)]), wanted = new Set(within);
    const counts = new Map<string, number>();
    const photos: (Photo & { addedAt: string })[] = [];
    for (const f of await listAll(drive, [...known], "images", "createdTime desc")) {
      const mimeType = photoType(f.name, f.mimeType), folderId = f.parents.find((p) => known.has(p));
      if (!mimeType || !folderId) continue;
      counts.set(folderId, (counts.get(folderId) ?? 0) + 1);
      if (wanted.has(folderId)) photos.push({ ...photoOf(artistId, f, mimeType, folderId), addedAt: f.createdAt });
    }
    photos.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    const capped = photos.length > photosLimits.max;
    return {
      folders: all.map((f) => ({ ...f, count: counts.get(f.id) ?? 0 })) as PhotoFolder[],
      photos: photos.slice(0, photosLimits.max).map(({ addedAt: _, ...p }) => p) as Photo[],
      capped,
    };
  },
});

/** A post in the Posts tab's lists. thumb is the first photo's, signed from its stored modifiedTime (no Drive call). */
export interface PostRow {
  id: string; title?: string; status: z.infer<typeof postStatus>; postedAt?: string; count: number; thumb?: string;
  permalink?: string | null; error?: string; driveTidy?: { error: string };
}

const millis = (t: unknown) => (t as { toMillis?(): number } | undefined)?.toMillis?.() ?? (typeof t === "string" ? Date.parse(t) : 0);

export const postsList = defineCommand({
  name: "posts.list", roles: ["admin", "mcp"],
  description: "The band's posts made in Roadie: `drafts` (drafts, failed posts and any being posted right now, most recently changed first) and `posts` (posted to Instagram, newest first), each with its title, status, photo count, Instagram link and any error.",
  input: z.strictObject({}),
  async run(ctx) {
    const artistId = artistOf(ctx);
    const docs = await db.list("posts", (q) => q.where("artistId", "==", artistId));
    const rowOf = (d: Record<string, unknown>): PostRow => {
      const media = (d.media as PostMedia[] | undefined) ?? [], first = media[0];
      return {
        id: d.id as string, status: d.status as PostRow["status"], count: media.length,
        ...(d.title ? { title: d.title as string } : {}),
        ...(d.postedAt ? { postedAt: d.postedAt as string } : {}),
        ...(first ? { thumb: thumbUrl(artistId, first.driveFileId, first.modifiedTime, 400) } : {}),
        ...(d.instagram ? { permalink: (d.instagram as { permalink: string | null }).permalink } : {}),
        ...(d.error ? { error: d.error as string } : {}),
        ...(d.driveTidy ? { driveTidy: d.driveTidy as { error: string } } : {}),
      };
    };
    const drafts = docs.filter((d) => d.status !== "posted").sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt));
    const posted = docs.filter((d) => d.status === "posted")
      .sort((a, b) => (millis(b.postedAt) || millis(b.createdAt)) - (millis(a.postedAt) || millis(a.createdAt)));
    return { drafts: drafts.map(rowOf), posts: posted.map(rowOf) };
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

export const postCommands = [postsSetup, postsPhotos, postsList, postsPublishPhoto];
