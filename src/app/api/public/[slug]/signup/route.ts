import { invalid } from "@/server/errors";
import { SignupBody, signup } from "@/server/fans";
import { publicFail } from "../../lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public: no login, no spam protection (story 31 answer 11): the server validates everything. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const parsed = SignupBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw invalid(parsed.error);
    return Response.json(await signup(slug, parsed.data));
  } catch (e) { return publicFail(e); }
}
