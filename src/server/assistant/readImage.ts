/**
 * POST /api/assistant/read-image: the words in a pasted, dropped or picked image (a flyer, a screenshot of an email or a
 * text thread, a photo of a setlist), so the person can send them to Roadie. Like voice (transcribe.ts): the image goes
 * to the model for this one call and is never stored or logged; only the text comes back, into the message box, where
 * the person edits it and sends it as an ordinary message.
 */
import { spend } from "../usage";
import { googleAI, vertexAI } from "@genkit-ai/google-genai";
import { authenticate } from "../commands/dispatch";
import { AppError } from "../errors";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGE_TEXT, type ReadImageResponse } from "@/schema/assistant";
import { getAi, modelLabel, modelMode, withModelRetry } from "./ai";

/** The PNG text chunk (keyword `ocr`) a test image carries: what fake mode "reads" from it. */
export const FAKE_OCR_KEY = "ocr";

/** The `tEXt` chunk with this keyword in a PNG, or undefined. Fake mode's stand-in for reading the picture. */
export function pngText(bytes: Uint8Array, key = FAKE_OCR_KEY): string | undefined {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || sig.some((b, i) => bytes[i] !== b)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder("latin1");
  for (let at = 8; at + 12 <= bytes.length;) {
    const len = view.getUint32(at);
    const type = dec.decode(bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + len));
    if (type === "tEXt") {
      const nul = data.indexOf(0);
      if (nul > 0 && dec.decode(data.subarray(0, nul)) === key) return new TextDecoder().decode(data.subarray(nul + 1));
    }
    if (type === "IEND") break;
    at += 12 + len;
  }
  return undefined;
}

export const OCR_PROMPT = [
  "Copy out all the text in this image, for a band-management assistant to act on.",
  "Keep the reading order and line breaks. Keep dates, times, prices, addresses, emails, phone numbers and links exactly as written.",
  "For a screenshot of a text thread, chat or email, put who wrote each message before it (\"Name: message\"), and leave out the app's own buttons, menus and status bar.",
  "Return only the text, with no quotes, headings or commentary. If there is no readable text, return nothing.",
].join("\n");

/** The text in an image, by Gemini. Fake mode (emulators, tests) makes no model call: a PNG's `ocr` text chunk, else "". */
export async function readImage(input: { image: Uint8Array; mimeType: string }): Promise<string> {
  if (modelMode() === "fake") return (pngText(input.image) ?? "").trim().slice(0, MAX_IMAGE_TEXT);
  const mimeType = input.mimeType.split(";")[0].trim().toLowerCase();
  const { ai, model: defaultModel } = await getAi();
  const name = process.env.ROADIE_OCR_MODEL;
  const model = name && name !== modelLabel() ? (modelMode() === "vertex" ? vertexAI.model(name) : googleAI.model(name)) : defaultModel;
  const b64 = Buffer.from(input.image).toString("base64");
  const res = await withModelRetry(() => ai.generate({
    model: model as never,
    prompt: [{ media: { url: `data:${mimeType};base64,${b64}`, contentType: mimeType } }, { text: OCR_PROMPT }],
  }));
  return res.text.trim().slice(0, MAX_IMAGE_TEXT);
}

/** POST /api/assistant/read-image (multipart `image`): admins only, like the rest of Roadie. The image is read and dropped. */
export async function handleReadImage(authHeader: string | null, form: FormData, artistHeader?: string | null): Promise<Response> {
  try {
    const ctx = await authenticate(authHeader, artistHeader);
    if (ctx.role !== "admin") throw new AppError("forbidden", "Roadie is for admins", 403);
    const image = form.get("image");
    if (!(image instanceof Blob) || image.size === 0) throw new AppError("invalid_input", "No image was sent", 400);
    const mimeType = (image.type || "").split(";")[0].trim().toLowerCase();
    if (!(IMAGE_TYPES as readonly string[]).includes(mimeType)) throw new AppError("invalid_input", "That isn't an image I can read (PNG, JPEG, WebP, GIF or HEIC)", 400);
    if (image.size > MAX_IMAGE_BYTES) throw new AppError("too_large", "That image is too big", 413);
    await spend(ctx, "imageReads");
    const text = await readImage({ image: new Uint8Array(await image.arrayBuffer()), mimeType });
    const body: ReadImageResponse = { text };
    return Response.json(body);
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
  }
}
