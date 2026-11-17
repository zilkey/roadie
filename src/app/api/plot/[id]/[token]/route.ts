import { publicPlot } from "@/server/stagePlotShare";
import { failResponse, plotPdfResponse } from "@/server/stagePlotPdfResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public: no login. The token in the URL is the credential (checked against the plot's stored hash). ?paper=letter|a4. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; token: string }> }) {
  try {
    const { id, token } = await params;
    const { ctx, plot } = await publicPlot(id, token);
    return await plotPdfResponse(ctx, plot, req);
  } catch (e) { return failResponse(e); }
}
