import { genkit, type Genkit, type GenerateRequest, type GenerateResponseData, type Part } from "genkit";
import { script, type Step } from "./script";

export const FAKE_MODEL = "roadie/fake";

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

/** The model's name as history records it. Defaults: Flash-Lite on Vertex (the spec's cheap default; Gemini 2.5 shut down in October 2026), the latest Flash alias on the Gemini API. */
export const modelLabel = (env: NodeJS.ProcessEnv = process.env) => {
  const mode = modelMode(env);
  if (mode === "fake") return FAKE_MODEL;
  return env.ROADIE_GEMINI_MODEL ?? (mode === "vertex" ? "gemini-3.5-flash-lite" : "gemini-flash-latest");
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

/** One Genkit instance per process. The Google plugin is only imported (and needs a key) when ROADIE_MODEL is not fake. */
export function getAi(): Promise<{ ai: Genkit; model: unknown }> {
  cached ??= (async () => {
    if (modelMode() === "fake") {
      const ai = genkit({});
      return { ai, model: defineFake(ai) };
    }
    // Never exercised offline. Vertex uses GCLOUD_PROJECT + the service account; the Gemini API path needs GEMINI_API_KEY.
    const { googleAI, vertexAI } = await import("@genkit-ai/google-genai");
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
