import { authenticateShortcut, shortcutErrorResponse } from "@/server/shortcut";
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
    return Response.json({ ok: true, ...(await recentRehearsals(ctx)) });
  } catch (e) {
    return shortcutErrorResponse(e, "Roadie");
  }
}
