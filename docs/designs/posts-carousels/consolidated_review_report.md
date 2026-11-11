# Consolidated EGM Review: Posts carousels (zilkey/roadie-issues#75)

**Target:** `docs/designs/posts-carousels/design.md`. FeatureRange is lines 1–36; DetailedRange is lines 37–147.
**Protocol:** Google's [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model) `egm-review`, consolidated mode (no pauses between stages). Each reviewer was a fresh subagent with no conversation history that read only the spec, the canvas boards and the code.

## Stage summary

| Stage | Reviewers | Verdict | Raw findings | Report |
| --- | --- | --- | --- | --- |
| 5 · Initial zoom out | zoom-out, inventive-catalyst | passes with changes | 0 🔴 · 7 🟡 · 6 🟢 | [zoom_out_report.md](zoom_out_report.md) |
| 6 · Comprehension | comprehension (read the doc alone) | every section could be paraphrased | 0 🔴 · 4 🟡 · 5 🟢 | [comprehension_report.md](comprehension_report.md) |
| 7 · Critic | design, structural, style | does not pass / fail / passes with changes | 2 🔴 · 11 🟡 · 12 🟢 | [critic_report.md](critic_report.md) |
| 8 · Intermediate zoom out | zoom-out | passes with changes; apply the subtractive fixes as one bundle | 0 🔴 · 5 🟡 · 6 🟢 | [intermediate_zoom_out_report.md](intermediate_zoom_out_report.md) |
| 9 · Implementation readiness | implementation-readiness, codebase-details, style | **not ready** | 3 🔴 · 17 🟡 · 10 🟢 | [implementation_readiness_report.md](implementation_readiness_report.md) |

**Overall:** the feature spec is sound in intent: a folder per life stage, with Roadie's `posts` doc as the source of truth. It needs two short sections (alternatives and risks) and one simplification: drop appProperties and use one move rule. The implementation plan is not ready to build. It has three Blockers on contracts that can't be built as written: the thumb URL signing, the Roadie/MCP access claim, and the shape of the autosave command. It also has gaps in the Drive service contracts, the schema migration, publish failure states, and the fakes.

Stage 8's guidance applies to every fix: prefer changes that make the `posts` doc more authoritative and Drive a simpler mirror, and close the structure gaps by moving text rather than adding sections.

## Consolidated action items

The ids match the decision page, where the answers are recorded.

### 🔴 Blocker
| Id | Item | Sources |
| --- | --- | --- |
| b1-thumb-signing | Thumb URL has no artist; the signing key depends on the Meta secret | S9 IR, S9 CD |
| b2-mcp-roadie | Roadie/MCP access to posts commands is claimed but blocked in `policy.ts` | S9 CD |
| b3-autosave-shape | `updateDraft` must take `{ id, patch }` to work with `useAutosave` | S9 CD |
| b4-alternatives | No alternatives considered | S7 design, S7 structural, S8 |
| b5-risks | No risks section | S7 structural, S7 design, S8 |

### 🟡 Major
| Id | Item | Sources |
| --- | --- | --- |
| m01-appproperties | Drop the appProperties tags and work out badges from the `posts` docs | S5 zoom-out, S8 |
| m02-move-rule | One move rule; Roadie writes only inside Drafts and Posted; the core rule becomes "best-effort mirror" | S6 #1 #4, S7 design, S8 |
| m03-publish-paths | One publish core; drop `kind` | S5, S6 nit, S8 |
| m04-heic | Render from Drive thumbnails, or keep heic-decode with 1024 MiB | S5 IC, S8, S9 (all), S5–S6 memory nits |
| m05-tidy | Explicit tidy retry, added to the spec and the canvas | S5, S7 style, S8 |
| m06-drive-edits | The doc wins; flag missing files; trash a draft folder only when it's empty | S7 design, S5 IC nit, S8 |
| m07-canvas-cuts | Cut the canvas extras; add a "Deliberate differences" list | S5, S7 design, S8, S9 IR |
| m08-setup-folders | Setup makes all three folders; one `findOrMakeFolder`; sharing rules | S5, S7 design, S9 IR, S9 CD |
| m09-day-shows | Day groups need the unfiltered shows and rehearsals, in the band's timezone | S9 style, S9 CD, S7 nit |
| m10-2000-cap | "Newest 2,000" isn't the newest | S9 style, S5 nit, S8 |
| m11-thumb-cache | Round the signed URL expiry so the browser can cache thumbnails | S5 IC, S8 |
| m12-status | Status transitions after a failed post or during a post | S9 IR, S9 CD |
| m13-alt-text | Check whether Graph accepts `alt_text` on carousel items | S9 style, S9 IR |
| m14-schema | Optional media fields and defaults; move the media route | S5 nit, S9 IR, S9 CD |
| m15-drive-contracts | `DriveService` signatures, one `update()`, how refused moves are detected | S5 nit, S9 IR, S9 CD |
| m16-crop | One crop formula for the editor and Instagram; orientation | S9 IR |
| m17-posts-tab | Posts tab contents and the list of drafts | S6 nit, S9 IR, S9 CD |
| m18-fakes | Changes needed to the fake Drive and fake Meta | S9 CD |
| m19-upload-heic | HEIC uploads arrive with an empty MIME type | S9 CD |
| m20-plan-structure | Phases and a full file list | S9 IR, S9 CD |
| m21-doc-structure | Two H2 parts, blockquoted ask, glossary | S6 #2, S7 structural, S7 style, S8 |
| m22-shared-drive | Is the Posts folder already in a Shared Drive? | S8, S7 style |
| m23-wording | Claims that overreach ("tidy", "nothing outside Drive", "01 …", Drive 2) | S7 style, S8, S9 style |

### 🟢 Nit
| Id | Item | Sources |
| --- | --- | --- |
| n1-spec-wording | Spec wording and formatting | S7 structural, S7 style |
| n2-plan-wording | Plan wording | S9 style |
| n3-timezone | Use the band's timezone for posted dates | S7 design, S9 IR |
| n4-old-month-folders | How the #49 month folders appear | S7 design |
| n5-tests-location | Emulator tests location | S9 CD |
| n6-rollback | Complete rollback; `addToDraft` shares the pipeline | S9 IR, S5 IC |

### Declined (YAGNI, per stage 8)
* A cache for the sorted 2,000-photo listing: wait for the #54 audit volumes.
* A general Drive-to-doc reconciler: replaced by m06's check when a draft opens.
* Re-running the tidy step from `posts.photos`: replaced by m05's explicit retry.
* Keeping both HEIC render paths: m04 picks one.

## Traceability

Each stage report lists its raw findings with reviewer and scope. The Sources column above maps each action item to them. S5 = zoom_out_report, S6 = comprehension_report, S7 = critic_report, S8 = intermediate_zoom_out_report, S9 = implementation_readiness_report. IC = inventive-catalyst, IR = implementation-readiness, CD = codebase-details.

Decisions are made on the [decision page](https://claude.ai/artifact/Doy4iY1BiJiXFzLsEL2XDP), and the answers are posted to the issue.
