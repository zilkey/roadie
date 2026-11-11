import { authenticate, ARTIST_HEADER } from "@/server/commands/dispatch";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { failResponse, plotPdfResponse } from "@/server/stagePlotPdfResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A band member's PDF of one stage plot: `Authorization: Bearer <ID token>` and `x-artist-id`, like the commands. ?paper=letter|a4. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await authenticate(req.headers.get("authorization"), req.headers.get(ARTIST_HEADER));
    const { id } = await params;
    const plot = await db.get("stagePlots", id);
    if (!plot || plot.deletedAt || (plot.artistId && plot.artistId !== ctx.artistId)) throw new AppError("not_found", `Stage plot ${id} not found`, 404);
    return await plotPdfResponse(plot, req);
  } catch (e) { return failResponse(e); }
}
