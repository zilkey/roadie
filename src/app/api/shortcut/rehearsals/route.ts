import { AppError } from "@/server/errors";
import { authenticateShortcut } from "@/server/shortcut";
import { recentRehearsals } from "@/server/shortcutLists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * For the iOS Shortcut's "Which rehearsal?" step: `Authorization: Bearer rsk_…`. Answers with the rehearsals around
 * today as `labels` (what Choose from List shows, nearest first) and `ids` (label -> rehearsal id), the shape Shortcuts
 * handles without scripting: Get Dictionary Value "labels" -> Choose from List -> Get Dictionary Value (chosen) from "ids".
 */
export async function GET(req: Request) {
  try {
    const ctx = await authenticateShortcut(/^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1]);
    return Response.json(await recentRehearsals(ctx));
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
  }
}
