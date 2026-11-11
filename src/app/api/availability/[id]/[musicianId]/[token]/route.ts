import { z } from "zod";
import { AppError, invalid } from "@/server/errors";
import { answerByToken, viewByToken } from "@/server/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string; musicianId: string; token: string }> };
const fail = (e: unknown) => {
  if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
  console.error(e);
  return Response.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
};

/** Public: no login. The token in the URL is the credential (checked against its stored hash). */
export async function GET(_req: Request, { params }: P) {
  const { id, musicianId, token } = await params;
  try { return Response.json(await viewByToken(id, musicianId, token)); } catch (e) { return fail(e); }
}

const Body = z.strictObject({ answer: z.enum(["yes", "no", "maybe"]), note: z.string().max(500).optional() });
export async function POST(req: Request, { params }: P) {
  const { id, musicianId, token } = await params;
  try {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw invalid(parsed.error);
    await answerByToken(id, musicianId, token, parsed.data.answer, parsed.data.note);
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
