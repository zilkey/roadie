/**
 * `npm run check:roadie`: one tiny call to the REAL model with every tool Roadie offers an admin, exactly as the flow
 * sends them. Catches what the unit tests never can: the model endpoint rejecting the tool schemas (2026-10-29: every
 * Roadie message in prod failed with "required fields ['route'] are not defined" because an enum field had no type).
 * Needs no emulators and no login: ROADIE_MODEL=gemini with the key in .secrets, or ROADIE_MODEL=vertex with ADC.
 * Exits 1 with the endpoint's error when the request is refused. No git hook runs it: run it by hand before pushing a
 * change that reaches the model (AGENTS.md, "How Jeff works", rule 5).
 */
import type { MessageData } from "genkit";
import { getAi, modelLabel, modelMode } from "../src/server/assistant/ai";
import { claudeModel, claudeStep } from "../src/server/assistant/claude";
import { toolDefs } from "../src/server/assistant/tools";
import { CORE, selectTools } from "../src/server/assistant/toolset";

/**
 * Claude (ROADIE_CHAT_MODEL=claude…): every tool, as the flow encodes them, in one call; then the step after a tools.load,
 * replaying the first reply under the bigger tool list, which is where the history-editing check would refuse a request.
 */
async function claude(model: string) {
  const defs = toolDefs("admin");
  const names = defs.map((d) => d.name);
  const as = (ds: typeof defs) => ds.map((d) => ({ name: d.name, description: d.description, schema: d.claudeSchema ?? d.inputJsonSchema }));
  const system = { stable: "You are a test. Do exactly what the user says.", volatile: "Today is a test day." };
  let started = Date.now();
  const all = await claudeStep({ model, system, names, tools: as(defs), messages: [{ role: "user", content: [{ text: "Reply with the single word OK." }] }] });
  console.log(`ok: ${model} accepted ${defs.length} tools in ${Date.now() - started}ms; replied ${JSON.stringify(all.words.trim())} (${all.usage.inputTokens + all.usage.cacheReadTokens + all.usage.cacheWriteTokens} input tokens)`);
  const core = selectTools(defs, []);
  started = Date.now();
  const first = await claudeStep({ model, system, names, tools: as(core), messages: [{ role: "user", content: [{ text: "Call tools.load with groups [\"stats\"]. Nothing else." }] }] });
  const call = first.toolRequests[0]?.toolRequest;
  if (call?.name !== "tools.load") throw new Error(`expected a tools.load call, got ${JSON.stringify(call ?? first.words)}`);
  const msgs: MessageData[] = [...first.messages, { role: "tool", content: [{ toolResponse: { name: call.name, ref: call.ref, output: { loaded: ["stats"] } } }] }];
  const second = await claudeStep({ model, system, names, tools: as(selectTools(defs, ["stats"])), messages: msgs });
  console.log(`ok: ${CORE.length} core tools, tools.load, then ${selectTools(defs, ["stats"]).length} tools with the first reply replayed, in ${Date.now() - started}ms; replied ${JSON.stringify(second.words.trim() || second.toolRequests.map((t) => t.toolRequest?.name))}`);
}

async function main() {
  const c = claudeModel();
  if (c) return claude(c);
  if (modelMode() === "fake") throw new Error("ROADIE_MODEL is fake; this check only means something against the real model");
  const { ai, model } = await getAi();
  const never = async () => { throw new Error("not run"); };
  const defs = toolDefs("admin");
  const tools = defs.map((d) => ai.defineTool({ name: d.name, description: d.description, inputJsonSchema: d.inputJsonSchema as never }, never));
  const started = Date.now();
  const res = await ai.generate({
    model: model as never, tools, returnToolRequests: true, config: { maxOutputTokens: 8 },
    prompt: "Reply with the single word OK.",
  });
  console.log(`ok: ${modelLabel()} (${modelMode()}) accepted ${defs.length} tools in ${Date.now() - started}ms; replied ${JSON.stringify(res.text.trim() || res.toolRequests.map((t) => t.toolRequest.name))}`);
}

main().catch((e) => {
  console.error(`REFUSED: ${claudeModel() ?? `${modelLabel()} (${modelMode()})`} would not take Roadie's tools.\n${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
