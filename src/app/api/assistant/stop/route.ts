import { ARTIST_HEADER } from "@/server/commands/dispatch";
import { handleStop } from "@/server/assistant/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }
  return handleStop(req.headers.get("authorization"), body, req.headers.get(ARTIST_HEADER));
}
