import { authenticate, ARTIST_HEADER } from "@/server/commands/dispatch";
import { AppError } from "@/server/errors";
import { uploadRecording } from "@/server/recordings";
import { authenticateShortcut, isShortcutToken, shortcutErrorResponse } from "@/server/shortcut";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload a recording of one or more songs at a rehearsal: multipart form with `file` and the songs as `songId` (repeat
 * it for more) and/or `songIds` (ids separated by commas or new lines, what the Shortcut's multi-select sends). Two callers: the app
 * (`Authorization: Bearer <ID token>` and `x-artist-id`, like the commands) and the iOS Shortcut (`Bearer rsk_…`, a
 * shortcut token, which names the artist itself). The file goes into Drive under the recordings folder (Settings >
 * Google), in the rehearsal's "{date} Rehearsal" folder, named "{song}, {song} - {date} Rehearsal.{ext}", shared with
 * the band, then attached to each song and the rehearsal through files.attach (so it is in history and the song's files).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await authenticateEither(req);
    if (ctx.role !== "admin") throw new AppError("forbidden", "Only admins can add recordings", 403);
    const { id } = await params;
    const form = await req.formData().catch(() => { throw new AppError("invalid_input", "Send the recording as a form upload", 400); });
    const file = form.get("file");
    const songIds = [...form.getAll("songId"), ...form.getAll("songIds")]
      .flatMap((v) => (typeof v === "string" ? v.split(/[\s,]+/) : []))
      .filter(Boolean);
    if (songIds.length === 0) throw new AppError("invalid_input", "Which song is this a recording of?", 400);
    if (!(file instanceof File)) throw new AppError("invalid_input", noFile(form), 400);
    if (file.size === 0) throw new AppError("invalid_input", `The recording ${file.name} is empty (0 bytes)`, 400);
    return Response.json(await uploadRecording(ctx, id, songIds, file));
  } catch (e) {
    return shortcutErrorResponse(e, "Upload failed");
  }
}

/**
 * The form arrived without the audio (what happens when the Shortcut's `file` field is a Text field, or the memo
 * didn't come through the share sheet): say what did arrive, so the Shortcut can be fixed.
 */
function noFile(form: FormData): string {
  const had = [...new Set(form.keys())].map((k) => `${k} (${form.get(k) instanceof File ? "file" : "text"})`).join(", ");
  return `No recording came through: the form had ${had || "nothing"}. In the Shortcut, the file field must be a File (not Text) set to Shortcut Input.`;
}

/** A shortcut token (rsk_…) or a Firebase ID token, by what the bearer looks like. */
export async function authenticateEither(req: Request) {
  const auth = req.headers.get("authorization");
  const raw = /^Bearer (.+)$/.exec(auth ?? "")?.[1];
  return isShortcutToken(raw) ? authenticateShortcut(raw) : authenticate(auth, req.headers.get(ARTIST_HEADER));
}
