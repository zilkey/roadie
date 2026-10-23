import { z, type MessageData } from "genkit";
import type { AssistantAction, AssistantEvent, PageContext } from "@/schema/assistant";
import { ROUTES, resolveRoute, routeNames } from "@/lib/routes";
import { getAi, navigateInput } from "./ai";

// Genkit bundles zod 3; the app uses zod 4. Flow schemas use Genkit's z, the types come from src/schema/assistant.ts.
export const ChatFlowInput = z.object({
  message: z.string(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })).default([]),
  pageContext: z.object({ route: z.string(), recordKind: z.string().optional(), recordId: z.string().optional() }),
});
export const ChatFlowOutput = z.object({
  text: z.string(),
  actions: z.array(z.object({ kind: z.enum(["action", "navigate"]), label: z.string(), route: z.string().optional(), params: z.record(z.string(), z.string()).optional() })),
});
export type ChatFlowOutput = z.infer<typeof ChatFlowOutput>;

const MAX_STEPS = 3;

const system = (ctx: PageContext) =>
  `You are Roadie, the band app's built-in assistant. Talk like the best roadie you've toured with: short, unflappable, on the band's side. ` +
  `One or two sentences. Lingo is flavor; dates, times, amounts and names stay plain. Only help with shows, tours, money and the band's stuff. ` +
  `To take someone to a page, call ui.navigate with a route name from: ${routeNames.map((n) => `${n} (${ROUTES[n].title})`).join(", ")}. ` +
  `The user is on ${ctx.route}${ctx.recordKind ? `, looking at ${ctx.recordKind} ${ctx.recordId ?? ""}` : ""}.`;

/** Run a navigate tool request: validated against the named-route registry, never a raw URL. */
export function runNavigate(input: unknown): { ok: true; route: string; params: Record<string, string>; title: string } | { ok: false; error: string } {
  const i = (input ?? {}) as { route?: unknown; params?: Record<string, string> };
  const r = resolveRoute(i.route, i.params ?? {});
  if (!r) return { ok: false, error: `No page called "${String(i.route)}"` };
  return { ok: true, route: r.name, params: i.params ?? {}, title: r.title };
}

let flow: Promise<ReturnType<Awaited<ReturnType<typeof getAi>>["ai"]["defineFlow"]>> | undefined;

/**
 * `assistant.chat`: streams AssistantEvents (text / action / navigate) and returns the final text + actions.
 * Browser tools (ui.navigate) are emitted as events and treated as done; a round trip (`assistant.toolResult`) comes later.
 */
export function getChatFlow() {
  return (flow ??= (async () => {
    const { ai, model } = await getAi();
    const navigate = ai.defineTool(
      { name: "ui.navigate", description: "Open a page in the app by route name. Runs in the browser.", inputSchema: navigateInput },
      async (input) => runNavigate(input), // not run server-side: the flow handles it so the browser can perform it
    );
    return ai.defineFlow(
      { name: "assistant.chat", inputSchema: ChatFlowInput, outputSchema: ChatFlowOutput, streamSchema: z.custom<AssistantEvent>() },
      async (input, { sendChunk }) => {
        let messages: MessageData[] = [
          ...input.history.map((h): MessageData => ({ role: h.role === "user" ? "user" : "model", content: [{ text: h.text }] })),
          { role: "user", content: [{ text: input.message }] },
        ];
        let text = "";
        const actions: AssistantAction[] = [];
        for (let step = 0; step < MAX_STEPS; step++) {
          const res = await ai.generate({
            model: model as never, system: system(input.pageContext), messages, tools: [navigate], returnToolRequests: true,
            onChunk: (c) => { if (c.text) { text += c.text; sendChunk({ type: "text", delta: c.text }); } },
          });
          messages = res.messages;
          const requests = res.toolRequests;
          if (!requests.length) break;
          const responses = requests.map((tr) => {
            const out = runNavigate(tr.toolRequest.input);
            if (out.ok) {
              const a = { kind: "navigate" as const, label: out.title, route: out.route, params: out.params };
              actions.push(a);
              sendChunk({ type: "navigate", route: out.route, params: out.params, label: out.title });
              return { toolResponse: { name: tr.toolRequest.name, ref: tr.toolRequest.ref, output: { ok: true, opened: out.title } } };
            }
            actions.push({ kind: "action", label: out.error });
            sendChunk({ type: "action", label: out.error });
            return { toolResponse: { name: tr.toolRequest.name, ref: tr.toolRequest.ref, output: { error: out.error } } };
          });
          messages = [...messages, { role: "tool", content: responses }];
          text += text && !/\s$/.test(text) ? " " : "";
        }
        return { text: text.trim(), actions };
      },
    );
  })());
}
