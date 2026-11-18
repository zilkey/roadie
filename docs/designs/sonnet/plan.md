# Roadie chat on Claude Sonnet 5.5, with smaller payloads

**Status:** plan, 2026-11-18, revised after the egm review ([review.md](review.md)). Jeff's decisions (asked upfront): Anthropic API with an API key (identity federation later,
maybe); evals approved; if Sonnet does worse than Gemini on the eval, ship the payload fixes on Gemini and leave Sonnet
built but switched off; when Claude fails on a message, that message finishes on Gemini.

## 1. Why

Roadie is slow and pays for tokens it doesn't need. Measured in prod (Vertex metrics and `assistantThreads` traces,
Oct 23 to Nov 18):

- A reply takes 10 s at the median and 33 s at p90; the worst took 61 s. A message makes about 5 model calls in a row
  at about 2.5 s each.
- Every call sends about 27K tokens of tool definitions (130 "core" tools, 107K characters of JSON) of a 35-43K-token
  request. Core grew by accident: `toolset.ts` treats every tool that's in no group as core, so each new feature
  (posts, to-dos, checklists, projects, invites, shared editors) landed in it.
- Most messages start with a whole model round trip that only calls `context.now`, because the system prompt says
  "Call context.now first in a conversation" and the band context is only attached to a conversation's first message.
- 80 of about 3,550 Gemini calls got 429 from Vertex's shared pay-as-you-go pool (`request_type: shared`), in bursts
  that held a reply up to 48 s.
- Gemini thinks at its default level on every step; nothing sets it.
- Flash is weaker than Sonnet at picking the right tool among many and at multistep tool use, the class of bug Roadie
  keeps having (asking instead of acting, wrong tool).

## 2. What changes for the person

Nothing to learn. Replies come faster and stall less; on Sonnet, Roadie should also pick the right tool more often. Answers
stay one or two sentences.

## 3. Alternatives considered

| Option | Why not (or not now) |
| --- | --- |
| Stay on Gemini, only shrink payloads | This is the fallback if the eval says Sonnet is worse; the payload work ships either way. |
| Claude on Vertex | Same bill, no key, but Jeff chose the Anthropic API: own rate limits instead of a shared pool, newest caching features first. |
| Opus 5.5 | About twice Sonnet's price; Roadie's work is short tool calls, where Sonnet 5.5 is strong. Revisit if the eval says so. |
| Anthropic's built-in tool search (`defer_loading`) instead of our groups | Gemini fallback needs our own groups anyway, and our word-matched groups cost no extra round trip. Revisit once Sonnet is settled. |
| One generic "run command" tool plus a catalog | Extra round trip per new tool and worse arguments without the schema. |
| Workload identity federation instead of a key | More setup (Anthropic service account, issuer, rule, ID-token refresh on App Hosting); the key in Secret Manager matches every other Roadie secret. |

## 4. Risks

- **Sonnet does worse on Roadie's scenarios.** The eval decides; see 6.4.
- **New Anthropic account, low rate-limit tier.** Fresh accounts start on the lowest tier; the eval runs scenarios one at
  a time and the SDK retries 429s, and cache reads don't count toward input-token limits.
- **Tool names.** Claude tool names allow only `[a-zA-Z0-9_-]`; Roadie's are dotted (`shows.list`). Names are mapped both
  ways, in one place, with a unit test.
- **Schemas.** `toJsonSchema` rewrites schemas for Gemini (`nullable`, merged `anyOf`). Claude gets the plain draft-7
  schema from zod instead.
- **Preserved thinking.** `tools.load` changes the tool list mid-message, which invalidates earlier thinking blocks on
  new accounts (a 400). Thinking is adaptive at low effort, with `block_binding: drop_block` (beta
  `thinking-binding-controls-2026-08-01`), and a reply made under a different tool list is replayed without its thinking
  blocks. `between_tools` (thinking off) was the first choice and lost in the eval: it read Roadie's own earlier "added"
  as a false claim about half the time.
- **Tool names in text.** The prompt, the descriptions and tool results name tools ("call records.list"); on the Claude
  path those words are rewritten to Claude's names too, whole words only.
- **Fallback mid-message.** If Claude fails at step 3, step 3 and every later step of that message run on Gemini from the
  same history; the next message tries Claude again. Claude's thinking blocks live only in message metadata, so Gemini
  never sees them, and Claude's tool calls carry Google's placeholder thought signature
  (`skip_thought_signature_validator`), since Gemini 3 refuses a current-turn function call without one.
- **Band context every message** adds a few hundred to a few thousand tokens per message (owed and open-expense lists).
  It replaces a whole model round trip, and on Claude it sits in the cached system prompt for the rest of the message.

## 5. Out of scope

Voice transcription (audio; Claude can't take it), web search (Google search grounding), venue and act look-ups and the
event-page selector suggestions stay on Gemini: they're single calls. MCP is unchanged (it calls no model).

---

## 6. Implementation

### 6.1 Smaller payloads (both models)

1. **Explicit core.** `toolset.ts` gets a `CORE` allowlist. A tool not in `CORE` must be in a group. A unit test fails
   when a tool is in neither, so new features can't drift into core again. Core is what prod traces use and what the
   system prompt's guides need: Roadie's own tools (search, records, context.now, tools.load, web, venues.draft, ui.*,
   history.undoRun, help.explain), adding and editing venues and contacts, `venueTypes.add`, pitches, the show basics,
   money (income, payouts, expenses), the three tour tools and `geo.autocomplete`. The list itself lives in
   `toolset.ts` (`CORE`, 55 tools, about 66K characters, with a test budget of 75K).
2. **New and fixed groups.** `checklists` also takes `checklists.*` and `todos.*` (its matcher misses them today); new
   groups `posts`, `projects` (projects, receipts), `places` (promoters, festivals, editions, venue types other than
   add, venue merge and remove), `contacts` (attach, detach, roles, remove) and `showExtras` (comments, posters, folder,
   show remove). `calendar` takes `calendar.*`; `people` takes `people.updateDriving`; `acts` takes `bandsintown.check`.
   Each gets words and routes like the existing groups. The prompt's list of loadable groups is built from `GROUPS`.
   `invites.*` and `sharedEditors.*` go to policy's `EXCLUDED` instead: they change access, which the prompt already
   says Roadie can't do.
3. **No `context.now` round trip.** The band context goes in the system prompt on every message (admins, as today), not
   just the first, and the instruction to call `context.now` first goes from the prompt and from the tool's description.
   The tool stays for a refresh mid-message. Cost: `contextNow`'s Firestore reads on every message, in parallel, far
   less than a model step.
4. **Terse by instruction.** One added paragraph: no preamble, no restating the request, no recap of tool calls the cards
   already show, no markdown unless asked for a list. (The prompt already says one or two sentences.)
5. **Gemini thinking.** `ROADIE_GEMINI_THINKING=LOW` sets it on the chat calls only (`thinkingConfig.thinkingLevel`);
   unset keeps today's default. It ships set only if its eval arm passes at least as many scenarios as Gemini without it.

### 6.2 The Claude path

1. **SDK.** `@anthropic-ai/sdk`, `client.beta.messages.create`. `ANTHROPIC_API_KEY` from the environment: in prod the
   App Hosting secret (from `.secrets/claude-prod.txt`); locally the npm scripts read `.secrets/claude-dev.txt`, so test
   and live usage show apart in the Claude Console.
2. **Switch.** `ROADIE_CHAT_MODEL=claude-sonnet-5-5` turns it on (App Hosting env). Unset, or no key: Gemini as today.
   Fake mode (emulators, tests) is unchanged. `modelLabel()` records the chat model on history.
3. **One step function.** `flow.ts` keeps its loop and its genkit `MessageData` history. `claude.ts` exports
   `claudeStep({ model, system: {stable, volatile}, messages, tools, names, abortSignal })` returning
   `{ messages, toolRequests, words, usage }`: the input messages plus one model message whose parts are the text and
   the `toolRequest {name (Roadie's), ref: tool_use id, input}` calls, with the raw content on `metadata.anthropic` and
   the tool list's key on `metadata.toolsKey`. The converter replays a message's raw content when it has one and ignores
   its parts; otherwise (Gemini's or a history line) it rebuilds `tool_use` / `text` from the parts. Tool responses
   become one user message of `tool_result` blocks; consecutive same-role messages merge. `cleanMessages` stays on the
   Gemini path only.
4. **Request.** `model: claude-sonnet-5-5`, `max_tokens: 8000`, `thinking: {type: "adaptive", block_binding:
   {prefix_mismatch_behavior: "drop_block"}}`,
   `output_config: {effort: "low"}`, `tool_choice` left as auto, tools in the defs' order (core first in that order,
   groups among them by position; a `tools.load` is a cache miss for the rest of that message, accepted), `system` as two
   blocks: the stable instructions with `cache_control`, then the volatile part (date, page, band context, voice note).
   Top-level `cache_control` caches the growing conversation between steps. `ROADIE_CLAUDE_EFFORT` and
   `ROADIE_CLAUDE_THINKING=between_tools` exist for the eval arms.
5. **Refusals and errors.** The SDK retries once (`maxRetries: 1`) and gets the abort signal, so Stop cancels the HTTP
   request. Then `stop_reason: "refusal"`, `max_tokens` (a cut-off tool call must never run), or any API error: log
   `roadieClaudeFallback` (with the request's shape on a 400, which means Roadie built it wrong), drop the step's words
   and run this step and the rest of the message on Gemini, with its usual retries and busy note. A stopped message never
   falls back.
6. **Usage.** Each step's usage (`{model, calls, inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, ms}`,
   Gemini's mapped from genkit's usage) adds up per message, with `fellBack: {atStep, reason}` when it did. The flow
   returns it as `usage` and logs it as one `roadieUsage` JSON line; the eval prints it per turn and in total. The
   session's model label is Claude's when the message starts on Claude; `fellBack` says when it didn't finish there.

### 6.3 Checks

- `npm run check:roadie:claude`: one call with every tool, as the flow encodes them; then a `tools.load` and the next
  step with the first reply replayed under the bigger tool list.
- Unit tests: name mapping both ways; history conversion (tool calls, results, thinking replay); every tool in core or a
  group; core under its token budget (characters as a proxy).
- Typecheck, `npm test`, `npm run e2e` on the worktree's ports.

### 6.4 Eval and decision

The eval's timing output lands first (reply time per turn, median and p90), then token usage with the flow's `usage`.
Arms, each over every scenario (`npm run eval:roadie`; about 50 turns):

1. Gemini before any change (baseline).
2. Gemini after 6.1 (payload fixes alone); 2b. the same with `ROADIE_GEMINI_THINKING=LOW`.
3. Sonnet at low effort, `between_tools`; run twice. If it misses scenarios Gemini passes, try medium effort, then
   adaptive thinking, and take the best.
4. **Ship rule.** A turn Claude handed to Gemini counts as a failure for Claude. Sonnet goes on in prod (with the effort
   and thinking that won) when its pass count over its runs is at least Gemini-after-6.1's, and no scenario Gemini
   passes fails in every Sonnet run. Otherwise 6.1 ships on Gemini (with thinking low if 2b held), Sonnet stays built
   but off, and the numbers go in [results.md](results.md) either way. Speed and tokens are reported, not gated.

### 6.5 Ship

In order:

1. Typecheck, `npm test` and `npm run e2e` green; `check:roadie:vertex` and `check:roadie:claude` pass.
2. The `ANTHROPIC_API_KEY` secret is created from `.secrets/claude-prod.txt` by the service account (it needs Secret
   Manager Admin, which Jeff grants), with access granted to the backend. A referenced-but-missing secret fails the
   rollout, so `apphosting.yaml` references it only if it exists.
3. `ROADIE_CHAT_MODEL: claude` goes in `apphosting.yaml` only if the ship rule says Sonnet.
4. Squash, push main, confirm the rollout with `npm run rollouts`.
5. Rollback: remove `ROADIE_CHAT_MODEL` (Gemini again) and push.
