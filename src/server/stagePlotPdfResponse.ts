import type { Doc } from "./db";
import { AppError } from "./errors";
import { sheetContext } from "./stagePlotSheet";
import { buildStagePlotPdf, plotFileName } from "./stagePlotPdf";
import { parsePaper } from "@/lib/stagePlots/sheet";

export const failResponse = (e: unknown) => {
  if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
  console.error(e);
  return Response.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
};

/** The PDF for a plot document, as an HTTP response. Never cached: it is always the latest version. */
export async function plotPdfResponse(doc: Doc, req: Request): Promise<Response> {
  const ctx = await sheetContext(doc);
  const pdf = await buildStagePlotPdf({ ...ctx, paper: parsePaper(new URL(req.url).searchParams.get("paper")) });
  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${plotFileName(ctx.plot)}"`, "cache-control": "no-store" },
  });
}
