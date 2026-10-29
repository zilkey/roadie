/**
 * `npm run check:roadie`: one tiny call to the REAL model with every tool Roadie offers an admin, exactly as the flow
 * sends them. Catches what the unit tests never can: the model endpoint rejecting the tool schemas (2026-10-29: every
 * Roadie message in prod failed with "required fields ['route'] are not defined" because an enum field had no type).
 * Needs no emulators and no login: ROADIE_MODEL=gemini with the key in .secrets, or ROADIE_MODEL=vertex with ADC.
 * Exits 1 with the endpoint's error when the request is refused. Runs from the pre-push hook (see docs/SETUP.md).
 */
import { getAi, modelLabel, modelMode } from "../src/server/assistant/ai";
import { toolDefs } from "../src/server/assistant/tools";

async function main() {
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
  console.error(`REFUSED: ${modelLabel()} (${modelMode()}) would not take Roadie's tools.\n${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
