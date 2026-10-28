import { AppError } from "@/server/errors";
import { authenticateShortcut } from "@/server/shortcut";
import { shortcutNow } from "@/server/shortcutLists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * For the iOS Shortcut's first step: `Authorization: Bearer rsk_…`. When a rehearsal is on now (today, between its start and end
 * time) answers `{ rehearsal: { id, date, label }, songs: { labels, ids } }` so the Shortcut skips "Which rehearsal?"; otherwise
 * `{ rehearsals: { labels, ids } }` like /api/shortcut/rehearsals. The Shortcut branches on whether `rehearsal` is set.
 */
export async function GET(req: Request) {
  try {
    const ctx = await authenticateShortcut(/^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1]);
    return Response.json(await shortcutNow(ctx));
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
  }
}
