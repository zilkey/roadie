import { authenticate, execute, ARTIST_HEADER } from "@/server/commands/dispatch";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { driveClient } from "@/server/integrations";
import { bandmates } from "@/server/music";
import { ensureShowFolder } from "@/server/commands/showPosters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload a poster to a show: multipart form with `file` (an image or PDF), `Authorization: Bearer <ID token>` and
 * `x-artist-id`, like the commands. Anyone in the band can. The file goes into the show's Drive folder ("{date} {venue}" in
 * the Shows folder, made if needed) under its own name, shared with the band, then is attached through shows.posters.attach
 * (so it is in history and on the page).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await authenticate(req.headers.get("authorization"), req.headers.get(ARTIST_HEADER));
    if (ctx.role !== "admin" && ctx.role !== "member") throw new AppError("forbidden", "Only the band can add posters", 403);
    const { id } = await params;
    const form = await req.formData().catch(() => { throw new AppError("invalid_input", "Send the file as a form upload", 400); });
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("invalid_input", "Choose a file to upload", 400);
    const mime = file.type || "application/octet-stream";
    if (!mime.startsWith("image/") && mime !== "application/pdf") throw new AppError("invalid_input", "A poster is a picture or a PDF", 400);

    const show = await db.get("shows", id);
    if (!show || show.deletedAt) throw new AppError("not_found", "Show not found", 404);
    const folder = await ensureShowFolder(ctx, id);
    const drive = driveClient({ artistId: ctx.artistId });
    const up = await drive.upload({ name: file.name || "Poster", mimeType: mime, parentId: folder.id, data: file });
    // The folder is shared with the band already; share the file too so it holds without relying on inheritance.
    await drive.share(up.id, (await bandmates()).map((m) => m.email));
    const out = await execute(ctx, "shows.posters.attach", { showId: id, files: [{ driveFileId: up.id }] });
    return Response.json({ ...out, driveFileId: up.id, url: up.webViewLink, folder });
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: e instanceof Error ? e.message : "Something went wrong" } }, { status: 500 });
  }
}
