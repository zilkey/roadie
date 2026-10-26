import { authenticate, execute, ARTIST_HEADER } from "@/server/commands/dispatch";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { driveClient } from "@/server/integrations";
import { bandmates, demosFolderId, songwritingFolderId } from "@/server/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_DEMOS_FOLDER = "Choose the Demos folder on Settings > Google first";
const NO_SONGWRITING_FOLDER = "Choose the Songwriting folder on Settings > Google first";

/**
 * Upload a demo of a song: multipart form with `file`, `Authorization: Bearer <ID token>` and `x-artist-id`, like the
 * commands. The file goes into the Demos folder (Settings > Google) under its own name, shared with the band, then is
 * attached to the song as a demo through files.attach (so it is in history and the song's files). A song in the Writing
 * phase uploads to the Songwriting folder instead.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await authenticate(req.headers.get("authorization"), req.headers.get(ARTIST_HEADER));
    if (ctx.role !== "admin") throw new AppError("forbidden", "Only admins can add demos", 403);
    const { id } = await params;
    const form = await req.formData().catch(() => { throw new AppError("invalid_input", "Send the demo as a form upload", 400); });
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("invalid_input", "Choose a demo to upload", 400);

    const song = await db.get("songs", id);
    if (!song || song.deletedAt) throw new AppError("not_found", "Song not found", 404);
    const writing = song.status === "writing";
    const folderId = await (writing ? songwritingFolderId : demosFolderId)(ctx.artistId);
    if (!folderId) throw writing ? new AppError("no_songwriting_folder", NO_SONGWRITING_FOLDER, 400) : new AppError("no_demos_folder", NO_DEMOS_FOLDER, 400);

    const drive = driveClient({ artistId: ctx.artistId });
    const folder = await drive.get(folderId);
    const up = await drive.upload({ name: file.name || `${song.title} demo`, mimeType: file.type || "application/octet-stream", parentId: folderId, data: file });
    // The folder is usually shared with the band already; share the file too so it holds without relying on inheritance.
    await drive.share(up.id, (await bandmates()).map((m) => m.email));
    const out = await execute(ctx, "files.attach", { songId: id, files: [{ driveFileId: up.id, kind: "demo" }] });
    return Response.json({ ...out, driveFileId: up.id, url: up.webViewLink, folder: { id: folderId, name: folder.name } });
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: e instanceof Error ? e.message : "Something went wrong" } }, { status: 500 });
  }
}
