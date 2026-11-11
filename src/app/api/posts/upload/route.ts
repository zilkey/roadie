import { authenticate, ARTIST_HEADER } from "@/server/commands/dispatch";
import { AppError } from "@/server/errors";
import { driveClient } from "@/server/integrations";
import { bandmates } from "@/server/music";
import { JPEG, JPEG_ONLY, postsMonthFolder } from "@/server/commands/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload a photo for a post: multipart form with `file` (a JPEG), `Authorization: Bearer <ID token>` and `x-artist-id`, like
 * the commands. Admins only. The file goes into this month's folder ("{YYYY-MM}", made if needed) in the Posts folder from
 * Settings › Google, under its own name, shared with the band. Nothing is posted: the page then posts it like a photo picked
 * from Drive.
 */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req.headers.get("authorization"), req.headers.get(ARTIST_HEADER));
    if (ctx.role !== "admin") throw new AppError("forbidden", "Only admins can post", 403);
    const form = await req.formData().catch(() => { throw new AppError("invalid_input", "Send the file as a form upload", 400); });
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("invalid_input", "Choose a photo to upload", 400);
    if (file.type !== JPEG) throw new AppError("invalid_input", JPEG_ONLY, 400);
    const folder = await postsMonthFolder(ctx);
    const drive = driveClient({ artistId: ctx.artistId });
    const up = await drive.upload({ name: file.name || "Photo.jpg", mimeType: JPEG, parentId: folder.id, data: file });
    await drive.share(up.id, (await bandmates()).map((m) => m.email));
    return Response.json({ driveFileId: up.id, name: up.name, mimeType: up.mimeType, url: up.webViewLink, folder: { id: folder.id, name: folder.name, url: folder.webViewLink } });
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: e instanceof Error ? e.message : "Something went wrong" } }, { status: 500 });
  }
}
