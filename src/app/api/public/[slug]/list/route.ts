import { listView } from "@/server/fans";
import { publicFail } from "../../lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public: no login. What the fan list page (/f/{slug}) shows: the band, the show it is, and the shows to pick instead. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try { return Response.json(await listView(slug), { headers: { "cache-control": "no-store" } }); } catch (e) { return publicFail(e); }
}
