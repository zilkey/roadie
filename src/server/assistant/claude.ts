/**
 * Roadie's chat on Claude (docs/designs/sonnet/plan.md). The flow keeps its loop and its Genkit `MessageData` history; this
 * file turns that history into one Anthropic Messages request and the reply back into `MessageData`, so the loop can't
 * tell which model answered and a message can finish on Gemini when Claude fails.
 *
 * - Tool names: Claude allows only [a-zA-Z0-9_-], Roadie's are dotted ("shows.list"): "." travels as "__".
 * - The raw reply (thinking blocks included) rides on the model message's `metadata.anthropic` and is replayed unchanged,
 *   as the API asks. A reply made under a different tool list loses its thinking blocks on replay (and `block_binding`
 *   drops any the API still finds stale): the history-editing check would otherwise refuse the request after
 *   `tools.load` (plan 4, "Preserved thinking").
 * - Caching: tools, then the stable system block (cached), then the per-message block (date, page, band context), then the
 *   conversation, whose end top-level `cache_control` caches for the next step.
 * - Errors and refusals throw `ClaudeFailed`; the flow finishes the message on Gemini. No retry loop here beyond the SDK's one.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { MessageData, Part } from "genkit";

export type ClaudeMessage = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlockParam;
type Tool = Anthropic.Beta.BetaTool;

/** Sonnet 5.5 unless ROADIE_CHAT_MODEL names another Claude model. */
export const DEFAULT_CLAUDE = "claude-sonnet-5-5";

/**
 * The Claude model for Roadie's chat, or undefined for Gemini: ROADIE_CHAT_MODEL=claude-… (or "claude" for the default)
 * and a key. Fake mode (emulators, tests) never reaches here: the flow checks modelMode first.
 */
export function claudeModel(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const m = env.ROADIE_CHAT_MODEL;
  if (!m || !m.startsWith("claude") || !env.ANTHROPIC_API_KEY) return undefined;
  return m === "claude" ? DEFAULT_CLAUDE : m;
}

/** Effort for Roadie's chat: low (short tool picks); ROADIE_CLAUDE_EFFORT overrides it for the eval. */
export const claudeEffort = (env: NodeJS.ProcessEnv = process.env) => {
  const e = env.ROADIE_CLAUDE_EFFORT;
  return e === "medium" || e === "high" ? e : "low";
};

/**
 * Adaptive thinking (at low effort it skips thinking on most simple requests), with thinking blocks dropped instead of
 * refused when the tool list changed (tools.load). ROADIE_CLAUDE_THINKING=between_tools turns thinking off, for the eval.
 * Adaptive won on 2026-11-18: with thinking off, "move it to the 25th" read Roadie's own earlier "added" as a false claim
 * and added a second rehearsal about half the time; adaptive got it right every time at the same speed.
 */
export const claudeThinking = (env: NodeJS.ProcessEnv = process.env): Anthropic.Beta.BetaThinkingConfigParam =>
  env.ROADIE_CLAUDE_THINKING === "between_tools" ? { type: "between_tools" } : { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } };

export const toClaudeName = (name: string) => name.replace(/\./g, "__");
export const fromClaudeName = (name: string) => name.replace(/__/g, ".");

/**
 * Text Claude reads with Roadie's tool names spelled its way: the prompt, the descriptions and the tool results all say
 * "call records.list", and Claude only has records__list. Only the given names change, and only as whole words.
 */
export function claudeText(text: string, names: string[]): string {
  const dotted = names.filter((n) => n.includes(".")).sort((a, b) => b.length - a.length);
  if (!dotted.length) return text;
  const re = new RegExp(`(?<![\\w./])(${dotted.map((n) => n.replace(/\./g, "\\.")).join("|")})(?![\\w])`, "g");
  return text.replace(re, (n) => toClaudeName(n));
}

/**
 * Gemini 3 refuses a function call in the current turn that has no thought signature, and Claude's calls have none: when a
 * message falls back to Gemini mid-way, its earlier calls carry Google's documented placeholder instead.
 */
export const SKIP_SIGNATURE = "skip_thought_signature_validator";

export class ClaudeFailed extends Error {
  constructor(message: string, readonly why: "error" | "refusal" | "max_tokens", readonly status?: number) { super(message); }
}

export interface StepUsage { model: string; calls: number; inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number; ms: number }
export const noUsage = (model: string): StepUsage => ({ model, calls: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, ms: 0 });
export function addUsage(a: StepUsage, b: Partial<StepUsage>): StepUsage {
  return {
    model: a.model, calls: a.calls + (b.calls ?? 0), inputTokens: a.inputTokens + (b.inputTokens ?? 0), cacheReadTokens: a.cacheReadTokens + (b.cacheReadTokens ?? 0),
    cacheWriteTokens: a.cacheWriteTokens + (b.cacheWriteTokens ?? 0), outputTokens: a.outputTokens + (b.outputTokens ?? 0), ms: a.ms + (b.ms ?? 0),
  };
}

export interface ClaudeToolDef { name: string; description: string; schema: Record<string, unknown> }

/** Roadie's tool definitions as Claude tools, in the order given (a stable order keeps the cache). */
export const claudeTools = (defs: ClaudeToolDef[], names: string[] = defs.map((d) => d.name)): Tool[] =>
  defs.map((d) => ({ name: toClaudeName(d.name), description: claudeText(d.description, names), input_schema: d.schema as Tool["input_schema"] }));

/** A key for a tool list: a reply's thinking blocks are only replayed under the list they were made with. */
export const toolsKey = (defs: { name: string }[]) => defs.map((d) => d.name).join(",");

const asText = (output: unknown) => (typeof output === "string" ? output : JSON.stringify(output ?? null));

/**
 * The conversation as Claude messages. A model message Claude wrote is replayed from its raw content (thinking blocks
 * dropped when the tool list changed since); one Gemini wrote (or a canned history line) is rebuilt from its parts.
 * Tool responses become one user message of tool_result blocks; consecutive same-role messages merge.
 */
export function toClaudeMessages(messages: MessageData[], key: string, names: string[] = []): ClaudeMessage[] {
  const out: ClaudeMessage[] = [];
  const push = (role: "user" | "assistant", blocks: Block[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last?.role === role) last.content = [...(last.content as Block[]), ...blocks];
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "model") {
      const raw = (m.metadata as { anthropic?: Block[]; toolsKey?: string } | undefined);
      if (raw?.anthropic) {
        push("assistant", raw.toolsKey === key ? raw.anthropic : raw.anthropic.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking"));
        continue;
      }
      push("assistant", m.content.flatMap((p): Block[] =>
        p.toolRequest ? [{ type: "tool_use", id: p.toolRequest.ref ?? p.toolRequest.name, name: toClaudeName(p.toolRequest.name), input: (p.toolRequest.input ?? {}) as Record<string, unknown> }]
        : p.text?.trim() ? [{ type: "text", text: claudeText(p.text, names) }] : []));
      continue;
    }
    if (m.role === "tool") {
      push("user", m.content.flatMap((p): Block[] => (p.toolResponse ? [{ type: "tool_result", tool_use_id: p.toolResponse.ref ?? p.toolResponse.name, content: claudeText(asText(p.toolResponse.output), names) }] : [])));
      continue;
    }
    push("user", m.content.flatMap((p): Block[] => (p.text?.trim() ? [{ type: "text", text: claudeText(p.text, names) }] : [])));
  }
  return out;
}

/** Claude's reply as a Genkit model message: text and tool calls as parts, the raw content kept for replay. */
export function fromClaudeReply(content: Anthropic.Beta.BetaContentBlock[], key: string): { message: MessageData; words: string; toolRequests: Part[] } {
  const parts: Part[] = [];
  let words = "";
  for (const b of content) {
    if (b.type === "text") { words += b.text; if (b.text.trim()) parts.push({ text: b.text }); }
    else if (b.type === "tool_use") parts.push({ toolRequest: { name: fromClaudeName(b.name), ref: b.id, input: b.input }, metadata: { thoughtSignature: SKIP_SIGNATURE } });
  }
  // A reply with only thinking blocks still needs a part: Genkit drops empty messages.
  const message: MessageData = { role: "model", content: parts.length ? parts : [{ text: "" }], metadata: { anthropic: content as unknown as Block[], toolsKey: key } };
  return { message, words, toolRequests: parts.filter((p) => p.toolRequest) };
}

let client: Anthropic | undefined;
const getClient = () => (client ??= new Anthropic({ maxRetries: 1, timeout: 60_000 }));

export interface ClaudeStepInput {
  model: string;
  /** The instructions that don't change between messages (cached), and the part that does (date, page, band context). */
  system: { stable: string; volatile: string };
  messages: MessageData[];
  tools: ClaudeToolDef[];
  /** Every tool name Roadie has (offered or not): the ones rewritten in text. */
  names: string[];
  abortSignal?: AbortSignal;
}

/** One model step: the reply as Genkit messages, the tool calls asked for, the words said, and what it cost. */
export async function claudeStep(input: ClaudeStepInput): Promise<{ messages: MessageData[]; toolRequests: Part[]; words: string; usage: StepUsage }> {
  const key = toolsKey(input.tools);
  const started = Date.now();
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await getClient().beta.messages.create({
      model: input.model,
      max_tokens: 8000,
      betas: ["thinking-binding-controls-2026-08-01"],
      thinking: claudeThinking(),
      output_config: { effort: claudeEffort() },
      cache_control: { type: "ephemeral" },
      system: [
        { type: "text", text: claudeText(input.system.stable, input.names), cache_control: { type: "ephemeral" } },
        ...(input.system.volatile.trim() ? [{ type: "text" as const, text: claudeText(input.system.volatile, input.names) }] : []),
      ],
      tools: claudeTools(input.tools, input.names),
      messages: toClaudeMessages(input.messages, key, input.names),
    }, { signal: input.abortSignal });
  } catch (e) {
    if (input.abortSignal?.aborted) throw e;
    const status = (e as { status?: number }).status;
    throw new ClaudeFailed((e as Error).message, "error", status);
  }
  const u = res.usage;
  const usage: StepUsage = {
    model: input.model, calls: 1, ms: Date.now() - started,
    inputTokens: u.input_tokens ?? 0, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0, outputTokens: u.output_tokens ?? 0,
  };
  if (res.stop_reason === "refusal") throw new ClaudeFailed(`refused: ${res.stop_details && "category" in res.stop_details ? String(res.stop_details.category) : "unknown"}`, "refusal");
  if (res.stop_reason === "max_tokens") throw new ClaudeFailed("ran out of tokens", "max_tokens");
  const reply = fromClaudeReply(res.content, key);
  return { messages: [...input.messages, reply.message], toolRequests: reply.toolRequests, words: reply.words, usage };
}
