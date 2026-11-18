# Results: Roadie chat on Sonnet 5.5

2026-11-18 → 19, `npm run eval:roadie` (51 scenarios, 68 turns), one scenario at a time against the emulators, with the
same Vertex Gemini side calls (web search, venue drafts) in every run. Decision per [plan.md](plan.md) 6.4: **Sonnet ships**.
It passed 48 of 51 in both final runs, against Gemini's 47 on the same code. Every scenario Sonnet failed, Gemini failed
too.

## Final runs (same code, same eval)

| Run | Passed | Median reply | p90 | Model calls | Input tokens (cache reads / writes) | Output | Fallbacks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Gemini 3.5 Flash | 47/51 | 9.5 s | 36.7 s | 141 | 2.40M (1.21M / –) | 53.5K | – |
| Sonnet 5.5, low, adaptive (A) | 48/51 | 3.0 s | 16.9 s | 130 | 5.11M (4.31M / 0.79M) | 19.2K | 0 |
| Sonnet 5.5, low, adaptive (B) | 48/51 | 3.2 s | 20.7 s | 127 | 4.98M (4.83M / 0.15M) | 19.6K | 0 |

Gemini ran while Vertex was returning 429s to the side calls (the shared pool), which slowed every run's venue
scenarios; the p90s are mostly those. Before any change, Gemini passed 47/51 (median 8.6 s, p90 32.2 s) and called
`context.now` in 14 turns; no final run calls it.

Failed by both models in the final runs: `post-show-venmo-cash-mixed` (asks the post-show question late),
`post-show-last-night` (money said "last night" lands on tonight's show), `post-show-the-rest-is-tips` (doesn't say the
$22 it worked out). Gemini also failed `post-show-guarantee-plus-door`.

## Cost per message (list prices)

- **Sonnet:** about $0.038 per message on this eval. Claude counts Roadie's tools as more tokens (about 40K per call), but
  95% of them come from the cache at $0.10 per million. Cache reads ≈ $0.43, writes ≈ $2.00, output ≈ $0.19 per 68 turns.
- **Gemini, new code:** about $0.036 per message (1.2M uncached input at $1.50, 1.2M cached at $0.15, 53K output at $9).

So on these payloads they cost about the same, and Sonnet answers in a third of the time.

## The arms that led here

| Arm | Passed | Median | What changed after it |
| --- | --- | --- | --- |
| Gemini baseline, old code | 47 | 8.6 s | – |
| Sonnet low, thinking off, first prompt | 40 | 4.2 s | It asked instead of acting (who paid, which category, from/to); the eval's history lacked the "[Saved: …]" lines prod has |
| Sonnet medium, first prompt | 43 | 4.1 s | Medium didn't buy accuracy or cost speed: low stays |
| Sonnet low, after prompt fixes 1 | 44 | 3.4 s | "A required field you can fairly infer is not missing"; eval history now read back from the thread like prod; genres load the band group |
| Sonnet medium, after prompt fixes 1 | 44 | 3.9 s | – |
| Sonnet low, after prompt fixes 2 | 45 | 3.9 s | Money with no direction is an expense; a drive with just a time is fine; never search for an act; "it" means the record just added |
| Sonnet low, thinking off, final prompt (×2) | 46, 48 | 3.8 s | "move it to the 25th" added a second rehearsal about half the time: it read Roadie's own earlier "added" as a false claim. Fixed by ids on "[Saved: …]" lines, a prompt line on what history shows, and adaptive thinking |
| **Sonnet low, adaptive, final (×2)** | **48, 48** | **3.0 s** | Shipped |

`ROADIE_GEMINI_THINKING=LOW` was not run; Gemini's thinking stays at its default.
