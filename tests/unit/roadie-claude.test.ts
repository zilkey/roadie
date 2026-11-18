// Roadie's chat on Claude (docs/designs/sonnet/plan.md): the pieces that never call the model.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MessageData } from "genkit";
import { claudeModel, claudeText, claudeTools, fromClaudeName, fromClaudeReply, SKIP_SIGNATURE, toClaudeMessages, toClaudeName, toolsKey } from "@/server/assistant/claude";
import { toolDefs } from "@/server/assistant/tools";
import { CORE, GROUPS, groupOf, selectTools } from "@/server/assistant/toolset";
import { isExcluded } from "@/server/assistant/policy";

const defs = toolDefs("admin");
const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
const names = defs.map((d) => d.name);

test("tool names: every Roadie tool has a Claude name that Claude accepts and that maps back to it", () => {
  const seen = new Set<string>();
  for (const n of names) {
    const c = toClaudeName(n);
    assert.match(c, /^[a-zA-Z0-9_-]{1,64}$/, n);
    assert.equal(fromClaudeName(c), n);
    assert.ok(!seen.has(c), `two tools are both ${c}`);
    seen.add(c);
  }
});

test("tool names in text: whole names only, longest first, never inside a link or a longer word", () => {
  const t = claudeText("Call records.list, then shows.calendarPreview (not shows.calendar). See https://x.com/shows.list and myshows.list.", names);
  assert.equal(t, "Call records__list, then shows__calendarPreview (not shows__calendar). See https://x.com/shows.list and myshows.list.");
  assert.equal(claudeText("tools.load.", names), "tools__load.");
});

test("tool schemas: no union at the top of any Claude schema (Claude refuses one there)", () => {
  for (const t of claudeTools(defs.map((d) => ({ name: d.name, description: d.description, schema: d.claudeSchema ?? d.inputJsonSchema })), names)) {
    const s = t.input_schema as Record<string, unknown>;
    assert.equal(s.type, "object", t.name);
    for (const k of ["anyOf", "oneOf", "allOf"]) assert.ok(!(k in s), `${t.name} has ${k} at the top`);
    const left = names.filter((n) => n.includes(".") && new RegExp(`(?<![\\w./])${n.replace(/\./g, "\\.")}(?!\\w)`).test(t.description ?? ""));
    assert.deepEqual(left, [], `${t.name}'s description still names dotted tools`);
  }
});

test("history: tool calls and results become tool_use and tool_result with the same ids; Claude's own replies replay raw", () => {
  const key = toolsKey([{ name: "search" }]);
  const raw = [
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "text", text: "Looking." },
    { type: "tool_use", id: "toolu_1", name: "records__list", input: { kind: "shows" } },
  ] as never;
  const reply = fromClaudeReply(raw, key);
  assert.deepEqual(reply.toolRequests.map((p) => p.toolRequest?.name), ["records.list"]);
  assert.equal(reply.toolRequests[0].metadata?.thoughtSignature, SKIP_SIGNATURE, "Gemini needs a signature on a call it didn't make");
  assert.equal(reply.words, "Looking.");
  const history: MessageData[] = [
    { role: "user", content: [{ text: "earlier" }] },
    { role: "model", content: [{ text: "an answer from a past message (call records.list)" }] },
    { role: "user", content: [{ text: "how many shows?" }] },
    reply.message,
    { role: "tool", content: [{ toolResponse: { name: "records.list", ref: "toolu_1", output: { next: "call records.get" } } }] },
    { role: "user", content: [{ text: "nudge" }] },
  ];
  const same = toClaudeMessages(history, key, names);
  assert.deepEqual(same.map((m) => m.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.deepEqual(same[1].content, [{ type: "text", text: "an answer from a past message (call records__list)" }]);
  assert.equal(same[3].content, raw, "replayed unchanged, thinking included");
  assert.deepEqual(same[4].content, [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"next":"call records__get"}' }, { type: "text", text: "nudge" }]);
  // After tools.load the tool list differs: the reply replays without its thinking blocks.
  const later = toClaudeMessages(history, toolsKey([{ name: "search" }, { name: "stats.pull" }]), names);
  assert.deepEqual((later[3].content as { type: string }[]).map((b) => b.type), ["text", "tool_use"]);
});

test("a Gemini-made tool call (after a fallback, or canned) is rebuilt as tool_use from its parts", () => {
  const history: MessageData[] = [
    { role: "user", content: [{ text: "hi" }] },
    { role: "model", content: [{ text: "" }, { toolRequest: { name: "shows.list", ref: "g1", input: {} } }] },
    { role: "tool", content: [{ toolResponse: { name: "shows.list", ref: "g1", output: [] } }] },
  ];
  const out = toClaudeMessages(history, "", names);
  assert.deepEqual(out[1].content, [{ type: "tool_use", id: "g1", name: "shows__list", input: {} }]);
  assert.deepEqual(out[2].content, [{ type: "tool_result", tool_use_id: "g1", content: "[]" }]);
});

test("switch: Claude only with ROADIE_CHAT_MODEL naming it and a key", () => {
  assert.equal(claudeModel(env({})), undefined);
  assert.equal(claudeModel(env({ ROADIE_CHAT_MODEL: "claude" })), undefined, "no key");
  assert.equal(claudeModel(env({ ROADIE_CHAT_MODEL: "claude", ANTHROPIC_API_KEY: "k" })), "claude-sonnet-5-5");
  assert.equal(claudeModel(env({ ROADIE_CHAT_MODEL: "claude-opus-5-5", ANTHROPIC_API_KEY: "k" })), "claude-opus-5-5");
  assert.equal(claudeModel(env({ ROADIE_CHAT_MODEL: "gemini-3.5-flash", ANTHROPIC_API_KEY: "k" })), undefined);
});

test("core is a list: every tool is in CORE or a group, never both, and core stays small", () => {
  const loose = names.filter((n) => !CORE.includes(n) && !GROUPS.some((g) => g.match(n)));
  assert.deepEqual(loose, [], "put each new tool in CORE or a group (toolset.ts)");
  for (const n of CORE) assert.ok(names.includes(n), `CORE names ${n}, which Roadie doesn't have`);
  for (const n of CORE) assert.equal(groupOf(n), undefined, n);
  const core = selectTools(defs, []);
  assert.equal(core.length, CORE.length);
  // About 66K characters on 2026-11-18, down from 107K: a budget so the core can't quietly grow back.
  const chars = JSON.stringify(core.map(({ claudeSchema: _c, ...d }) => d)).length;
  assert.ok(chars < 75_000, `core is ${chars} characters`);
});

test("access commands never reach Roadie (the prompt says it can't change access)", () => {
  for (const n of ["invites.pending", "invites.withdraw", "sharedEditors.approve", "sharedEditors.request"]) {
    assert.ok(isExcluded(n), n);
    assert.ok(!names.includes(n), n);
  }
});
