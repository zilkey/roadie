import { ARTIST_HEADER } from "@/server/commands/dispatch";
import { handleReadImage } from "@/server/assistant/readImage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: { code: "invalid_input", message: "No image was sent" } }, { status: 400 });
  }
  return handleReadImage(req.headers.get("authorization"), form, req.headers.get(ARTIST_HEADER));
}
