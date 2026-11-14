/**
 * The Drive steps every posts command shares, on the Socials layout (docs/designs/posts-carousels/folder-model.md):
 * Socials (artists.postsFolderId) is the inbox, with every folder under it except Posts/ (artists.postFoldersId), which holds
 * one folder per post. Roadie moves photos between the inbox and a post folder, and makes, renames and trashes post folders;
 * it never deletes a photo.
 *
 * Each function takes the DriveService to use, so a command makes one client (as the band account) and passes it along.
 */
import { db } from "./db";
import { AppError } from "./errors";
import { IntegrationError, type DriveFile, type DriveListOpts, type DriveService } from "./integrations";
import { FOLDER_MIME } from "./integrations/drive";
import type { PostMedia } from "@/schema/posts";

export const POSTS_FOLDER_NAME = "Posts";
export const NO_SOCIALS_FOLDER = "Choose the Socials folder in Settings › Google first";
/** Parents per list() call: keeps Drive's `q` well under its length limit. */
export const PARENTS_PER_QUERY = 20;

/** Every file of every page of a list() over `parents`, PARENTS_PER_QUERY parents at a time. */
export async function listAll(drive: DriveService, parents: string[], kind: DriveListOpts["kind"], orderBy?: "createdTime desc"): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  for (let i = 0; i < parents.length; i += PARENTS_PER_QUERY) {
    let pageToken: string | undefined;
    do {
      const page = await drive.list({ parents: parents.slice(i, i + PARENTS_PER_QUERY), kind, ...(orderBy ? { orderBy } : {}), ...(pageToken ? { pageToken } : {}) });
      out.push(...page.files);
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  return out;
}

/** Nothing at all is in the folder: a PDF or a video someone added counts, so the folder isn't empty. */
export async function isEmpty(drive: DriveService, folderId: string): Promise<boolean> {
  return (await drive.list({ parents: [folderId], kind: "all", pageSize: 1 })).files.length === 0;
}

/** `base`, else "base (2)", "base (3)"…: the first name no other folder in `parentId` has. `self` is a folder being renamed, whose own name doesn't count. */
export async function uniqueName(drive: DriveService, parentId: string, base: string, self?: string): Promise<string> {
  const taken = new Set((await listAll(drive, [parentId], "folders")).filter((f) => f.id !== self).map((f) => f.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} (${n})`)) return `${base} (${n})`;
}

/** The artist's Socials folder and its Posts/ folder (when Set up has made it). */
export async function socialsOf(artistId: string): Promise<{ socialsId: string; postsId?: string }> {
  const a = await db.get("artists", artistId);
  const socialsId = a?.postsFolderId as string | undefined;
  if (!socialsId) throw new AppError("no_posts_folder", NO_SOCIALS_FOLDER, 400);
  return { socialsId, ...(a?.postFoldersId ? { postsId: a.postFoldersId as string } : {}) };
}

export interface InboxFolder { id: string; name: string; parentId: string }

/**
 * Every folder under Socials except Posts/ (and what's in it), one level at a time. Socials itself isn't in the list: its
 * direct subfolders have it as parentId. Posts/ is skipped by its id once Set up has saved it, and by its name directly in
 * Socials before that.
 */
export async function inboxFolders(drive: DriveService, artistId: string): Promise<InboxFolder[]> {
  const { socialsId, postsId } = await socialsOf(artistId);
  const out: InboxFolder[] = [];
  const seen = new Set([socialsId]);
  let level = [socialsId];
  while (level.length) {
    const next: string[] = [];
    for (const f of await listAll(drive, level, "folders")) {
      const parentId = f.parents.find((p) => level.includes(p)) ?? f.parents[0];
      if (seen.has(f.id) || f.id === postsId || (parentId === socialsId && f.name === POSTS_FOLDER_NAME)) continue;
      seen.add(f.id);
      out.push({ id: f.id, name: f.name, parentId });
      next.push(f.id);
    }
    level = next;
  }
  return out;
}

/** Move a photo from `from` into `to`. */
export async function moveInto(drive: DriveService, fileId: string, to: string, from: string): Promise<DriveFile> {
  return drive.update(fileId, { addParents: [to], removeParents: [from] });
}

/** Is this a folder that's still there (not trashed)? */
async function liveFolder(drive: DriveService, id: string): Promise<boolean> {
  try {
    const f = await drive.get(id);
    return f.mimeType === FOLDER_MIME && !f.trashed;
  } catch (e) {
    if (e instanceof IntegrationError && (e.status === 404 || e.status === 403)) return false;
    throw e;
  }
}

/**
 * Send a photo out of its post folder back to the folder it came from (`from.folderId`), or to the Socials root when that
 * folder is gone or trashed (or wasn't recorded). Returns the folder it went to.
 */
export async function moveBack(drive: DriveService, at: { socialsId: string; postFolderId: string }, media: Pick<PostMedia, "driveFileId" | "from">): Promise<string> {
  const back = media.from?.folderId;
  const to = back && (await liveFolder(drive, back)) ? back : at.socialsId;
  await moveInto(drive, media.driveFileId, to, at.postFolderId);
  return to;
}
