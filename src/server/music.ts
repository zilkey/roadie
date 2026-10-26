/** Drive-facing helpers for the Music commands: who can open a file, is it in the band folder. */
import { db, type Doc } from "./db";
import { driveClient, type DriveFile, type DriveService } from "./integrations";
import { FOLDER_MIME } from "./integrations/drive";

export interface Bandmate { id: string; name: string; email: string }
export interface Inspection { file: DriveFile; missing: string[]; inBandFolder: boolean }

/** Members = active musicians who have an email. */
export async function bandmates(): Promise<Bandmate[]> {
  const ms = await db.list("musicians");
  return ms.filter((m: Doc) => m.active && m.email).map((m) => ({ id: m.id, name: m.name as string, email: String(m.email).toLowerCase() }));
}

/**
 * The artist's band folder (the one artist there is when no id is given), chosen on Settings > Google
 * (google.setBandFolder). Null until an admin picks one: then nothing is "in the band folder" and copying into it is off.
 */
export async function bandFolderId(artistId?: string): Promise<string | null> {
  const artist = artistId ? await db.get("artists", artistId) : (await db.list("artists"))[0];
  return (artist?.driveFolderId as string | undefined) || null;
}

/** The artist's Charts folder (lyrics, chord sheets...), chosen on Settings > Google (google.setChartsFolder): where Copy to band folder puts copies. Null until an admin picks one. */
export async function chartsFolderId(artistId?: string): Promise<string | null> {
  const artist = artistId ? await db.get("artists", artistId) : (await db.list("artists"))[0];
  return (artist?.chartsFolderId as string | undefined) || null;
}

/** The artist's Demos folder, chosen on Settings > Google (google.setDemosFolder): where audio uploaded to a song goes. Null until an admin picks one. */
export async function demosFolderId(artistId?: string): Promise<string | null> {
  const artist = artistId ? await db.get("artists", artistId) : (await db.list("artists"))[0];
  return (artist?.demosFolderId as string | undefined) || null;
}

/** The band folder and the Charts folder, and both as the list a file counts as "in the band folder" under. */
export async function bandFolders(artistId?: string) {
  const [band, charts] = await Promise.all([bandFolderId(artistId), chartsFolderId(artistId)]);
  return { band, charts, all: [band, charts].filter((f): f is string => !!f) };
}

/** The artist's rehearsal recordings folder, chosen on Settings > Google (google.setRehearsalFolder). Null until an admin picks one. */
export async function rehearsalFolderId(artistId?: string): Promise<string | null> {
  const artist = artistId ? await db.get("artists", artistId) : (await db.list("artists"))[0];
  return (artist?.rehearsalFolderId as string | undefined) || null;
}

/**
 * One rehearsal's folder inside the recordings folder: the first whose name has the date, however it was typed by hand
 * ("2026-10-04 Rehearsal", "2026-09-29 - Rehearsal", "2026-10-13"); otherwise a new "{date} Rehearsal".
 */
export async function folderForRehearsal(drive: DriveService, parent: string, date: string): Promise<DriveFile> {
  const hit = (await drive.search({ parent, mimeType: FOLDER_MIME })).find((f) => f.name.includes(date));
  return hit ?? drive.createFolder(`${date} Rehearsal`, parent);
}

async function inFolder(drive: DriveService, id: string, folder: string, seen = new Set<string>(), depth = 0): Promise<boolean> {
  if (id === folder) return true;
  if (depth > 6 || seen.has(id)) return false;
  seen.add(id);
  let f: DriveFile;
  try { f = await drive.get(id); } catch { return false; }
  for (const p of f.parents) if (await inFolder(drive, p, folder, seen, depth + 1)) return true;
  return false;
}

/**
 * Bandmates who can't open the file. Anyone-with-the-link and domain sharing count (real Drive only); a Google Group
 * can't be expanded, so its members still show as missing until they're shared with directly.
 */
export function missingFor(file: DriveFile, mates: Bandmate[]): string[] {
  if (file.anyoneWithLink) return [];
  const can = new Set([file.ownerEmail, ...file.permissions.map((p) => p.email)].map((e) => e.toLowerCase()));
  const domains = file.domains ?? [];
  return mates.filter((m) => !can.has(m.email) && !domains.some((d) => m.email.endsWith(`@${d}`))).map((m) => m.id);
}

/** `folder` is the band folder, or the band's folders (band and Charts): a file under any of them is in the band folder. */
export async function inspect(file: DriveFile, mates: Bandmate[], folder: string | null | string[], drive: DriveService = driveClient()): Promise<Inspection> {
  const folders = (Array.isArray(folder) ? folder : [folder]).filter((f): f is string => !!f);
  let inBandFolder = false;
  for (const f of folders) {
    for (const p of file.parents) if (await inFolder(drive, p, f)) { inBandFolder = true; break; }
    if (inBandFolder) break;
  }
  return { file, missing: missingFor(file, mates), inBandFolder };
}

export const sharingOf = (missing: string[]) => (missing.length ? { missing } : ("ok" as const));
