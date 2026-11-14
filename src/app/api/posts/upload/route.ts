import { authenticate, ARTIST_HEADER } from "@/server/commands/dispatch";
import { AppError } from "@/server/errors";
import { driveClient } from "@/server/integrations";
import { setUpSocials } from "@/server/commands/posts";
import { MEDIA_ONLY, mediaType } from "@/lib/photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload a photo or video for a post: multipart form with `file` (a JPEG, HEIC, PNG or WebP photo, or an MP4 or MOV video),
 * `Authorization: Bearer <ID token>` and `x-artist-id`, like the commands (Cloud Run caps a request at 32 MB, so a longer
 * video goes into Socials in Drive instead). Admins only, and only once Set up has run (Settings › Google). The file goes into the root of the Socials
 * folder under its own name, where it's in the inbox like any photo the band adds; Socials is already shared with the band.
 * Nothing is posted: the page then posts it like a file picked from Drive.
 */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req.headers.get("authorization"), req.headers.get(ARTIST_HEADER));
    if (ctx.role !== "admin") throw new AppError("forbidden", "Only admins can post", 403);
    const form = await req.formData().catch(() => { throw new AppError("invalid_input", "Send the file as a form upload", 400); });
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("invalid_input", "Choose a photo or video to upload", 400);
    const mimeType = mediaType(file.name, file.type);
    if (!mimeType) throw new AppError("invalid_input", MEDIA_ONLY, 400);
    if (!ctx.artistId) throw new AppError("artist_required", "Say which artist this is for", 400);
    const { socialsId } = await setUpSocials(ctx.artistId);
    const drive = driveClient({ artistId: ctx.artistId });
    const folder = await drive.get(socialsId);
    const up = await drive.upload({ name: file.name || (mimeType.startsWith("video/") ? "Video.mp4" : "Photo.jpg"), mimeType, parentId: folder.id, data: file });
    return Response.json({ driveFileId: up.id, name: up.name, mimeType: up.mimeType, url: up.webViewLink, folder: { id: folder.id, name: folder.name, url: folder.webViewLink } });
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: e instanceof Error ? e.message : "Something went wrong" } }, { status: 500 });
  }
}
