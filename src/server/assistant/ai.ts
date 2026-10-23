import { genkit, type Genkit, type GenerateRequest, type GenerateResponseData, type Part } from "genkit";
import { script, type Step } from "./script";

export const FAKE_MODEL = "roadie/fake";

/** `fake` by default whenever emulators are on (or under test); anything else selects Gemini. */
export function modelMode(env: NodeJS.ProcessEnv = process.env): "fake" | "gemini" {
  const m = env.ROADIE_MODEL;
  if (m) return m === "fake" ? "fake" : "gemini";
  return env.FIRESTORE_EMULATOR_HOST || env.NODE_ENV === "test" ? "fake" : "gemini";
}

/** The model's name as history records it. */
export const modelLabel = (env: NodeJS.ProcessEnv = process.env) => (modelMode(env) === "fake" ? FAKE_MODEL : env.ROADIE_GEMINI_MODEL ?? "gemini-flash-latest");

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
  return { text, steps, page: pg ? { kind: pg[1], id: pg[2] } : undefined };
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
    // Never exercised offline. Needs GOOGLE_API_KEY (or switch to vertexAI for a service account).
    const { googleAI } = await import("@genkit-ai/google-genai");
    const ai = genkit({ plugins: [googleAI()] });
    return { ai, model: googleAI.model(process.env.ROADIE_GEMINI_MODEL ?? "gemini-flash-latest") };
  })();
  return cached;
}
