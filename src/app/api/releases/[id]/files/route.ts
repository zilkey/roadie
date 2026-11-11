import { authenticate, execute, ARTIST_HEADER } from "@/server/commands/dispatch";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { driveClient } from "@/server/integrations";
import { bandmates } from "@/server/music";
import { ensureReleaseFolder } from "@/server/commands/releases";
import { fileKind } from "@/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload a file to a release (artwork, a master...) or, with `trackId`, to one of its tracks (a mix, stems...): multipart
 * form with `file`, optional `trackId` and `kind`, `Authorization: Bearer <ID token>` and `x-artist-id`, like the
 * commands. The file goes into the release's Drive folder (Band folder / Releases / {title}, made if needed) under its own
 * name, shared with the band, then is attached through releases.files.attach (so it is in history and on the page).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await authenticate(req.headers.get("authorization"), req.headers.get(ARTIST_HEADER));
    if (ctx.role !== "admin") throw new AppError("forbidden", "Only admins can add release files", 403);
    const { id } = await params;
    const form = await req.formData().catch(() => { throw new AppError("invalid_input", "Send the file as a form upload", 400); });
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("invalid_input", "Choose a file to upload", 400);
    const trackId = typeof form.get("trackId") === "string" && form.get("trackId") ? String(form.get("trackId")) : undefined;
    const kindIn = typeof form.get("kind") === "string" && form.get("kind") ? fileKind.safeParse(form.get("kind")) : undefined;
    if (kindIn && !kindIn.success) throw new AppError("invalid_input", "Unknown file kind", 400);

    const release = await db.get("releases", id);
    if (!release || release.deletedAt) throw new AppError("not_found", "Release not found", 404);
    const folder = await ensureReleaseFolder(ctx, id);
    const drive = driveClient({ artistId: ctx.artistId });
    const up = await drive.upload({ name: file.name || `${release.title} file`, mimeType: file.type || "application/octet-stream", parentId: folder.id, data: file });
    // The folder is shared with the band already; share the file too so it holds without relying on inheritance.
    await drive.share(up.id, (await bandmates()).map((m) => m.email));
    const out = await execute(ctx, "releases.files.attach", { releaseId: id, ...(trackId ? { trackId } : {}), files: [{ driveFileId: up.id, ...(kindIn?.success ? { kind: kindIn.data } : {}) }] });
    return Response.json({ ...out, driveFileId: up.id, url: up.webViewLink, folder });
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: e instanceof Error ? e.message : "Something went wrong" } }, { status: 500 });
  }
}
