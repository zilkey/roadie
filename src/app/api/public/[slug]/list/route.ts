import { listView } from "@/server/fans";
import { publicFail } from "../../lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public: no login. What the fan list page (/f/{slug}) shows: the band, the show it is, and the shows to pick instead. ?showId= previews that show's fan page line (a show's Preview link). */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const showId = new URL(req.url).searchParams.get("showId") || undefined;
  try { return Response.json(await listView(slug, new Date(), showId), { headers: { "cache-control": "no-store" } }); } catch (e) { return publicFail(e); }
}
