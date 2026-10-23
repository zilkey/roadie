import { handleUndo } from "@/server/assistant/confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }
  return handleUndo(req.headers.get("authorization"), body);
}
