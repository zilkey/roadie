import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { driveClient, IntegrationError } from "@/server/integrations";
import { mediaSigOk } from "@/server/meta/media";
import { renderPostPhoto, NoPreviewError } from "@/server/postPhoto";
import type { PostMedia } from "@/schema/posts";
import { isVideo } from "@/lib/photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const no = () => text("Not found", 404);

/**
 * One photo of a post, as Meta fetches it to post: no sign-in, only the signed link posts.publish made
 * (src/server/meta/media.ts) for that photo of that post of that band, within the hour. The photo is rendered from Drive as
 * the band account, cropped to the post's shape around its focus (src/server/postPhoto.ts), as a 1080-wide JPEG; it's made
 * on each request and never stored. A video is streamed from Drive as it is (Instagram fits it; nothing is cropped), passing
 * on a Range request so Meta can fetch it in parts. Anything else is a plain 404, so the link says nothing about what exists.
 */
export async function GET(req: Request, { params }: { params: Promise<{ postId: string; index: string }> }) {
  try {
    const { postId, index } = await params;
    const q = new URL(req.url).searchParams;
    if (!/^\d+$/.test(index)) return no();
    const post = await db.get("posts", postId);
    if (!post || post.deletedAt || !mediaSigOk(post.artistId as string, postId, index, q.get("exp"), q.get("sig"))) return no();
    const m = (post.media as PostMedia[] | undefined)?.[Number(index)];
    if (!m) return no();
    if (isVideo(m.mimeType)) return await streamVideo(post.artistId as string, m, req.headers.get("range"));
    const jpeg = await renderPostPhoto(driveClient({ artistId: post.artistId as string }), m, (post.aspect as "4:5" | "1:1" | undefined) ?? "4:5");
    return new Response(new Uint8Array(jpeg), { status: 200, headers: { "content-type": "image/jpeg", "content-length": String(jpeg.length), "cache-control": "private, no-store" } });
  } catch (e) {
    // No SIGNED_URL_SECRET on a real project (src/server/signedUrl.ts): say so rather than a 404.
    if (e instanceof AppError && e.status === 503) return text(e.message, 503);
    // A HEIC Drive hasn't made a preview of yet: say so (Meta's container then fails, and the post says to try again).
    if (e instanceof NoPreviewError) return text(e.message, 503);
    if (!(e instanceof IntegrationError)) console.error(e);
    return no();
  }
}

/** Headers of Drive's answer passed on to Meta for a video (Content-Length only up to CHUNKED_OVER). */
const PASSED = ["content-range", "accept-ranges", "last-modified", "etag"];
/**
 * Cloud Run (App Hosting) refuses an HTTP/1 response over 32 MiB unless it's streamed chunked, so a longer body goes out
 * without its Content-Length.
 */
const CHUNKED_OVER = 30 * 1024 * 1024;

/**
 * A video, streamed from Drive. Its type is the one the post keeps (Drive may call a MOV application/octet-stream), and a
 * Range request gets Drive's 206 with its Content-Range.
 */
async function streamVideo(artistId: string, m: PostMedia, range: string | null): Promise<Response> {
  const res = await driveClient({ artistId }).download(m.driveFileId, range);
  if (!res.body) return no();
  const headers = new Headers({ "content-type": m.mimeType, "cache-control": "private, no-store" });
  for (const h of PASSED) { const v = res.headers.get(h); if (v) headers.set(h, v); }
  const length = Number(res.headers.get("content-length"));
  if (length > 0 && length <= CHUNKED_OVER) headers.set("content-length", String(length));
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  return new Response(res.body, { status: res.status === 206 ? 206 : 200, headers });
}
