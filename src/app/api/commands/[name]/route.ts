import { dispatch } from "@/server/commands/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }
  const { status, json } = await dispatch(name, req.headers.get("authorization"), body);
  return Response.json(json, { status });
}
