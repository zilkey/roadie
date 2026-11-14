/**
 * Posts: the band's social posts. Photos live in the band's Socials folder (Settings › Google), laid out as in
 * docs/designs/posts-carousels/folder-model.md: the inbox, plus Socials/Posts with one folder per post. posts.setup makes
 * Posts/ and lets the band add to Socials. Photos are picked from the inbox (posts.photos) into a draft (posts.createDraft),
 * which moves them into Posts/DRAFT - <title>; the editor changes the draft (updateDraft: Firestore only) and the commands
 * that move or rename in Drive can't be undone (src/server/undo.ts). Videos (MP4, MOV) go through the same steps as photos.
 * posts.publish posts a draft to the band's Instagram now, as one photo, a Reel (one video) or a carousel of photos and
 * videos, then renames its folder YYYY-MM-DD - <title>. Meta fetches each photo and video from a signed URL on our server
 * (src/server/meta/media.ts), which renders it from Drive, so nothing outside Drive keeps a copy. Files uploaded on Posts go
 * to Drive first (/api/posts/upload), into the Socials root.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { defineCommand } from "./types";
import { db } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { firestore } from "../admin";
import { driveClient, IntegrationError, type DriveFile, type DriveService } from "../integrations";
import { bandmates } from "../music";
import { findOrMakeFolder } from "../driveFolders";
import { POSTS_FOLDER_NAME, inboxFolders, isEmpty, listAll, moveBack, moveInto, socialsOf, uniqueName } from "../postFolder";
import { thumbUrl } from "../signedUrl";
import { dateInBandZone, dateTimeInBandZone } from "@/lib/timezone";
import { HASHTAG_MAX, MEDIA_ONLY, hashtagCount, isVideo, mediaType, videoProblem } from "@/lib/photos";
import { HEIC_PREVIEW, fromPreview, noPreview } from "../postPhoto";
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

/**
 * A photo or video in the inbox, as Posts › Photos shows it. width/height are upright; takenAt is "YYYY-MM-DD HH:MM",
 * camera-local; durationMs is a video's length, when Drive knows it.
 */
export interface Photo {
  driveFileId: string; name: string; mimeType: string; width?: number; height?: number; durationMs?: number; takenAt: string; folderId: string; thumb: string;
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

/** Upright size: an odd rotation swaps a photo's width and height; a video's are as Drive says. */
const sizeOf = (f: DriveFile) => {
  const im = f.image, odd = (im?.rotation ?? 0) % 2 === 1;
  if (im) return { width: odd ? im.height : im.width, height: odd ? im.width : im.height };
  return f.video ? { width: f.video.width, height: f.video.height } : {};
};

/** A Drive photo or video as a Photo: upright size, a video's length, when it was taken, and a signed thumbnail. */
function photoOf(artistId: string, f: DriveFile, mimeType: string, folderId: string): Photo {
  const im = f.image;
  const created = Date.parse(f.createdAt);
  return {
    driveFileId: f.id, name: f.name, mimeType,
    ...sizeOf(f),
    ...(f.video?.durationMs !== undefined ? { durationMs: f.video.durationMs } : {}),
    takenAt: exifTime(im?.time) ?? (Number.isNaN(created) ? "" : dateTimeInBandZone(new Date(created))),
    folderId, thumb: thumbUrl(artistId, f.id, f.modifiedTime, 400),
  };
}

export const postsPhotos = defineCommand({
  name: "posts.photos", roles: ["admin", "mcp"],
  description: "The photos and videos in the band's Socials inbox (Socials and every folder under it except Posts, where those already used in a post live), newest added first, at most the 2,000 most recently added. " +
    "Also lists the inbox folders, each with how many photos and videos it holds itself. Give `folder` (a folder id) for that folder and its subfolders only. Each says when it was taken (camera time) and which folder it's in; a video (mimeType video/*) says how long it is (durationMs) when Drive knows.",
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
    for (const f of await listAll(drive, [...known], "media", "createdTime desc")) {
      const mimeType = mediaType(f.name, f.mimeType), folderId = f.parents.find((p) => known.has(p));
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

/**
 * A post in the Posts tab's lists. count is how many photos and videos it has, videos how many of them are videos (one
 * video alone is a Reel). thumb is the first item's, signed from its stored modifiedTime (no Drive call). driveFolderId is its
 * folder in Socials/Posts: a draft without one (a #49 post not migrated yet) can't take photos.
 */
export interface PostRow {
  id: string; title?: string; status: z.infer<typeof postStatus>; postedAt?: string; count: number; videos: number; thumb?: string; driveFolderId?: string;
  permalink?: string | null; error?: string; driveTidy?: { error: string };
}

const millis = (t: unknown) => (t as { toMillis?(): number } | undefined)?.toMillis?.() ?? (typeof t === "string" ? Date.parse(t) : 0);

export const postsList = defineCommand({
  name: "posts.list", roles: ["admin", "mcp"],
  description: "The band's posts made in Roadie: `drafts` (drafts, failed posts and any being posted right now, most recently changed first) and `posts` (posted to Instagram, newest first), each with its title, status, how many photos and videos it has (count) and how many are videos (one video alone is a Reel), Instagram link and any error.",
  input: z.strictObject({}),
  async run(ctx) {
    const artistId = artistOf(ctx);
    const docs = await db.list("posts", (q) => q.where("artistId", "==", artistId));
    const rowOf = (d: Record<string, unknown>): PostRow => {
      const media = (d.media as PostMedia[] | undefined) ?? [], first = media[0];
      return {
        id: d.id as string, status: d.status as PostRow["status"], count: media.length, videos: media.filter((m) => isVideo(m.mimeType)).length,
        ...(d.title ? { title: d.title as string } : {}),
        ...(d.postedAt ? { postedAt: d.postedAt as string } : {}),
        ...(d.driveFolderId ? { driveFolderId: d.driveFolderId as string } : {}),
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

/**
 * How often publish asks Instagram whether its containers are ready, and how long it waits in all: under App Hosting's
 * 60-second request limit, since a video can take Instagram minutes. Tests shorten them.
 */
export const publishTiming = { pollMs: 1500, waitMs: 45_000 };

/** Said when Instagram hadn't finished by publishTiming.waitMs; the containers are kept (Post.pending) for the next try. */
export const STILL_PROCESSING = "Instagram is still processing it. Post it again in a minute or two to finish: Roadie picks up where it left off";

/** Instagram hadn't finished the containers by the deadline. */
class StillProcessing extends Error {}
/** A container Instagram couldn't use, with the photo's or video's name. */
class ItemError extends GraphError {
  constructor(public label: string | undefined, message: string) { super(400, message); }
}

/** A container to wait for, and the photo or video it's for (none for the carousel itself). */
interface Waiting { id: string; label?: string; video?: boolean }

/**
 * Wait until every container is FINISHED, asking about the unfinished ones each round, until `deadline` (StillProcessing).
 * ERROR or EXPIRED fail with Instagram's status text and the item's name.
 */
async function finished(items: Waiting[], token: Tok, deadline: number) {
  let left = items;
  for (;;) {
    const next: Waiting[] = [];
    for (const it of left) {
      const c = await graph.container(it.id, token);
      if (c.status_code === "FINISHED") continue;
      if (c.status_code === "ERROR" || c.status_code === "EXPIRED") throw new ItemError(it.label, `Instagram couldn't take the ${it.video ? "video" : "photo"}: ${c.status || c.status_code}`);
      next.push(it);
    }
    left = next;
    if (!left.length) return;
    if (Date.now() + publishTiming.pollMs > deadline) throw new StillProcessing();
    await new Promise((r) => setTimeout(r, publishTiming.pollMs));
  }
}

/** What a post's containers are made from (caption, shape, and each item with its version, alt text and crop), hashed: Post.pending.key. */
const pendingKey = (p: PostDoc) => createHash("sha256").update(JSON.stringify([
  p.caption ?? "", (p as { aspect?: string }).aspect ?? "4:5", p.media.map((m) => [m.driveFileId, m.modifiedTime ?? "", m.alt ?? "", m.focus ?? null]),
])).digest("base64url");

// ---------- drafts: one folder per post in Socials/Posts ----------

export const POSTED_LOCKED = "This post has gone out; it can't be changed";
export const PUBLISHING_LOCKED = "This post is being posted right now";
export const NO_FOLDER = "This post has no folder in Drive yet; run the #49 migration first";
export const DELETE_INSTEAD = "Delete the draft instead";
export const MAX_PHOTOS = 10;
export const TOO_MANY = "A post holds at most 10 photos and videos";
export const TOO_MANY_HASHTAGS = "A caption can have at most 30 hashtags";

/** A photo's name as Roadie says it: the file name without its extension ("IMG_4410"). */
export const photoLabel = (name?: string) => (name ?? "That photo").replace(/\.[^.]+$/, "");

type PostDoc = Record<string, unknown> & {
  id: string; artistId: string; title?: string; status: string; media: PostMedia[]; driveFolderId?: string; caption: string; rev?: number;
  pending?: { key: string; creationId?: string; children?: string[] };
};

/** The band's live post, or a 404. */
async function postOf(ctx: Ctx, id: string): Promise<PostDoc> {
  const artistId = artistOf(ctx);
  const d = await db.get("posts", id);
  if (!d || d.deletedAt || d.artistId !== artistId) throw new AppError("not_found", "That post isn't there", 404);
  return d as PostDoc;
}

/** Draft edits and publish: only a post with its own folder that is a draft or failed. */
function editable(p: PostDoc): asserts p is PostDoc & { driveFolderId: string } {
  if (p.status === "posted") throw new AppError("post_locked", POSTED_LOCKED, 409);
  if (p.status === "publishing") throw new AppError("post_locked", PUBLISHING_LOCKED, 409);
  if (!p.driveFolderId) throw new AppError("post_locked", NO_FOLDER, 409);
}

/** "DRAFT - <title>": a draft's folder name (a failed post keeps it). */
const draftFolder = (title: string) => `DRAFT - ${title}`;

interface Picked { file: DriveFile; mimeType: string; from: string }

/**
 * The checks createDraft and addToDraft make before anything moves: each file is in the inbox (Socials or a folder under it
 * but not under Posts/), is a photo or video and isn't in the trash. A photo in a post's folder names that post. Nothing changes here.
 */
async function pickable(drive: DriveService, artistId: string, ids: string[]): Promise<Picked[]> {
  const { socialsId } = await socialsOf(artistId);
  const inbox = new Set([socialsId, ...(await inboxFolders(drive, artistId)).map((f) => f.id)]);
  const holder = new Map<string, Promise<string | undefined>>();
  /** The post whose folder is `folderId` (one query per parent folder). */
  const postIn = (folderId: string) => {
    if (!holder.has(folderId)) {
      holder.set(folderId, db.list("posts", (q) => q.where("driveFolderId", "==", folderId)).then((rows) => {
        const p = rows.find((r) => r.artistId === artistId && !r.deletedAt);
        return p ? ((p.title as string | undefined) ?? "another post") : undefined;
      }));
    }
    return holder.get(folderId)!;
  };
  const out: Picked[] = [];
  for (const id of ids) {
    let f: DriveFile;
    try { f = await drive.get(id); } catch (e) {
      if (e instanceof IntegrationError && (e.status === 404 || e.status === 403)) throw new AppError("not_found", "Drive can't find one of those photos", 404);
      throw e;
    }
    const n = photoLabel(f.name);
    if (f.trashed) throw new AppError("invalid_input", `${n} is in Drive's trash`, 400);
    const mimeType = mediaType(f.name, f.mimeType);
    if (!mimeType) throw new AppError("invalid_input", `${n} isn't a photo or video. ${MEDIA_ONLY}`, 400);
    const from = f.parents.find((p) => inbox.has(p));
    if (!from) {
      for (const parent of f.parents) {
        const title = await postIn(parent);
        if (title) throw new AppError("in_a_post", `${n} is already in ${title}`, 400);
      }
      throw new AppError("not_in_socials", `${n} isn't in Socials`, 400);
    }
    out.push({ file: f, mimeType, from });
  }
  return out;
}

/** What the post keeps about a photo or video it was given: the moved file (its modifiedTime is after the move). */
function mediaOf(p: Picked, moved: DriveFile): PostMedia {
  const f: DriveFile = { ...p.file, image: moved.image ?? p.file.image, video: moved.video ?? p.file.video };
  return {
    driveFileId: p.file.id, mimeType: p.mimeType, name: p.file.name,
    ...(p.file.webViewLink ? { url: p.file.webViewLink } : {}),
    ...sizeOf(f),
    ...(f.video?.durationMs !== undefined ? { durationMs: f.video.durationMs } : {}),
    ...(isVideo(p.mimeType) && f.size !== undefined ? { bytes: f.size } : {}),
    ...((moved.modifiedTime ?? p.file.modifiedTime) ? { modifiedTime: (moved.modifiedTime ?? p.file.modifiedTime)! } : {}),
    from: { folderId: p.from },
  };
}

/** Move each picked photo into the post folder; on any failure put back the ones this call moved, then throw. */
async function moveAllInto(drive: DriveService, picked: Picked[], to: string): Promise<{ media: PostMedia[]; undo(): Promise<void> }> {
  const done: Picked[] = [], media: PostMedia[] = [];
  const undo = async () => {
    for (const p of done.reverse()) await moveInto(drive, p.file.id, p.from, to).catch(() => undefined);
  };
  try {
    for (const p of picked) {
      const moved = await moveInto(drive, p.file.id, to, p.from);
      done.push(p);
      media.push(mediaOf(p, moved));
    }
  } catch (e) { await undo(); throw e; }
  return { media, undo };
}

const unique = (ids: string[]) => [...new Set(ids)];
const ids = z.array(z.string().min(1)).min(1).max(MAX_PHOTOS);

export const postsGet = defineCommand({
  name: "posts.get", roles: ["admin", "mcp"],
  description: "One post with its photos and videos in carousel order, each with a preview link and whether it's still in Drive (missing) or in Drive's trash (trashed). The post editor opens with this.",
  input: z.strictObject({ id: z.string().min(1) }),
  async run(ctx, { id }) {
    const artistId = artistOf(ctx);
    const post = await postOf(ctx, id);
    const drive = driveClient({ artistId });
    const fresh = new Map<string, string>();
    const photos: Record<string, { thumb1080: string; missing: boolean; trashed: boolean }> = {};
    for (const m of post.media.slice(0, MAX_PHOTOS)) {
      let f: DriveFile | null = null;
      try { f = await drive.get(m.driveFileId); } catch (e) {
        if (!(e instanceof IntegrationError && (e.status === 404 || e.status === 403))) throw e;
      }
      if (f?.modifiedTime && f.modifiedTime !== m.modifiedTime) fresh.set(m.driveFileId, f.modifiedTime);
      photos[m.driveFileId] = { thumb1080: thumbUrl(artistId, m.driveFileId, f?.modifiedTime ?? m.modifiedTime, 1080), missing: !f, trashed: !!f?.trashed };
    }
    // A photo edited in Drive since: keep its new modifiedTime (it signs the thumbnail). Not an edit, so not in history.
    let media = post.media;
    if (fresh.size) {
      const ref = firestore().doc(`posts/${id}`);
      media = await firestore().runTransaction(async (tx) => {
        const cur = ((await tx.get(ref)).data()?.media ?? []) as PostMedia[];
        const next = cur.map((m) => (fresh.has(m.driveFileId) ? { ...m, modifiedTime: fresh.get(m.driveFileId)! } : m));
        tx.update(ref, { media: next });
        return next;
      });
    }
    return { ...post, media, photos };
  },
});

export const postsCreateDraft = defineCommand({
  name: "posts.createDraft", roles: ["admin", "mcp"],
  description: "Make a draft post from 1–10 photos and videos in the Socials inbox (driveFileIds, in carousel order; one video alone posts as a Reel): makes Socials/Posts/DRAFT - <title> in Drive and moves them into it, " +
    "remembering the folder each came from. Refused, changing nothing, when one isn't in Socials or is already in another post. If a step fails, the moves are put back.",
  input: z.strictObject({ title: z.string().trim().min(1).max(100), driveFileIds: ids }),
  async run(ctx, { title, driveFileIds }) {
    const artistId = artistOf(ctx);
    const { postsId } = await setUpSocials(artistId);
    const drive = driveClient({ artistId });
    const picked = await pickable(drive, artistId, unique(driveFileIds));
    const folderName = await uniqueName(drive, postsId, draftFolder(title));
    const folder = await drive.createFolder(folderName, postsId);
    let moved: Awaited<ReturnType<typeof moveAllInto>> | undefined;
    try {
      moved = await moveAllInto(drive, picked, folder.id);
      const { id } = await db.create(ctx, "posts", {
        artistId, title, caption: "", aspect: "4:5", media: moved.media, driveFolderId: folder.id, status: "draft", createdVia: ctx.via,
      });
      return { id, folderName };
    } catch (e) {
      await moved?.undo();
      if (await isEmpty(drive, folder.id).catch(() => false)) await drive.trash(folder.id).catch(() => undefined);
      throw e;
    }
  },
});

export const postsAddToDraft = defineCommand({
  name: "posts.addToDraft", roles: ["admin", "mcp"],
  description: "Add photos and videos from the Socials inbox to the end of a draft (at most 10 in all), moving them into the draft's folder in Drive. Same checks as createDraft; if a step fails, this call's moves are put back.",
  input: z.strictObject({ id: z.string().min(1), driveFileIds: ids }),
  async run(ctx, { id, driveFileIds }) {
    const artistId = artistOf(ctx);
    const post = await postOf(ctx, id);
    editable(post);
    const want = unique(driveFileIds);
    if (post.media.length + want.length > MAX_PHOTOS) throw new AppError("invalid_input", TOO_MANY, 400);
    const drive = driveClient({ artistId });
    const picked = await pickable(drive, artistId, want);
    const moved = await moveAllInto(drive, picked, post.driveFolderId);
    try {
      await db.update(ctx, "posts", id, { media: [...post.media, ...moved.media] });
    } catch (e) { await moved.undo(); throw e; }
    return { count: post.media.length + moved.media.length };
  },
});

const ItemEdit = z.strictObject({
  alt: z.string().max(1000).optional(),
  focus: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
});

export const postsUpdateDraft = defineCommand({
  name: "posts.updateDraft", roles: ["admin", "mcp"],
  description: "Edit a draft (the editor autosaves through this): caption (at most 2,200 characters and 30 hashtags), aspect (4:5 or 1:1), order (every photo's driveFileId, in the new order) and items " +
    "(driveFileId → { alt, focus }; send every photo's entry: alt is the alt text, \"\" clears it; focus {x,y} 0–1 is where the crop is centred). A video isn't cropped and has no alt text on Instagram: its entry is ignored. Changes only Roadie, never Drive.",
  input: z.strictObject({
    id: z.string().min(1),
    patch: z.strictObject({
      caption: z.string().max(2200).nullable().optional(),
      aspect: z.enum(["4:5", "1:1"]).optional(),
      order: z.array(z.string().min(1)).max(MAX_PHOTOS).optional(),
      items: z.record(z.string(), ItemEdit).optional(),
    }),
  }),
  async run(ctx, { id, patch }) {
    const post = await postOf(ctx, id);
    editable(post);
    const out: Record<string, unknown> = {};
    if (patch.caption !== undefined) {
      const caption = patch.caption ?? "";
      if (hashtagCount(caption) > HASHTAG_MAX) throw new AppError("invalid_input", TOO_MANY_HASHTAGS, 400);
      out.caption = caption;
    }
    if (patch.aspect) out.aspect = patch.aspect;
    let media = post.media;
    if (patch.order) {
      const have = media.map((m) => m.driveFileId);
      if (patch.order.length !== have.length || unique(patch.order).length !== have.length || !patch.order.every((x) => have.includes(x))) {
        throw new AppError("invalid_input", "order has to list every photo in the post once", 400);
      }
      media = patch.order.map((x) => media.find((m) => m.driveFileId === x)!);
    }
    if (patch.items) {
      const unknown = Object.keys(patch.items).find((k) => !media.some((m) => m.driveFileId === k));
      if (unknown) throw new AppError("invalid_input", `${unknown} isn't in this post`, 400);
      media = media.map((m) => {
        const e = patch.items![m.driveFileId];
        if (!e || isVideo(m.mimeType)) return m;
        const { alt: _a, focus: _f, ...rest } = m;
        const alt = e.alt !== undefined ? e.alt : m.alt, focus = e.focus !== undefined ? e.focus : m.focus;
        return { ...rest, ...(alt ? { alt } : {}), ...(focus ? { focus } : {}) };
      });
    }
    if (media !== post.media) out.media = media;
    if (Object.keys(out).length) await db.update(ctx, "posts", id, out);
    return db.get("posts", id);
  },
});

export const postsRename = defineCommand({
  name: "posts.rename", roles: ["admin", "mcp"],
  description: "Rename a draft: its title, and its folder in Drive to DRAFT - <title> (with (2), (3)… when another post's folder has that name).",
  input: z.strictObject({ id: z.string().min(1), title: z.string().trim().min(1).max(100) }),
  async run(ctx, { id, title }) {
    const artistId = artistOf(ctx);
    const { postsId } = await setUpSocials(artistId);
    const post = await postOf(ctx, id);
    editable(post);
    const drive = driveClient({ artistId });
    const was = (await drive.get(post.driveFolderId)).name;
    const folderName = await uniqueName(drive, postsId, draftFolder(title), post.driveFolderId);
    if (folderName !== was) await drive.rename(post.driveFolderId, folderName);
    try {
      await db.update(ctx, "posts", id, { title });
    } catch (e) {
      if (folderName !== was) await drive.rename(post.driveFolderId, was).catch(() => undefined);
      throw e;
    }
    return { folderName };
  },
});

/** moveBack, except that a photo Drive no longer has (deleted for good) has nothing to move: null, and it just leaves the post. */
async function backOrGone(drive: DriveService, at: { socialsId: string; postFolderId: string }, m: PostMedia): Promise<string | null> {
  try { return await moveBack(drive, at, m); } catch (e) {
    if (e instanceof IntegrationError && e.status === 404) return null;
    throw e;
  }
}

export const postsRemoveFromDraft = defineCommand({
  name: "posts.removeFromDraft", roles: ["admin", "mcp"],
  description: "Take one photo out of a draft: it moves back in Drive to the folder it came from (or the Socials root if that folder is gone). A draft keeps at least one photo: delete the draft instead.",
  input: z.strictObject({ id: z.string().min(1), driveFileId: z.string().min(1) }),
  async run(ctx, { id, driveFileId }) {
    const artistId = artistOf(ctx);
    const { socialsId } = await setUpSocials(artistId);
    const post = await postOf(ctx, id);
    editable(post);
    const m = post.media.find((x) => x.driveFileId === driveFileId);
    if (!m) throw new AppError("not_found", "That photo isn't in this post", 404);
    if (post.media.length === 1) throw new AppError("invalid_input", DELETE_INSTEAD, 400);
    const drive = driveClient({ artistId });
    const to = await backOrGone(drive, { socialsId, postFolderId: post.driveFolderId }, m);
    const media = post.media.filter((x) => x.driveFileId !== driveFileId);
    try {
      await db.update(ctx, "posts", id, { media });
    } catch (e) {
      if (to) await moveInto(drive, driveFileId, post.driveFolderId, to).catch(() => undefined);
      throw e;
    }
    return { count: media.length };
  },
});

export const postsDeleteDraft = defineCommand({
  name: "posts.deleteDraft", roles: ["admin", "mcp"],
  description: "Delete a draft: every photo moves back in Drive to the folder it came from (or the Socials root), then the draft's folder is trashed if it's empty. " +
    "A photo that can't be moved back stays in the draft, and the draft stays. A folder holding files Roadie didn't put there is left in Drive. Never deletes a photo.",
  input: z.strictObject({ id: z.string().min(1) }),
  async run(ctx, { id }) {
    const artistId = artistOf(ctx);
    const { socialsId } = await setUpSocials(artistId);
    const post = await postOf(ctx, id);
    editable(post);
    const drive = driveClient({ artistId });
    const kept: PostMedia[] = [], notMoved: string[] = [], why: string[] = [];
    for (const m of post.media) {
      try { await backOrGone(drive, { socialsId, postFolderId: post.driveFolderId }, m); } catch (e) {
        kept.push(m);
        notMoved.push(photoLabel(m.name));
        why.push(`Couldn't move ${photoLabel(m.name)} back: ${e instanceof Error ? e.message : String(e)}. The draft keeps it`);
      }
    }
    if (kept.length) {
      if (kept.length < post.media.length) await db.update(ctx, "posts", id, { media: kept });
      return { folderLeft: true, notMoved, message: why.join(". ") };
    }
    const folderLeft = !(await isEmpty(drive, post.driveFolderId));
    let message: string | undefined;
    if (folderLeft) message = `Left ${(await drive.get(post.driveFolderId).catch(() => null))?.name ?? draftFolder(post.title ?? "")} in Drive: it has files Roadie didn't put there`;
    else await drive.trash(post.driveFolderId);
    await db.softDelete(ctx, "posts", id);
    return { folderLeft, notMoved, ...(message ? { message } : {}) };
  },
});

// ---------- posting ----------

/** "YYYY-MM-DD - <title>": a posted post's folder, dated the day it posted in the band's timezone. */
const postedFolder = (postedAt: string, title: string) => `${dateInBandZone(new Date(postedAt))} - ${title}`;

/** Rename a posted post's folder to its posted name; the error's message when Drive refuses. */
async function tidyFolder(artistId: string, post: { driveFolderId?: string; postedAt?: string; title?: string }): Promise<string | null> {
  try {
    const { postsId } = await setUpSocials(artistId);
    if (!post.driveFolderId || !post.postedAt) return null;
    const drive = driveClient({ artistId });
    const name = await uniqueName(drive, postsId, postedFolder(post.postedAt, post.title ?? "Post"), post.driveFolderId);
    if ((await drive.get(post.driveFolderId)).name !== name) await drive.rename(post.driveFolderId, name);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Instagram's reason, as the post keeps it: "Instagram …" as is, else "Instagram said: …", with the item's name when it's one photo's or video's. */
const graphReason = (e: GraphError, photo?: string) => {
  const msg = e.message.startsWith("Instagram") ? e.message : `Instagram said: ${e.message}`;
  return photo ? `${photo}: ${msg}` : msg;
};

export const postsPublish = defineCommand({
  name: "posts.publish", roles: ["admin", "mcp"],
  description: "Post a draft (or a post that failed) to the band's Instagram now: one photo, a Reel (one video), or a carousel of 2–10 photos and videos in the draft's order. Photos are cropped to the post's shape (4:5 or square) around their focus, with their alt text; videos go as they are (a Reel is 3 seconds to 15 minutes, a carousel video 3 to 60 seconds). " +
    "Renews the Instagram sign-in first when it's due. When it goes out, the post keeps its Instagram link and its folder in Drive is renamed YYYY-MM-DD - <title>. If Instagram refuses, the post is marked failed with the reason and Drive is left as it was; it can be posted again. " +
    "A video Instagram is still processing after about 45 seconds leaves the post failed with `processing: true`: publish it again in a minute or two and it picks up where it left off.",
  input: z.strictObject({ id: z.string().min(1) }),
  async run(ctx, { id }) {
    const artistId = artistOf(ctx);
    editable(await postOf(ctx, id));
    const { igId, ...token } = await freshToken(artistId);
    // Claim it: a second publish (or a draft edit) is refused while this one runs.
    const post = await db.run(ctx, async (w) => {
      const p = (await w.get("posts", id)) as PostDoc | null;
      if (!p || p.deletedAt || p.artistId !== artistId) throw new AppError("not_found", "That post isn't there", 404);
      editable(p);
      await w.update("posts", id, { status: "publishing", error: null });
      return p;
    });
    const drive = driveClient({ artistId });
    const deadline = Date.now() + publishTiming.waitMs;
    const carousel = post.media.length > 1, caption = post.caption ?? "";
    // Containers an earlier publish made for this same post, still processing then: picked up rather than made again.
    const key = pendingKey(post);
    const prior = post.pending?.key === key ? post.pending : undefined;
    const keep = (p: { creationId?: string; children?: string[] }) => db.update(ctx, "posts", id, { pending: { key, ...p } });
    let photo: string | undefined;
    try {
      // Instagram's limits on a video, when Drive says how long and how big it is: say so now rather than after it's sent.
      for (const m of post.media) {
        const why = isVideo(m.mimeType) ? videoProblem(m, carousel) : null;
        if (why) throw new GraphError(400, `Instagram won't take it: ${why}`);
      }
      // A HEIC posts from Drive's preview: say so now if Drive hasn't made one yet, rather than Instagram's vaguer error.
      for (const m of post.media) {
        if (!fromPreview(m.mimeType)) continue;
        photo = photoLabel(m.name);
        try { await (await drive.thumbnail(m.driveFileId, HEIC_PREVIEW)).arrayBuffer(); } catch (e) { // read it through: a cancelled body can hang under Next's fetch
          if (e instanceof IntegrationError && e.status === 404) throw new GraphError(400, `Instagram can't take it yet: ${noPreview(m.name)}`);
          throw e;
        }
      }
      photo = undefined;
      let creationId = prior?.creationId;
      if (!carousel) {
        const m = post.media[0], video = isVideo(m.mimeType);
        photo = photoLabel(m.name);
        if (!creationId) {
          const url = signMediaUrl(artistId, id, 0);
          creationId = (video ? await graph.createReel(igId, token, url, caption) : await graph.createImage(igId, token, url, caption, m.alt)).id;
          await keep({ creationId });
        }
        await finished([{ id: creationId, label: photo, video }], token, deadline);
      } else {
        let children = prior?.children?.length === post.media.length ? prior.children : undefined;
        if (!children) {
          children = [];
          for (const [i, m] of post.media.entries()) {
            photo = photoLabel(m.name);
            const url = signMediaUrl(artistId, id, i);
            children.push((isVideo(m.mimeType) ? await graph.createCarouselVideo(igId, token, url) : await graph.createCarouselItem(igId, token, url, m.alt)).id);
          }
          photo = undefined;
          creationId = undefined;
          await keep({ children });
        }
        const kids = children;
        await finished(kids.map((c, i) => ({ id: c, label: photoLabel(post.media[i].name), video: isVideo(post.media[i].mimeType) })), token, deadline);
        photo = undefined;
        if (!creationId) {
          creationId = (await graph.createCarousel(igId, token, kids, caption)).id;
          await keep({ children: kids, creationId });
        }
        await finished([{ id: creationId }], token, deadline);
      }
      photo = undefined;
      const media = await graph.publish(igId, token, creationId);
      const permalink = (await graph.permalink(media.id, token).catch(() => ({ permalink: undefined }))).permalink ?? null;
      const postedAt = new Date().toISOString();
      await db.update(ctx, "posts", id, { status: "posted", postedAt, instagram: { mediaId: media.id, permalink }, error: null, pending: null });
      // Then Drive: the folder takes the posted name. If Drive refuses, the post is still posted, with Finish tidying Drive.
      const tidyError = await tidyFolder(artistId, { ...post, postedAt });
      if (tidyError) {
        await db.update(ctx, "posts", id, { driveTidy: { error: tidyError } });
        return { status: "posted" as const, permalink, driveTidy: { error: tidyError } };
      }
      return { status: "posted" as const, permalink };
    } catch (e) {
      // Still processing: failed for now, keeping the containers for the next try.
      if (e instanceof StillProcessing) {
        await db.update(ctx, "posts", id, { status: "failed", error: STILL_PROCESSING });
        return { status: "failed" as const, error: STILL_PROCESSING, processing: true };
      }
      // Anything else still leaves the post failed (never stuck on publishing), then goes up as an error. Drive is untouched.
      const error = e instanceof GraphError ? graphReason(e, e instanceof ItemError ? e.label : photo) : `Something went wrong: ${e instanceof Error ? e.message : String(e)}`;
      await db.update(ctx, "posts", id, { status: "failed", error, pending: null });
      if (!(e instanceof GraphError)) throw e;
      return { status: "failed" as const, error };
    }
  },
});

export const postsTidy = defineCommand({
  name: "posts.tidy", roles: ["admin", "mcp"],
  description: "Finish tidying Drive for a posted post whose folder couldn't be renamed when it went out: renames its folder to YYYY-MM-DD - <title>. Does nothing (and says ok) when there's nothing left to tidy.",
  input: z.strictObject({ id: z.string().min(1) }),
  async run(ctx, { id }) {
    const artistId = artistOf(ctx);
    const post = await postOf(ctx, id);
    if (post.status !== "posted") throw new AppError("invalid_input", "Only a posted post's folder is tidied", 409);
    if (!post.driveTidy) return { ok: true as const };
    const error = await tidyFolder(artistId, post as PostDoc & { postedAt?: string });
    if (error) throw new AppError("drive_tidy", `Drive still said no: ${error}`, 502);
    await db.update(ctx, "posts", id, { driveTidy: null });
    return { ok: true as const };
  },
});

export const postCommands = [
  postsSetup, postsPhotos, postsList, postsGet, postsCreateDraft, postsAddToDraft, postsUpdateDraft, postsRename, postsRemoveFromDraft, postsDeleteDraft,
  postsPublish, postsTidy,
];
