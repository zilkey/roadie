# EGM review: Roadie chat on Sonnet 5.5

**Target:** [plan.md](plan.md), first draft of 2026-11-18. Five fresh reviewers, each reading only the plan and the code:
zoom-out, comprehension (plan alone), design, implementation readiness and codebase details. The plan was revised after
them; this page records what they found and what was decided.

| Reviewer | Verdict |
| --- | --- |
| Zoom-out | Scope right for the payload fixes, too much for one unattended ship |
| Comprehension | Ship rule and decision order undefined |
| Design | Approve with changes: the seam is right; the fallback would fail as written |
| Implementation readiness | Not ready: three contracts couldn't be built as written |
| Codebase details | Claims mostly hold; a second "call context.now first", and access tools that shouldn't be Roadie's at all |

## Blockers and what was done

| Finding | From | Decision |
| --- | --- | --- |
| Claude sees `tools__load` but the prompt, descriptions and tool results say `tools.load` | readiness | Rewrite known tool names to Claude's in all text on the Claude path, whole words only (`claudeText`), with a test that no description keeps a dotted name |
| Gemini 3 refuses a current-turn function call with no thought signature, so falling back after a Claude tool call would 400 | design, readiness | Claude's calls carry Google's placeholder signature; Claude thinking lives only in metadata, never as reasoning parts |
| Stop could trigger the fallback | design | The abort signal goes to the SDK; a stopped message never falls back |
| `claudeStep` contract and where fallback lives | readiness | Spelled out in plan 6.2.3 and 6.2.5; fallback is per message, sticky, decided in the flow's `generate` |
| Ship rule undefined; fallback could pass as Claude | comprehension | A fallback turn fails for Claude; Sonnet runs twice; the rule compares pass counts and per-scenario regressions (plan 6.4) |
| `context.now`'s own description also says "call it first" | codebase | Changed with the prompt |
| `invites.*` and `sharedEditors.*` reach Roadie although the prompt says it can't change access | codebase, zoom-out | Excluded in policy instead of grouped |
| Ship Claude dark, turn it on as a watched step | zoom-out | Not taken: Jeff decided upfront that Sonnet goes on if the eval says so. The stricter rule (two runs, fallback counts as failure) and the one-line rollback answer the risk |

## Major findings and what was done

- **Thinking adds most of the complexity** (zoom-out): the default is `between_tools` (thinking off), with thinking blocks
  dropped on replay after a tool-list change; adaptive is an eval arm only.
- **Retry layers stack** (zoom-out, design): SDK `maxRetries: 1`, then straight to Gemini; `withModelRetry` and the 400
  retry stay on the Gemini path.
- **`max_tokens` cut-offs** (design, readiness): a cut-off reply falls back; its tool calls never run.
- **Schemas** (readiness): commands get a plain `claudeSchema` beside Gemini's; a union at the top of a schema is merged
  into one object (found by the first real call: Claude refuses top-level `anyOf`).
- **Prompt split** (design, readiness, codebase): `stable()` and `volatile()`; the date, page, voice note, band context
  and page record are all in the volatile block. The fake model's page regexes still match the joined prompt.
- **Group list hard-coded in the prompt** (zoom-out, design, codebase): built from `GROUPS`.
- **`venueTypes.add` would leave core** (codebase, readiness): kept in core; the eval's `new-type` scenario and the unit
  test need it.
- **Usage shape, model label, fallback visibility** (readiness, design): `usage` on the flow output with `fellBack`;
  `roadieUsage` and `roadieClaudeFallback` log lines (with the request shape on a 400).
- **Tests offline** (readiness): unit tests cover names, text rewriting, schemas, history conversion both ways, thinking
  dropped after a tool-list change, Gemini-made calls, the switch, the core list and its budget, and the access
  exclusion. The fallback itself is exercised by the eval's per-turn `fellBack` count and `check:roadie:claude`, which
  replays a reply after `tools.load`.

## Left as is

- Building Claude as a Genkit model (`ai.defineModel`) instead of a step function (design, 🟡): the step function keeps
  thinking replay and caching control in one small file; Genkit's message shape would drop the raw content.
- Explicit system-block cache breakpoint (zoom-out, 🟢): kept; it's free and lets messages that load no group reuse the
  instructions across messages.
