import { AppError } from "@/server/errors";
import { driveClient, IntegrationError } from "@/server/integrations";
import { signedOk, THUMB_SIZES } from "@/server/signedUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const no = () => text("Not found", 404);

/**
 * A photo's thumbnail for an <img> on our pages: no sign-in, only a link posts.photos, posts.list or posts.get signed
 * (thumbUrl in src/server/signedUrl.ts) for that file of that band, within the hour. `s` (400, 1080 or 2048: the long edge)
 * isn't signed. Streamed from Drive's preview as the band account, so it works whether or not the viewer is signed in to
 * Google (drive.google.com/thumbnail only works when they are). Anything else is a plain 404.
 */
export async function GET(req: Request, { params }: { params: Promise<{ artistId: string; fileId: string }> }) {
  try {
    const { artistId, fileId } = await params;
    const q = new URL(req.url).searchParams;
    const size = Number(q.get("s"));
    if (!(THUMB_SIZES as readonly number[]).includes(size)) return no();
    if (!signedOk("thumb", artistId, fileId, q.get("v") || "0", q.get("exp"), q.get("sig"))) return no();
    const res = await driveClient({ artistId }).thumbnail(fileId, size);
    if (!res.ok || !res.body) return no();
    return new Response(res.body, { status: 200, headers: { "content-type": res.headers.get("content-type") ?? "image/jpeg", "cache-control": "private, max-age=3600" } });
  } catch (e) {
    // No SIGNED_URL_SECRET on a real project (src/server/signedUrl.ts): say so rather than a 404.
    if (e instanceof AppError && e.status === 503) return text(e.message, 503);
    if (!(e instanceof IntegrationError)) console.error(e);
    return no();
  }
}
