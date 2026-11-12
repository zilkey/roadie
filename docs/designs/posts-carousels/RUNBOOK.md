# Posts carousels: implementation runbook

Build [design.md](design.md) (the spec), phase by phase. Each phase runs in its own Claude Code cloud session. A session does one phase, pushes, and starts the session for the next phase.

- **Repo / branch:** `https://github.com/zilkey/roadie`, branch `claude/social-media-photo-carousel-9j41bk`. Every session works on and pushes to this branch only, and opens no pull request.
- **Spec:** [design.md](design.md) is the source of truth. Read all of it: `## Implementation plan` → `### Phases` says what each phase covers. [folder-model.md](folder-model.md) has the Drive layout, and the review reports in this folder explain the reasoning.
- **Started by:** the session that wrote this runbook (Nov 12), at the owner's request: "Start stage 1. When done automatically create a new session and start the next one, repeat until done. At the end run e2e tests (only run targeted tests before that). When done with all of them, push. Change the menu item from Posts to Social Media."

## What every phase session does

1. **Get the code.**
   - `git fetch origin claude/social-media-photo-carousel-9j41bk && git checkout claude/social-media-photo-carousel-9j41bk && git pull`, then `npm ci`.
   - Check the Phase log below: the previous phase must say **done**. If it doesn't, finish that phase first.
2. **Read** `AGENTS.md` (this Next.js version differs from what you know, so read the guide in `node_modules/next/dist/docs/` before writing route or page code), all of `design.md`, and the phase's section under `### Phases`.
3. **Build exactly that phase**: the code, fakes and tests the spec lists for it, and nothing from later phases.
   - **Follow the spec.** If it is wrong about the code or leaves a choice open, take the smallest reading that fits the spec, and record it under **Deviations** in the Phase log.
   - **Don't skip, disable or loosen a test to get green.**
4. **Run targeted tests only.**
   - `npm run typecheck`.
   - The unit tests for this phase: `npx tsx --test tests/unit/<file>.test.ts`.
   - The emulator tests for this phase, plus the existing ones its gate names:

     ```sh
     npx firebase emulators:exec --config firebase.test.json --only firestore,auth --project demo-band-tracker "npx tsx --test --import ./tests/emulator/setup.mjs tests/emulator/<a>.test.ts tests/emulator/<b>.test.ts"
     ```

   - **Not** the whole suite and **not** e2e (`npm run e2e` / Playwright). E2E runs once, at the end of phase 5.
   - Fix failures before you hand off.
5. **Log the phase.** Append to the Phase log below: what was built, its deviations, the tests run with their results, and the manual steps it left for the owner.
6. **Commit and push** to `claude/social-media-photo-carousel-9j41bk`, retrying on network errors. The push is required even before the end, because the next session starts from a fresh clone.
7. **Start the next phase** (phases 1–4 only), with `mcp__claude-code-remote__create_session`:
   - `source_url`: `https://github.com/zilkey/roadie`
   - `source_revision`: `claude/social-media-photo-carousel-9j41bk`
   - `outcome_branch`: `claude/social-media-photo-carousel-9j41bk`
   - `title`: `Posts carousels: phase <N+1>`
   - `prompt`: `Run phase <N+1> of docs/designs/posts-carousels/RUNBOOK.md on branch claude/social-media-photo-carousel-9j41bk. Follow the runbook exactly, then start the next phase as it says.`

   Then call `mcp__claude-code-remote__get_session` once to confirm it's running, note its id in the Phase log (commit and push that line too), and stop.
   - If `create_session` is refused or unavailable, write **"blocked: couldn't start phase N+1"** with the reason in the Phase log, push, and stop.

## Phase 5 only, after the phase itself
1. **Rename the menu item** from **Posts** to **Social Media**: the nav label in `src/lib/nav.ts`, `SECTION_LABEL.posts` in `src/schema/sections.ts`, and the page title in `src/app/(signed-in)/(app)/artists/[slug]/posts/page.tsx`.
   - The route stays `/posts`, and the code names (`posts.*`) stay as they are.
   - Update any test that looks for the old label.
2. **Run the e2e suite**: `npm run e2e`, with `--trace off` passed through as `scripts/e2e.ts` allows.
   - Fix the failures this work caused, and re-run until green.
   - If a failure clearly predates this work (it fails the same way on the commit before phase 1), record it in the log rather than changing unrelated code.
3. **Run** `npm run typecheck` and `npm run test` (unit and emulator) once.
4. **Commit and push** to the branch: this is the final push. Write **"ALL PHASES DONE"** in the Phase log with the final test results and the list of manual steps for the owner.

## Never done by a session
These need the owner or production access. Record them as manual steps:
- Setting the `SIGNED_URL_SECRET` App Hosting secret.
- Running `posts.setup` or the `migrate:posts-49 --apply` migration on prod.
- The prod checks of HEIC thumbnail size and `alt_text`. The `alt_text` question may be answered from Graph's public docs; write the answer into design.md.
- Deploying, merging, or opening a pull request.

## Phase log
<!-- Each session appends below: "### Phase N — done|blocked", then built, deviations, tests (command → result), manual steps, next session id. -->
