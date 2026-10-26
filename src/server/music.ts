/** Drive-facing helpers for the Music commands: who can open a file, is it in the band folder. */
import { db, type Doc } from "./db";
import { driveClient, type DriveFile, type DriveService } from "./integrations";

export interface Bandmate { id: string; name: string; email: string }
export interface Inspection { file: DriveFile; missing: string[]; inBandFolder: boolean }

export const DEFAULT_BAND_FOLDER = process.env.DRIVE_BAND_FOLDER_ID ?? "fake-band-folder";

/** Members = active musicians who have an email. */
export async function bandmates(): Promise<Bandmate[]> {
  const ms = await db.list("musicians");
  return ms.filter((m: Doc) => m.active && m.email).map((m) => ({ id: m.id, name: m.name as string, email: String(m.email).toLowerCase() }));
}

/** The artist's Drive folder (the one artist there is when no id is given). */
export async function bandFolderId(artistId?: string): Promise<string> {
  const artist = artistId ? await db.get("artists", artistId) : (await db.list("artists"))[0];
  return (artist?.driveFolderId as string) || DEFAULT_BAND_FOLDER;
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

export async function inspect(file: DriveFile, mates: Bandmate[], folder: string, drive: DriveService = driveClient()): Promise<Inspection> {
  let inBandFolder = false;
  for (const p of file.parents) if (await inFolder(drive, p, folder)) { inBandFolder = true; break; }
  return { file, missing: missingFor(file, mates), inBandFolder };
}

export const sharingOf = (missing: string[]) => (missing.length ? { missing } : ("ok" as const));
