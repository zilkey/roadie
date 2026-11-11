import { db } from "@/server/db";
import { driveClient } from "@/server/integrations";
import { mediaSigOk } from "@/server/meta/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What we pass on from Drive's answer. */
const PASS = ["content-type", "content-length"];
const no = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

/**
 * A post's photo for Meta to fetch: no sign-in, only the signed link posts.publishPhoto made (src/server/meta/media.ts),
 * for that post of that band, within the hour. Streamed from Drive as the band account; no public copy is made. Anything
 * else is a plain 404, so the link says nothing about what exists.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const q = new URL(req.url).searchParams;
    const post = await db.get("posts", id);
    if (!post || post.deletedAt || !mediaSigOk(post.artistId as string, id, q.get("exp"), q.get("sig"))) return no();
    const file = (post.media as { driveFileId: string }[] | undefined)?.[0];
    if (!file) return no();
    const res = await driveClient({ artistId: post.artistId as string }).download(file.driveFileId);
    if (!res.ok) return no();
    const headers = new Headers({ "cache-control": "private, no-store" });
    for (const h of PASS) { const v = res.headers.get(h); if (v) headers.set(h, v); }
    return new Response(res.body, { status: 200, headers });
  } catch (e) {
    console.error(e);
    return no();
  }
}
