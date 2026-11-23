import { signedOk } from "@/server/signedUrl";
import { loadAssets } from "@/server/sites/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A website image for the Website page's preview frame (docs/designs/sites, Decision 3): the sandboxed srcdoc frame sends no
 * sign-in, so the link is signed (scope siteImg) over the artist and the image's sha256.
 */
export async function GET(req: Request, { params }: { params: Promise<{ artistId: string; sha: string }> }) {
  const { artistId, sha } = await params;
  const q = new URL(req.url).searchParams;
  if (!/^[0-9a-f]{64}$/.test(sha) || !signedOk("siteImg", artistId, sha, "0", q.get("exp"), q.get("sig"))) return new Response("Not found", { status: 404 });
  try {
    const a = (await loadAssets(artistId, [sha])).get(sha)!;
    return new Response(new Uint8Array(a.bytes), { headers: { "content-type": a.type, "cache-control": "private, max-age=3600" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
