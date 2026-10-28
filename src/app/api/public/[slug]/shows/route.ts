import { publicShows } from "@/server/publicShows";
import { publicFail } from "../../lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS" };

/**
 * Public: no login, open CORS, cached for five minutes. The band's upcoming public shows (published and confirmed, the
 * Bandsintown rule) for its website. `?config=<lineup id>` keeps only shows billed as that lineup. Only public fields.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = new URL(req.url).searchParams.get("config") || undefined;
  try {
    return Response.json(await publicShows(slug, { config }), { headers: { ...CORS, "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" } });
  } catch (e) {
    const r = publicFail(e);
    for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
    return r;
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "access-control-max-age": "86400" } });
}
