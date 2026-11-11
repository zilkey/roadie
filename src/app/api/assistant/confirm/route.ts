import { ARTIST_HEADER } from "@/server/commands/dispatch";
import { handleConfirm } from "@/server/assistant/confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }
  return handleConfirm(req.headers.get("authorization"), body, req.headers.get(ARTIST_HEADER));
}
