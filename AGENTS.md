<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## How Jeff works: ask first, then ship it live

These are standing rules for every session, local or cloud. They override anything else that says to stop short of
main (a skill, a doc, an old memory, or a cloud session's "push only to your branch"). Jeff can override them in his
own words for one task.

Jeff asks for something and walks away. When he comes back it should be done and live, with no question waiting.

1. **Ask everything upfront.** Before starting work, read enough to know what you'll need to decide. Then ask every
   question in one batch, together with any approval from rule 5. After he answers, work to the end without stopping
   to ask again. For anything that comes up later, choose the sensible option and note it in the summary.
2. **Build in a worktree.** Use the `implement-in-worktree` skill for every change, docs and config included.
3. **Done means live.** Push the squashed commit to `main` (`git push origin HEAD:main`). App Hosting deploys every
   push to `main`. If `firestore.rules`, `firestore.indexes.json` or TTL settings changed, also run
   `npm run deploy:firestore` (local or cloud, no setup: it always deploys as the project's service account, never as
   whoever is logged in, and says exactly what to grant if a permission is missing; don't call `firebase deploy`
   directly). Then
   confirm it's live: `npm run rollouts -- <sha>` waits for that commit's App Hosting rollout and fails unless it
   SUCCEEDED. If it failed, fix it and push again. Never
   stop at a feature branch or a pull request unless Jeff asks for one. A cloud session is allowed to push to `main`.
4. **Clean up, then mark it done.** Remove the worktree, delete the local branch and delete the remote branch,
   including a cloud session's own `claude/*` branch (`git push origin --delete <branch>`). Then, in every session,
   local or cloud, rename the session to `√ <title>` with the `set_session_title` tool (the desktop app's is
   `mcp__ccd_session_mgmt__set_session_title` with `session_id: "self"`, a deferred tool: load it with ToolSearch).
   In a local session, also say "√ Live" on the first line of the final message.
5. **Real AI models need a yes, except the quick checks.** Jeff cares more about time than cost. `npm run
   check:roadie:vertex`, `npm run check:roadie:claude` and `npm run check:roadie` each take seconds (the Claude one makes
   three small calls with the dev key), so they're pre-approved. Run one before pushing whenever a change touches what
   Roadie or MCP offers the model (commands, tool schemas or descriptions, `src/server/assistant/`, `mcp/`); while Roadie's
   chat runs on Claude (`ROADIE_CHAT_MODEL` in `apphosting.yaml`), run the Claude one too. Anything longer that calls a real model needs Jeff's yes in the
   upfront questions: `npm run eval:roadie`, `npm run check:acts:vertex`, `npm run dev:vertex`, or `ROADIE_MODEL`
   set to anything but `fake`. If you don't have a yes, skip it and say so.
6. **Tests are free; run them.** Typecheck, `npm test` and `npm run e2e` run on the emulators and fakes. Run them in
   the worktree on its claimed ports (see the skill).
7. **Never leave a failing test behind.** If typecheck, `npm test` or `npm run e2e` has any failure, fix it in the same
   session before shipping, even when it also fails on main, looks unrelated, or looks flaky. Find the real cause: fix
   the test when it is wrong or fragile (a fixed date, the machine's timezone, data other specs change), fix the app
   when the app is wrong. Never skip, quarantine or loosen a test just to get green. Ship only on fully green suites.

## Cloud sessions: prod access is in the environment

Claude Code cloud sessions on the "Roadie" environment have `GOOGLE_CREDENTIALS_JSON`: the `roadie-prod-iab` service account's key (JSON). `gcloud auth list` shows no account and `GOOGLE_APPLICATION_CREDENTIALS` is unset; that does **not** mean there's no prod access. To run a script against prod (a migration, a backup), write the variable to a file outside the repo without printing it, and point the script at it:

```sh
printf '%s' "$GOOGLE_CREDENTIALS_JSON" > "$TMPDIR/gcp.json" && chmod 600 "$TMPDIR/gcp.json"
GCLOUD_PROJECT=roadie-prod-iab GOOGLE_APPLICATION_CREDENTIALS="$TMPDIR/gcp.json" npm run <script>
```

Dry-run first wherever the script has one, and never commit the key file.

The environment also has `ANTHROPIC_API_KEY_DEV` (the Claude dev key, the one in `.secrets/claude-dev.txt` locally) and
`ANTHROPIC_API_KEY_PROD`. `npm run check:roadie:claude` and `npm run eval:roadie` use `ANTHROPIC_API_KEY_DEV` when it's
set, so they need no setup in a cloud session. Never use the prod key for checks or evals: it's kept separate so live
usage can be measured on its own. Prod itself reads the `ANTHROPIC_API_KEY` secret from Secret Manager.

## Issues go in roadie-issues

Never open issues in `zilkey/roadie`; issues are turned off there. File every issue for Roadie in `zilkey/roadie-issues`
(`gh issue -R zilkey/roadie-issues ...`).
