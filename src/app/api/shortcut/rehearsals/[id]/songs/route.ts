import { AppError } from "@/server/errors";
import { authenticateShortcut } from "@/server/shortcut";
import { rehearsalSongs } from "@/server/shortcutLists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** For the Shortcut's "Which song?" step: the rehearsal's songs as `labels` and `ids` (label -> song id), like /api/shortcut/rehearsals. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await authenticateShortcut(/^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1]);
    const { id } = await params;
    return Response.json(await rehearsalSongs(ctx, id));
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
  }
}
