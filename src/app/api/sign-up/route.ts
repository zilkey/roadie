import { signUp } from "@/server/signUp";
import { AppError } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** artists.signUp: start your first band with only a verified Google ID token (no membership yet). See src/server/signUp.ts. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { slug } = await signUp(req.headers.get("authorization"), body);
    return Response.json({ slug });
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
  }
}
