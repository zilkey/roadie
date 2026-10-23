import { genkit, z, type Genkit, type GenerateRequest, type GenerateResponseData, type Part } from "genkit";
import { routeNames } from "@/lib/routes";
import { script } from "./script";

export const FAKE_MODEL = "roadie/fake";

/** `fake` by default whenever emulators are on (or under test); anything else selects Gemini. */
export function modelMode(env: NodeJS.ProcessEnv = process.env): "fake" | "gemini" {
  const m = env.ROADIE_MODEL;
  if (m) return m === "fake" ? "fake" : "gemini";
  return env.FIRESTORE_EMULATOR_HOST || env.NODE_ENV === "test" ? "fake" : "gemini";
}

export const navigateInput = z.object({
  route: z.enum(routeNames as [string, ...string[]]).describe("Name of the page to open"),
  params: z.record(z.string(), z.string()).optional().describe("Route params, e.g. {id} for a show"),
});

/** Pull the user's text (or the navigate tool result) out of a model request. */
function lastTurn(req: GenerateRequest) {
  const last = req.messages[req.messages.length - 1];
  const tr = last?.content.find((p) => p.toolResponse)?.toolResponse;
  if (tr) return { text: "", tool: { ok: !(tr.output as { error?: string } | undefined)?.error } };
  return { text: last?.content.map((p) => p.text ?? "").join("") ?? "" };
}

function defineFake(ai: Genkit) {
  return ai.defineModel(
    { name: FAKE_MODEL, label: "Roadie (canned)", supports: { tools: true, multiturn: true, systemRole: true, media: false } },
    async (req, send): Promise<GenerateResponseData> => {
      const out = script(lastTurn(req));
      const content: Part[] = [];
      if (out.text) {
        // Stream word by word like a real model would.
        for (const w of out.text.match(/\S+\s*/g) ?? []) send?.({ content: [{ text: w }] });
        content.push({ text: out.text });
      }
      if ("navigate" in out) content.push({ toolRequest: { name: "ui.navigate", ref: "nav-1", input: out.navigate } });
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
