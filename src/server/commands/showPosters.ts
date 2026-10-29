/**
 * A show's posters: files docs with showId (kind poster), uploaded through /api/shows/{id}/posters into the show's Drive
 * folder, "{date} {venue}" inside the Shows folder chosen on Settings > Google (made, and shared with the band, by the
 * first upload). Anyone in the band can add or take off a poster; the Drive file is never touched by a removal.
 */
import { z } from "zod";
import { defineCommand } from "./types";
import { db, run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { driveClient, type DriveFile, type DriveService } from "../integrations";
import { FOLDER_MIME } from "../integrations/drive";
import { bandFolders, bandmates, inspect, sharingOf, showsFolderId, type Bandmate } from "../music";
import { showName } from "@/lib/shows";

export const NO_SHOWS_FOLDER = "Choose the Shows folder on Settings > Google first: the show's folder goes inside it";

export interface FolderInfo { id: string; name: string; url: string }
const info = (f: DriveFile): FolderInfo => ({ id: f.id, name: f.name, url: f.webViewLink });
const id1 = z.string().min(1);

async function liveShow(id: string): Promise<Doc> {
  const show = await db.get("shows", id);
  if (!show || show.deletedAt) throw new AppError("not_found", "Show not found", 404);
  return show;
}
async function requireShow(w: Writer, id: string): Promise<Doc> {
  const show = await w.get("shows", id);
  if (!show || show.deletedAt) throw new AppError("not_found", "Show not found", 404);
  return show;
}

/** "{date} {venue}" (a house concert or festival edition reads as the show page's title does), Drive-safe: no slashes. */
export const showFolderName = (show: { date: string; venue?: { name: string }; kind?: string; hostName?: string; editionName?: string }) =>
  `${show.date} ${showName(show as never)}`.replace(/[/\\]/g, "-").trim();

async function findOrMakeFolder(drive: DriveService, parent: string, name: string, mates: Bandmate[]): Promise<DriveFile> {
  const there = (await drive.search({ parent, mimeType: FOLDER_MIME })).find((f) => f.name === name);
  if (there) return there;
  const folder = await drive.createFolder(name, parent);
  await drive.share(folder.id, mates.map((m) => m.email));
  return folder;
}

/**
 * The show's Drive folder, "{date} {venue}" in the Shows folder, made (and shared with the band) if it isn't there yet and
 * remembered on the show: where posters land. Needs the Shows folder (Settings > Google).
 */
export async function ensureShowFolder(ctx: Ctx, showId: string): Promise<FolderInfo> {
  const show = await liveShow(showId);
  const drive = driveClient({ artistId: ctx.artistId });
  if (show.driveFolderId) {
    try { return info(await drive.get(show.driveFolderId as string)); } catch { /* gone from Drive: make it again */ }
  }
  const parent = await showsFolderId(ctx.artistId);
  if (!parent) throw new AppError("no_shows_folder", NO_SHOWS_FOLDER, 400);
  const folder = await findOrMakeFolder(drive, parent, showFolderName(show as never), await bandmates());
  await db.update(ctx, "shows", showId, { driveFolderId: folder.id, driveFolderName: folder.name });
  return info(folder);
}

export const showsFolder = defineCommand({
  name: "shows.folder", roles: ["admin", "member", "mcp"],
  description: "The show's Drive folder (\"{date} {venue}\" in the Shows folder from Settings > Google), made and shared with the band if it isn't there yet. Returns { id, name, url }.",
  input: z.strictObject({ id: id1 }),
  run: (ctx, { id }) => ensureShowFolder(ctx, id),
});

/** The folders a poster counts as "in the band folder" under: the band's, the Shows folder and the show's own. */
async function showFolders(artistId: string | undefined, show: Doc) {
  const [{ all }, shows] = await Promise.all([bandFolders(artistId), showsFolderId(artistId)]);
  return [...all, ...(shows ? [shows] : []), ...(show.driveFolderId ? [show.driveFolderId as string] : [])];
}

export const showsPostersAttach = defineCommand({
  name: "shows.posters.attach", roles: ["admin", "member", "mcp"],
  description: "Attach Drive files (driveFileId, see drive.search) to a show as its posters. A poster already on the show is skipped. Returns { ids, skipped }.",
  input: z.strictObject({ showId: id1, files: z.array(z.strictObject({ driveFileId: id1, title: z.string().optional() })).min(1) }),
  async run(ctx, i) {
    const show = await liveShow(i.showId);
    const [mates, folders] = await Promise.all([bandmates(), showFolders(ctx.artistId, show)]);
    const drive = driveClient({ artistId: ctx.artistId });
    const docs: Record<string, unknown>[] = [];
    for (const a of i.files) {
      let f: DriveFile;
      try { f = await drive.get(a.driveFileId); } catch { throw new AppError("not_found", `Drive file ${a.driveFileId} not found`, 404); }
      const ins = await inspect(f, mates, folders, drive);
      docs.push({
        kind: "poster", title: a.title?.trim() || f.name, showId: show.id,
        driveFileId: f.id, provider: "drive", url: f.webViewLink, mimeType: f.mimeType, ownerEmail: f.ownerEmail,
        inBandFolder: ins.inBandFolder, sharing: sharingOf(ins.missing), checkedAt: new Date(),
      });
    }
    return run(ctx, async (w) => {
      await requireShow(w, i.showId);
      const have = await w.query("files", (q) => q.where("showId", "==", i.showId));
      const ids: string[] = [];
      let skipped = 0;
      for (const d of docs) {
        if (have.some((f) => f.driveFileId === d.driveFileId)) { skipped++; continue; }
        const r = await w.create("files", d);
        have.push({ ...d, id: r.id } as Doc);
        ids.push(r.id);
      }
      return { ids, skipped };
    });
  },
});

export const showsPostersRemove = defineCommand({
  name: "shows.posters.remove", roles: ["admin", "member", "mcp"],
  description: "Take a poster off its show (the Drive file is untouched).",
  input: z.strictObject({ id: id1 }),
  run: (ctx, { id }) => run(ctx, async (w) => {
    const f = await w.get("files", id);
    if (!f || f.deletedAt || !f.showId) throw new AppError("not_found", "Poster not found", 404);
    return w.softDelete("files", id);
  }),
});

export const showPosterCommands = [showsFolder, showsPostersAttach, showsPostersRemove];
