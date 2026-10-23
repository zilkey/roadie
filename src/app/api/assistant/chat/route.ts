import { handleChat } from "@/server/assistant/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }
  return handleChat(req.headers.get("authorization"), body);
}
