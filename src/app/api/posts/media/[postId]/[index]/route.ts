import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { driveClient, IntegrationError } from "@/server/integrations";
import { mediaSigOk } from "@/server/meta/media";
import { renderPostPhoto, NoPreviewError } from "@/server/postPhoto";
import type { PostMedia } from "@/schema/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const no = () => text("Not found", 404);

/**
 * One photo of a post, as Meta fetches it to post: no sign-in, only the signed link posts.publish made
 * (src/server/meta/media.ts) for that photo of that post of that band, within the hour. The photo is rendered from Drive as
 * the band account, cropped to the post's shape around its focus (src/server/postPhoto.ts), as a 1080-wide JPEG; it's made
 * on each request and never stored. Anything else is a plain 404, so the link says nothing about what exists.
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
