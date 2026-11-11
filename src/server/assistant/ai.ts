import { genkit, GenkitError, type Genkit, type GenerateRequest, type GenerateResponseData, type Part } from "genkit";
// Imported statically, like genkit: a dynamic import() loads the plugin's ESM build next to genkit's CJS one under tsx,
// and genkit then rejects the plugin's actions (instanceof across two copies). The plugins only need credentials when called.
import { googleAI, vertexAI } from "@genkit-ai/google-genai";
import { script, type Step } from "./script";

export const FAKE_MODEL = "roadie/fake";
/** A user message containing this makes the canned model fail like Vertex did on 2026-10-27 (a 400 after the stream began). Tests only. */
export const FAKE_400 = "[fake: 400]";

export type ModelMode = "fake" | "gemini" | "vertex";
const hasKey = (env: NodeJS.ProcessEnv) => !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENAI_API_KEY);

/**
 * `fake` by default whenever emulators are on (or under test). Otherwise Gemini: through Vertex AI with the server's
 * service account (production; same Google bill, no key), or through the Gemini API when a key is set (trying it locally).
 * ROADIE_MODEL=fake|gemini|vertex forces one.
 */
export function modelMode(env: NodeJS.ProcessEnv = process.env): ModelMode {
  const m = env.ROADIE_MODEL;
  if (m === "fake" || m === "vertex") return m;
  if (m) return "gemini";
  if (env.FIRESTORE_EMULATOR_HOST || env.NODE_ENV === "test") return "fake";
  return hasKey(env) ? "gemini" : "vertex";
}

/** The model's name as history records it. Defaults: Flash on Vertex (Flash-Lite could not pick its way through 190 tools: it asked instead of acting; Gemini 2.5 shut down in October 2026), the latest Flash alias on the Gemini API. */
export const modelLabel = (env: NodeJS.ProcessEnv = process.env) => {
  const mode = modelMode(env);
  if (mode === "fake") return FAKE_MODEL;
  return env.ROADIE_GEMINI_MODEL ?? (mode === "vertex" ? "gemini-3.5-flash" : "gemini-flash-latest");
};

/** The user's last typed message and the tool calls made (and answered) since, rebuilt from the conversation. */
function lastTurn(req: GenerateRequest) {
  const msgs = req.messages;
  let at = -1;
  msgs.forEach((m, i) => { if (m.role === "user") at = i; });
  const text = at >= 0 ? msgs[at].content.map((p) => p.text ?? "").join("") : "";
  const after = msgs.slice(at + 1);
  const requests = after.flatMap((m) => (m.role === "model" ? m.content.flatMap((p) => (p.toolRequest ? [p.toolRequest] : [])) : []));
  const responses = after.flatMap((m) => (m.role === "tool" ? m.content.flatMap((p) => (p.toolResponse ? [p.toolResponse] : [])) : []));
  const steps: Step[] = requests.map((r) => ({ name: r.name, input: r.input, output: responses.find((x) => x.ref === r.ref)?.output }));
  const sys = msgs.find((m) => m.role === "system")?.content.map((p) => p.text ?? "").join("") ?? "";
  const pg = /looking at (\w+) ([\w-]+)/.exec(sys);
  const on = /The user is on ([\w/-]+)(?: \(([\w-]+) tab\))?/.exec(sys);
  return { text, steps, page: pg || on ? { ...(pg ? { kind: pg[1], id: pg[2] } : {}), ...(on ? { route: on[1], ...(on[2] ? { tab: on[2] } : {}) } : {}) } : undefined };
}

function defineFake(ai: Genkit) {
  return ai.defineModel(
    { name: FAKE_MODEL, label: "Roadie (canned)", supports: { tools: true, multiturn: true, systemRole: true, media: false } },
    async (req, send): Promise<GenerateResponseData> => {
      const turn = lastTurn(req);
      if (turn.text.includes(FAKE_400)) {
        send?.({ content: [{ text: "Sure, " }] });
        throw new GenkitError({ status: "INVALID_ARGUMENT", message: "Interaction API returned an error: [invalid_request] Request contains an invalid argument." });
      }
      const out = script(turn);
      const content: Part[] = [];
      if (out.text) {
        // Stream word by word like a real model would.
        for (const w of out.text.match(/\S+\s*/g) ?? []) send?.({ content: [{ text: w }] });
        content.push({ text: out.text });
      }
      (out.calls ?? []).forEach((c, i) => content.push({ toolRequest: { name: c.name, ref: `fake-${turn.steps.length + i}`, input: c.input } }));
      return { message: { role: "model", content }, finishReason: "stop" };
    },
  );
}

let cached: Promise<{ ai: Genkit; model: unknown }> | undefined;

/** One Genkit instance per process. The Google plugin is only set up (and needs credentials) when ROADIE_MODEL is not fake. */
export function getAi(): Promise<{ ai: Genkit; model: unknown }> {
  cached ??= (async () => {
    if (modelMode() === "fake") {
      const ai = genkit({});
      return { ai, model: defineFake(ai) };
    }
    // Never exercised offline. Vertex uses GCLOUD_PROJECT + the service account; the Gemini API path needs GEMINI_API_KEY.
    if (modelMode() === "vertex") {
      // Newer Gemini models are served only from the global endpoint, not us-central1. ROADIE_VERTEX_PROJECT lets a local
      // run bill to the real project while GCLOUD_PROJECT stays on the emulator's demo project.
      const ai = genkit({ plugins: [vertexAI({ location: process.env.ROADIE_VERTEX_LOCATION ?? "global", projectId: process.env.ROADIE_VERTEX_PROJECT })] });
      return { ai, model: vertexAI.model(modelLabel()) };
    }
    const ai = genkit({ plugins: [googleAI()] });
    return { ai, model: googleAI.model(modelLabel()) };
  })();
  return cached;
}

/**
 * Vertex answers 429 RESOURCE_EXHAUSTED (and the odd 503) under load with no fixed quota to raise: the right answer is a
 * short wait and another go. Seen 2026-10-29 in the eval: one 429 inside a venue lookup failed the whole tool, and in
 * prod at 07:08 the same day: three 429s in seven seconds outlasted two waits, so the person saw "dropped a cable" and
 * the retry a minute later worked. The waits now cover about half a minute.
 */
export async function withModelRetry<T>(call: () => Promise<T>, waits = [1500, 4000, 8000, 15000]): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await call(); } catch (e) {
      const status = (e as { status?: string }).status;
      if (i >= waits.length || (status !== "RESOURCE_EXHAUSTED" && status !== "UNAVAILABLE")) throw e;
      console.warn(JSON.stringify({ roadieModelRetry: status, wait: waits[i] }));
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
}
