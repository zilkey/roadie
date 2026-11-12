/** Folders Roadie makes in the band's Drive (show folders, release folders, Socials/Posts). */
import type { DriveFile, DriveService } from "./integrations";
import { FOLDER_MIME } from "./integrations/drive";

/**
 * The folder called `name` directly in `parentId`, or a new one. Only a folder made here is shared: with `share.emails`, as
 * `share.role` (reader unless said). A folder that was already there keeps its sharing.
 */
export async function findOrMakeFolder(drive: DriveService, parentId: string, name: string, share?: { emails: string[]; role?: "reader" | "writer" }): Promise<{ folder: DriveFile; made: boolean }> {
  const there = (await drive.search({ parent: parentId, mimeType: FOLDER_MIME })).find((f) => f.name === name);
  if (there) return { folder: there, made: false };
  const folder = await drive.createFolder(name, parentId);
  if (share?.emails.length) await drive.share(folder.id, share.emails, share.role ?? "reader");
  return { folder, made: true };
}
