/**
 * POST /api/assistant/transcribe: a short mic clip as text, so the person can talk to Roadie or answer a confirm card.
 * The clip goes to the model for this one call and is never stored or logged: only the transcript comes back.
 */
import { googleAI, vertexAI } from "@genkit-ai/google-genai";
import { authenticate } from "../commands/dispatch";
import { AppError } from "../errors";
import { newRunId } from "../ctx";
import { voiceAnswer } from "@/lib/voice-answer";
import { MAX_AUDIO_BYTES, TranscribeMode, type TranscribeResponse } from "@/schema/assistant";
import { getAi, modelLabel, modelMode, withModelRetry } from "./ai";
import { makeCtx, runAs, type Session } from "./run";

/** About this many names go to the model: enough for a band's rooms, songs and people, short enough not to swamp the clip. */
const MAX_NAMES = 400;
const MAX_TRANSCRIPT = 4000;

type Row = Record<string, unknown>;

/**
 * Names the person is likely to say: the artist's musicians, venues the band uses, songs and contacts. The model is told
 * to spell a word that sounds like one of them as listed. A failed read only costs the bias, never the transcript.
 */
async function namesFor(artistId: string | undefined, uid: string): Promise<string[]> {
  const s: Session = { uid, role: "admin", name: "Roadie", artistId, threadId: "voice", runId: newRunId(), replyId: "voice", model: modelLabel() };
  const ctx = makeCtx(s);
  const read = async (kind: string, key: string): Promise<string[]> => {
    try {
      const r = (await runAs(ctx, "records.list", { kind, limit: 200, fields: [key] })).result as { rows: Row[] };
      return r.rows.map((x) => x[key]).filter((v): v is string => typeof v === "string");
    } catch { return []; }
  };
  const lists = await Promise.all([read("musicians", "name"), read("venues", "name"), read("songs", "title"), read("contacts", "name")]);
  const seen = new Set<string>();
  const out: string[] = [];
  // Round-robin so a long song list doesn't push every venue and person out of the cap.
  for (let i = 0; out.length < MAX_NAMES && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const n = l[i]?.trim();
      if (n && out.length < MAX_NAMES && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push(n); }
    }
  }
  return out;
}

/**
 * Speech to text with Gemini, biased toward the band's own names. In fake mode (emulators, tests) there is no model call:
 * a `text/plain` clip is returned as its own UTF-8 text, so e2e and unit tests can "speak" a transcript; anything else is "".
 */
export async function transcribe(input: { artistId?: string; audio: Uint8Array; mimeType: string; uid?: string; names?: boolean }): Promise<string> {
  if (modelMode() === "fake") return input.mimeType.startsWith("text/plain") ? new TextDecoder().decode(input.audio).trim().slice(0, MAX_TRANSCRIPT) : "";
  // A yes / no needs no names, and skipping the four reads makes the answer come back sooner.
  const names = input.names === false ? [] : await namesFor(input.artistId, input.uid ?? "voice");
  // "audio/webm;codecs=opus" from Chrome: the model wants the bare type.
  const mimeType = input.mimeType.split(";")[0].trim();
  const { ai, model: defaultModel } = await getAi();
  const name = process.env.ROADIE_TRANSCRIBE_MODEL;
  const mode = modelMode();
  const model = name && name !== modelLabel() ? (mode === "vertex" ? vertexAI.model(name) : googleAI.model(name)) : defaultModel;
  const prompt = [
    "Transcribe exactly what was said in this audio clip. It is English, spoken to a band-management assistant.",
    names.length ? `When a word sounds like one of these names, spell it as it is here:\n${names.join("\n")}` : "",
    "Return only the transcript, with no quotes or commentary. If there is no speech, return nothing.",
  ].filter(Boolean).join("\n\n");
  const b64 = Buffer.from(input.audio).toString("base64");
  const res = await withModelRetry(() => ai.generate({
    model: model as never,
    prompt: [{ media: { url: `data:${mimeType};base64,${b64}`, contentType: mimeType } }, { text: prompt }],
  }));
  return res.text.trim().slice(0, MAX_TRANSCRIPT);
}

/** POST /api/assistant/transcribe: admins only, like the rest of Roadie. The audio is read, transcribed and dropped. */
export async function handleTranscribe(authHeader: string | null, form: FormData, artistHeader?: string | null): Promise<Response> {
  try {
    const ctx = await authenticate(authHeader, artistHeader);
    if (ctx.role !== "admin") throw new AppError("forbidden", "Roadie is for admins", 403);
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) throw new AppError("invalid_input", "No audio was sent", 400);
    if (audio.size > MAX_AUDIO_BYTES) throw new AppError("too_large", "That clip is too long", 413);
    const mode = TranscribeMode.safeParse(form.get("mode"));
    if (!mode.success) throw new AppError("invalid_input", "mode must be message or answer", 400);
    const mimeType = audio.type || "audio/webm";
    const text = await transcribe({ artistId: ctx.artistId, audio: new Uint8Array(await audio.arrayBuffer()), mimeType, uid: ctx.uid, names: mode.data === "message" });
    const body: TranscribeResponse = mode.data === "answer" ? { text, answer: voiceAnswer(text) } : { text };
    return Response.json(body);
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
  }
}
