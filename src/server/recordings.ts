/**
 * Rehearsal recordings in Drive: each rehearsal has a "{date} Rehearsal" folder inside the recordings folder chosen on
 * Settings > Google. Recordings get there three ways: an upload from the app (uploadRecording), an upload from the iOS
 * Shortcut (the same, through a shortcut token), or a file someone dropped into the folder by hand (the Drive app's
 * share sheet); the last ones show up on the rehearsal page as new recordings (newRecordings) and are adopted one by
 * one with a song (adoptRecording): renamed to the app's convention, shared with the band and attached.
 */
import type { Ctx } from "./ctx";
import { db, type Doc } from "./db";
import { AppError } from "./errors";
import { driveClient, type DriveFile, type DriveService } from "./integrations";
import { bandmates, findRehearsalFolder, folderForRehearsal, rehearsalFolderId } from "./music";
import { filesAttach } from "./commands/music";

export const NO_REHEARSAL_FOLDER = "Choose the rehearsal recordings folder on Settings > Google first";

export interface FolderInfo { id: string; name: string; url: string }
const info = (f: DriveFile): FolderInfo => ({ id: f.id, name: f.name, url: f.webViewLink });

async function liveRehearsal(id: string): Promise<Doc> {
  const reh = await db.get("rehearsals", id);
  if (!reh || reh.deletedAt) throw new AppError("not_found", "Rehearsal not found", 404);
  return reh;
}
async function liveSong(id: string): Promise<Doc> {
  const song = await db.get("songs", id);
  if (!song || song.deletedAt) throw new AppError("not_found", "Song not found", 404);
  return song;
}
async function recordingsFolder(artistId: string | undefined): Promise<string> {
  const parent = await rehearsalFolderId(artistId);
  if (!parent) throw new AppError("no_rehearsal_folder", NO_REHEARSAL_FOLDER, 400);
  return parent;
}

/** "{song} - {date} Rehearsal{ext}": what every recording in the folder is called once the app knows which song it is. */
export function recordingName(songTitle: string, date: string, fileName: string): string {
  const ext = /\.[A-Za-z0-9]{1,5}$/.exec(fileName)?.[0] ?? "";
  return `${songTitle} - ${date} Rehearsal${ext}`;
}

/** The rehearsal's Drive folder, made (and shared with the band) if it isn't there yet: the place to drop recordings into. */
export async function ensureRehearsalFolder(ctx: Ctx, rehearsalId: string): Promise<FolderInfo> {
  const [reh, parent] = await Promise.all([liveRehearsal(rehearsalId), recordingsFolder(ctx.artistId)]);
  const drive = driveClient({ artistId: ctx.artistId });
  const before = await findRehearsalFolder(drive, parent, reh.date as string);
  const folder = before ?? (await folderForRehearsal(drive, parent, reh.date as string));
  if (!before) await drive.share(folder.id, (await bandmates()).map((m) => m.email));
  return info(folder);
}

export interface NewRecording { driveFileId: string; name: string; mimeType: string; url: string; createdAt: string }

/** Files in the rehearsal's folder that aren't attached to the rehearsal yet (audio and video only), oldest first; the folder itself, or null when there is none. */
export async function newRecordings(ctx: Ctx, rehearsalId: string): Promise<{ folder: FolderInfo | null; files: NewRecording[] }> {
  const [reh, parent] = await Promise.all([liveRehearsal(rehearsalId), recordingsFolder(ctx.artistId)]);
  const drive = driveClient({ artistId: ctx.artistId });
  const folder = await findRehearsalFolder(drive, parent, reh.date as string);
  if (!folder) return { folder: null, files: [] };
  const [inFolder, attached] = await Promise.all([drive.search({ parent: folder.id }), db.list("files", (q) => q.where("rehearsalId", "==", rehearsalId))]);
  const have = new Set(attached.map((f) => f.driveFileId as string | undefined).filter(Boolean));
  const files = inFolder
    .filter((f) => !have.has(f.id) && (f.mimeType.startsWith("audio/") || f.mimeType.startsWith("video/")))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((f) => ({ driveFileId: f.id, name: f.name, mimeType: f.mimeType, url: f.webViewLink, createdAt: f.createdAt }));
  return { folder: info(folder), files };
}

/** Rename, share and attach one file to a song at the rehearsal (files.attach, so it is in history and on both pages). */
async function adopt(ctx: Ctx, drive: DriveService, reh: Doc, song: Doc, file: DriveFile) {
  const name = recordingName(song.title as string, reh.date as string, file.name);
  if (file.name !== name) await drive.rename(file.id, name);
  // The folder is usually shared with the band already; share the file too so it holds without relying on inheritance.
  await drive.share(file.id, (await bandmates()).map((m) => m.email));
  // Straight to the command (not dispatch): the caller is already an admin here, and dispatch would pull the registry in.
  const out = (await filesAttach.run(ctx, filesAttach.input.parse({ songId: song.id, rehearsalId: reh.id, files: [{ driveFileId: file.id, kind: "rehearsal", title: name }] }))) as { ids: string[]; skipped: number };
  return { ...out, driveFileId: file.id, name, url: file.webViewLink };
}

/** Upload one recording of a song at a rehearsal into its Drive folder, named for the song, and attach it. */
export async function uploadRecording(ctx: Ctx, rehearsalId: string, songId: string, file: File) {
  const [reh, song, parent] = await Promise.all([liveRehearsal(rehearsalId), liveSong(songId), recordingsFolder(ctx.artistId)]);
  const drive = driveClient({ artistId: ctx.artistId });
  const folder = await folderForRehearsal(drive, parent, reh.date as string);
  const name = recordingName(song.title as string, reh.date as string, file.name);
  const up = await drive.upload({ name, mimeType: file.type || "application/octet-stream", parentId: folder.id, data: file });
  const out = await adopt(ctx, drive, reh, song, up);
  return { ...out, folder: info(folder) };
}

/** A file already in the rehearsal's folder (dropped there by hand) becomes the song's recording at that rehearsal. */
export async function adoptRecording(ctx: Ctx, rehearsalId: string, songId: string, driveFileId: string) {
  const [reh, song, parent] = await Promise.all([liveRehearsal(rehearsalId), liveSong(songId), recordingsFolder(ctx.artistId)]);
  const drive = driveClient({ artistId: ctx.artistId });
  const folder = await findRehearsalFolder(drive, parent, reh.date as string);
  if (!folder) throw new AppError("not_found", "This rehearsal has no Drive folder yet", 404);
  let file: DriveFile;
  try { file = await drive.get(driveFileId); } catch { throw new AppError("not_found", "Drive can't find that file", 404); }
  if (!file.parents.includes(folder.id)) throw new AppError("invalid_input", `${file.name} isn't in the ${folder.name} folder`, 400);
  return adopt(ctx, drive, reh, song, file);
}
