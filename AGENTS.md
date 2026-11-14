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
   `npx firebase deploy --only firestore --project roadie-prod-iab` (in cloud sessions, with the key as below). Never
   stop at a feature branch or a pull request unless Jeff asks for one. A cloud session is allowed to push to `main`.
4. **Clean up, then mark it done.** Remove the worktree, delete the local branch and delete the remote branch,
   including a cloud session's own `claude/*` branch (`git push origin --delete <branch>`). In a cloud session, finish
   by renaming the session to `√ <title>` (the `set_session_title` tool). Local sessions have no such tool: say "√ Live"
   on the first line of the final message instead.
5. **Real AI models need a yes, except the quick checks.** Jeff cares more about time than cost. `npm run
   check:roadie:vertex` and `npm run check:roadie` each make one call that takes seconds, so they're pre-approved. Run
   one before pushing whenever a change touches what Roadie or MCP offers the model (commands, tool schemas or
   descriptions, `src/server/assistant/`, `mcp/`). Anything longer that calls a real model needs Jeff's yes in the
   upfront questions: `npm run eval:roadie`, `npm run check:acts:vertex`, `npm run dev:vertex`, or `ROADIE_MODEL`
   set to anything but `fake`. If you don't have a yes, skip it and say so.
6. **Tests are free; run them.** Typecheck, `npm test` and `npm run e2e` run on the emulators and fakes. Run them in
   the worktree on its claimed ports (see the skill).

## Cloud sessions: prod access is in the environment

Claude Code cloud sessions on the "Roadie" environment have `GOOGLE_CREDENTIALS_JSON`: the `roadie-prod-iab` service account's key (JSON). `gcloud auth list` shows no account and `GOOGLE_APPLICATION_CREDENTIALS` is unset; that does **not** mean there's no prod access. To run a script against prod (a migration, a backup), write the variable to a file outside the repo without printing it, and point the script at it:

```sh
printf '%s' "$GOOGLE_CREDENTIALS_JSON" > "$TMPDIR/gcp.json" && chmod 600 "$TMPDIR/gcp.json"
GCLOUD_PROJECT=roadie-prod-iab GOOGLE_APPLICATION_CREDENTIALS="$TMPDIR/gcp.json" npm run <script>
```

Dry-run first wherever the script has one, and never commit the key file.
