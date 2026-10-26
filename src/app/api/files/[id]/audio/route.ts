import { authenticate, ARTIST_HEADER } from "@/server/commands/dispatch";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { driveClient } from "@/server/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What we pass on from Drive's answer; the rest (cookies, Google's own caching) stays behind. */
const PASS = ["content-type", "content-length", "content-range", "accept-ranges"];

/**
 * The bytes of an audio file the band has attached, streamed from Drive as the band account, for the inline player.
 * `Authorization: Bearer <ID token>` and `x-artist-id`, like the commands; members can listen, not just admins.
 * Streamed (not buffered), so a long rehearsal take isn't held in memory or caught by Cloud Run's 32 MB response cap.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await authenticate(req.headers.get("authorization"), req.headers.get(ARTIST_HEADER));
    const { id } = await params;
    const file = await db.get("files", id);
    if (!file || file.deletedAt || (file.artistId && file.artistId !== ctx.artistId)) throw new AppError("not_found", "File not found", 404);
    if (!file.driveFileId) throw new AppError("not_drive", "Only Drive files play here", 400);
    if (!String(file.mimeType ?? "").startsWith("audio/")) throw new AppError("not_audio", "That file isn't audio", 400);
    const res = await driveClient({ artistId: ctx.artistId }).download(file.driveFileId as string, req.headers.get("range"));
    const headers = new Headers({ "cache-control": "private, no-store" });
    for (const h of PASS) { const v = res.headers.get(h); if (v) headers.set(h, v); }
    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: e instanceof Error ? e.message : "Something went wrong" } }, { status: 500 });
  }
}
