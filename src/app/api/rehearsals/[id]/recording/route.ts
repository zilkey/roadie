import { authenticate, execute, ARTIST_HEADER } from "@/server/commands/dispatch";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { driveClient } from "@/server/integrations";
import { bandmates, folderForRehearsal, rehearsalFolderId } from "@/server/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_REHEARSAL_FOLDER = "Choose the rehearsal recordings folder on Settings > Google first";

/**
 * Upload a recording of one song at a rehearsal: multipart form with `songId` and `file`, `Authorization: Bearer <ID token>`
 * and `x-artist-id`, like the commands. The file goes into Drive under the recordings folder (Settings > Google), in the
 * rehearsal's "{date} Rehearsal" folder, named "{song} - {date} Rehearsal.{ext}", shared with the band, then attached to
 * the song and the rehearsal through files.attach (so it is in history and the song's files).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await authenticate(req.headers.get("authorization"), req.headers.get(ARTIST_HEADER));
    if (ctx.role !== "admin") throw new AppError("forbidden", "Only admins can add recordings", 403);
    const { id } = await params;
    const form = await req.formData().catch(() => { throw new AppError("invalid_input", "Send the recording as a form upload", 400); });
    const songId = form.get("songId"), file = form.get("file");
    if (typeof songId !== "string" || !songId) throw new AppError("invalid_input", "Which song is this a recording of?", 400);
    if (!(file instanceof File) || file.size === 0) throw new AppError("invalid_input", "Choose a recording to upload", 400);

    const [reh, song, parent] = await Promise.all([db.get("rehearsals", id), db.get("songs", songId), rehearsalFolderId(ctx.artistId)]);
    if (!reh || reh.deletedAt) throw new AppError("not_found", "Rehearsal not found", 404);
    if (!song || song.deletedAt) throw new AppError("not_found", "Song not found", 404);
    if (!parent) throw new AppError("no_rehearsal_folder", NO_REHEARSAL_FOLDER, 400);

    const drive = driveClient({ artistId: ctx.artistId });
    const date = reh.date as string;
    const folder = await folderForRehearsal(drive, parent, date);
    const ext = /\.[A-Za-z0-9]{1,5}$/.exec(file.name)?.[0] ?? "";
    const up = await drive.upload({ name: `${song.title} - ${date} Rehearsal${ext}`, mimeType: file.type || "application/octet-stream", parentId: folder.id, data: file });
    // The folder is usually shared with the band already; share the file too so it holds without relying on inheritance.
    await drive.share(up.id, (await bandmates()).map((m) => m.email));
    const out = await execute(ctx, "files.attach", { songId, rehearsalId: id, files: [{ driveFileId: up.id, kind: "rehearsal" }] });
    return Response.json({ ...out, driveFileId: up.id, url: up.webViewLink, folder: { id: folder.id, name: folder.name } });
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: e instanceof Error ? e.message : "Something went wrong" } }, { status: 500 });
  }
}
