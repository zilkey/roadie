---
name: implement-in-worktree
description: The way every change ships, local or cloud. Build it in its own git worktree with its own test ports, run the unit and e2e suites there until green, squash it onto main, push main (App Hosting deploys it), clean up the worktree and branches, and mark the session √. Use for every change unless Jeff says otherwise.
---

# Implement in a worktree

Several sessions may be building at once. Each one gets its own worktree, branch and test ports, so its test runs
never collide with another session's or with `npm run dev:all` in the main checkout. Main stays the integration
point: you only touch it at the end, with one fast-forward and a push. The standing rules are in AGENTS.md ("How Jeff
works"): questions go upfront, done means live, and real-model runs need a yes.

Running `npm test` and `npm run e2e` **is** part of this skill, always: inside the worktree, on the claimed ports.
Never run them on the default ports, and never from the main checkout.

## 1. Set up

Pick a short kebab-case slug from the story (e.g. `whos-free`). From the main checkout (`~/workspace/roadie` locally,
the session's repo directory in a cloud session), start from the latest pushed main:

```sh
git fetch origin main
git worktree add ../roadie-<slug> -b <slug> origin/main
cd ../roadie-<slug>
npm ci > junk.ci.txt 2>&1; echo ci=$?; tail -3 junk.ci.txt
```

The worktree needs its own real `node_modules`. **Never symlink it to the main checkout's**: Turbopack refuses to
resolve packages outside the worktree root, so `next dev` in e2e dies with "Could not find the Next.js package
(next/package.json)" and no test runs. `npm ci` takes about 10 seconds with a warm npm cache. Run it in the
foreground, on its own, and check `ci=0` and "added N packages" before doing anything else. Don't chain it into a
background e2e job: if that job gets stopped, the install is left half done. The `allow-scripts` and `EBADENGINE`
warnings are expected and harmless.

If a worktree from an earlier session still has a symlinked `node_modules` (`ls -ld node_modules` shows `->`),
replace it: `rm node_modules && rm -rf .next-test && npm ci`. If an install is ever incomplete, run `rm -rf
node_modules && npm ci` again; don't fall back to the symlink, even for a quick typecheck.

Copy any gitignored files the work needs from the main checkout (e.g. `src/lib/band.ts`, `.secrets/`) only if the
task actually needs them, and **copy them: `cp -R`, never `ln -s`**. A symlink inside the worktree is a file git
will happily commit (2026-10-29: a `.secrets -> ../band-tracker/.secrets` link slipped into a squash because the
ignore rule was `.secrets/`, directories only; the fast-forward then replaced the main checkout's real `.secrets`
folder with the link and both keys were lost). Do all further work, edits included, inside the worktree path.

In a cloud session, Playwright may want a newer Chromium build than the one installed in `/opt/pw-browsers`. If e2e
says "Executable doesn't exist" or "npx playwright install", don't install anything. Point it at the installed build
under the revision name it expects (the revision is in `node_modules/playwright-core/browsers.json`):

```sh
B=$SCRATCHPAD/pw; mkdir -p $B; R=<revision>
for d in /opt/pw-browsers/*-[0-9]*; do n=$(basename $d); case $n in ffmpeg*) ln -sfn $d $B/$n;; *) ln -sfn $d $B/${n%-*}-$R;; esac; done
export PLAYWRIGHT_BROWSERS_PATH=$B   # prefix every e2e run with this
```

## 2. Claim test ports

Your session id is the UUID in your scratchpad path (`/private/tmp/claude-*/<project>/<session-id>/scratchpad`).

```sh
npm run worktree:ports -- claim <session-id>
```

This adds a line to the shared `emulators` file in the main checkout (offset, session, branch, worktree, time),
writes `firebase.worktree.json` in the worktree, and prints the env prefix, e.g.
`TEST_PORT_OFFSET=30 FIREBASE_TEST_CONFIG=firebase.worktree.json`. Every test port is its dev port plus the offset
(Firestore 8280, Auth 9319, Next 3100, fakes 3201-3207). Running claim again from the same worktree reuses the
claim; `npm run worktree:ports -- env` prints the prefix again; `-- list` shows every claim.

If every offset is taken, run `-- list` and tell the developer which claims look stale (worktree gone, branch merged).
Don't delete other sessions' lines yourself.

## 3. Implement

Follow AGENTS.md and the project memories (wireframes, autosave, no invented fields, ...). Read the Next docs in
`node_modules/next/dist/docs/` before writing Next code. Commit as you go on the branch; messages don't matter much,
they get squashed.

## 4. Test until green

Always with the prefix, from the worktree:

```sh
npm run typecheck
TEST_PORT_OFFSET=30 FIREBASE_TEST_CONFIG=firebase.worktree.json npm test 2>&1 | tee junk.test.txt
TEST_PORT_OFFSET=30 FIREBASE_TEST_CONFIG=firebase.worktree.json npm run e2e 2>&1 | tee junk.e2e.txt
```

- Run in the background for e2e (it takes minutes); read the tee'd file for failures.
- Rerun single specs while fixing, then the full suites once at the end. A single e2e spec works with the prefix
  (arguments go to Playwright, and named specs run in one shard):

  ```sh
  TEST_PORT_OFFSET=30 FIREBASE_TEST_CONFIG=firebase.worktree.json npm run e2e -- tests/e2e/foo.spec.ts
  ```

  The e2e shards use the claimed offset + 1000, 2000, 3000, 4000 (up to 5000 with `E2E_SHARDS=5`), so a worktree's
  claim keeps all of them clear of other worktrees.
  For a single emulator test file, spell the command out (`tests/unit` files need no emulator: `tsx --test tests/unit/foo.test.ts`):

  ```sh
  TEST_PORT_OFFSET=30 npx firebase emulators:exec --config firebase.worktree.json \
    --only firestore,auth --project demo-band-tracker \
    "tsx --test --import ./tests/emulator/setup.mjs tests/emulator/foo.test.ts"
  ```
- Fix failures your change caused. If a failure is clearly unrelated and also fails on main, note it and move on;
  don't fix other features' tests here.
- If the e2e web server never starts, look at the first `[WebServer]` error in the tee'd file. "Could not find the
  Next.js package" means `node_modules` is a symlink or only partly installed; see step 1.
- Don't run screenshot specs or before/after captures.

## 5. Squash onto main

When typecheck, `npm test` and `npm run e2e` all pass:

```sh
git fetch origin main
git rebase origin/main                  # resolve conflicts; rerun the suites if the rebase changed code
git reset --soft origin/main
git commit                              # one commit: a short title like the recent `git log` ones, a body if useful
```

End the commit message with the attribution trailer from the system reminder.

Then, before touching main, **prove the commit carries no stray files**. Both checks must print nothing:

```sh
git diff --name-only --diff-filter=A origin/main HEAD | git check-ignore --no-index --stdin   # added paths main would ignore
git diff-tree -r --no-commit-id HEAD origin/main | awk '$2 == "120000" || $1 == ":120000" {print}'                                # symlinks in the diff
```

If either prints a path, `git rm --cached` it, amend, and rerun the checks. Never merge a commit that adds a
symlink or an ignored path: the fast-forward checks it out in the main checkout and overwrites whatever is there,
including gitignored folders like `.secrets/`.

## 6. Check the real model, if the change reaches it

If the change touches what Roadie or MCP offers the model (commands, tool schemas or descriptions,
`src/server/assistant/`, `mcp/`), run `npm run check:roadie:vertex` once (one call, seconds, pre-approved). In a cloud
session, prefix it with the key from AGENTS.md. Run slower real-model runs (`npm run eval:roadie`) only if Jeff said
yes upfront.

## 7. Ship it: push main (this deploys)

```sh
git push origin HEAD:main               # App Hosting deploys every push to main
```

- If the push is rejected because main moved, go back to step 5: fetch, rebase, rerun the suites if anything changed,
  squash again, push.
- If `firestore.rules`, `firestore.indexes.json` or TTL settings changed, deploy them too:
  `npx firebase deploy --only firestore --project roadie-prod-iab`.
- Locally, also bring the main checkout up to date when it's clean (`git -C ~/workspace/roadie status --short` prints
  nothing): `git -C ~/workspace/roadie pull --ff-only`, then check that `.secrets` and `src/lib/band.ts` are still
  real files, not links. If it has uncommitted changes, leave it alone and say so.

## 8. Clean up and mark it done

```sh
npm run worktree:ports -- release
cd <main checkout>
git worktree remove ../roadie-<slug>
git branch -D <slug>
git push origin --delete <slug> 2>/dev/null   # if it was ever pushed
```

In a cloud session, also delete the session's own `claude/*` branch from origin, once its work is on main. Then rename
the session to `√ <title>` with `set_session_title`. Locally there's no tool for that: start the final message with
"√ Live".

The final message says: what is live and the commit on main, what to try in the app, which specs were added or
changed, and anything skipped or still failing, with the output.
