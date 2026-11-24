import { authenticate, execute, ARTIST_HEADER } from "@/server/commands/dispatch";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { driveClient } from "@/server/integrations";
import { bandmates, chartsFolderId, demosFolderId, songwritingFolderId } from "@/server/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_FOLDER = {
  demo: () => new AppError("no_demos_folder", "Choose the Demos folder on Settings > Google first", 400),
  chart: () => new AppError("no_charts_folder", "Choose the Charts folder on Settings > Google first", 400),
  writing: () => new AppError("no_songwriting_folder", "Choose the Songwriting folder on Settings > Google first", 400),
};

/**
 * Upload a demo or a chart to a song: multipart form with `file` and `kind` ("demo", the default, or "chart"),
 * `Authorization: Bearer <ID token>` and `x-artist-id`, like the commands. A demo goes into the Demos folder and a chart
 * (PDF, Word doc, image...) into the Charts folder (Settings > Google), under its own name and shared with the band, then
 * it is attached to the song as that kind through files.attach (so it is in history and the song's files). A song in the
 * Writing phase uploads both to the Songwriting folder instead.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await authenticate(req.headers.get("authorization"), req.headers.get(ARTIST_HEADER));
    if (ctx.role !== "admin") throw new AppError("forbidden", "Only admins can upload to a song", 403);
    const { id } = await params;
    const form = await req.formData().catch(() => { throw new AppError("invalid_input", "Send the file as a form upload", 400); });
    const raw = form.get("kind") ?? "demo";
    if (raw !== "demo" && raw !== "chart") throw new AppError("invalid_input", "kind is demo or chart", 400);
    const kind: "demo" | "chart" = raw;
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("invalid_input", `Choose a ${kind} to upload`, 400);

    const song = await db.get(ctx, "songs", id);
    if (!song || song.deletedAt) throw new AppError("not_found", "Song not found", 404);
    const writing = song.status === "writing";
    const folderId = await (writing ? songwritingFolderId : kind === "chart" ? chartsFolderId : demosFolderId)(ctx.artistId);
    if (!folderId) throw NO_FOLDER[writing ? "writing" : kind]();

    const drive = driveClient({ artistId: ctx.artistId });
    const folder = await drive.get(folderId);
    const up = await drive.upload({ name: file.name || `${song.title} ${kind}`, mimeType: file.type || "application/octet-stream", parentId: folderId, data: file });
    // The folder is usually shared with the band already; share the file too so it holds without relying on inheritance.
    await drive.share(up.id, (await bandmates(ctx)).map((m) => m.email));
    const out = await execute(ctx, "files.attach", { songId: id, files: [{ driveFileId: up.id, kind }] });
    return Response.json({ ...out, driveFileId: up.id, url: up.webViewLink, folder: { id: folderId, name: folder.name } });
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: e instanceof Error ? e.message : "Something went wrong" } }, { status: 500 });
  }
}
