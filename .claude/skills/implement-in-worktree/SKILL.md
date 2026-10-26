---
name: implement-in-worktree
description: Implement a story or feature in its own git worktree with its own test ports, run the unit and e2e suites there until green, then squash it onto main and fast-forward main for Jeff to test by hand. Use when asked to "implement in a worktree", "build this in a worktree", or to work on a story in parallel with other sessions.
---

# Implement in a worktree

Several sessions may be building at once. Each one gets its own worktree, branch and test ports, so its test runs
never collide with another session's or with `npm run dev:all` in the main checkout. Main stays the integration
point: you only touch it at the end, with one fast-forward.

Running `npm test` and `npm run e2e` **is** part of this skill: inside a worktree, on the claimed ports, it
overrides the usual "don't run tests" rule. Never run them on the default ports, and never from the main checkout.

## 1. Set up

Pick a short kebab-case slug from the story (e.g. `whos-free`). From the main checkout
(`/Users/jeff/workspace/band-tracker`), which must be on `main`:

```sh
git worktree add ../roadie-<slug> -b <slug> main
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
task actually needs them. Do all further work, edits included, inside the worktree path.

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

If every offset is taken, run `-- list` and tell Jeff which claims look stale (worktree gone, branch merged).
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
- Rerun single specs while fixing, then the full suites once at the end. `npm run e2e -- <spec>` does **not** work:
  the extra argument goes to `firebase emulators:exec`, not to Playwright. Spell the command out instead:

  ```sh
  rm -rf .fake-data-test && TEST_PORT_OFFSET=30 npx firebase emulators:exec --config firebase.worktree.json \
    --only firestore,auth --project demo-band-tracker \
    "GCLOUD_PROJECT=demo-band-tracker tsx scripts/seed.ts && playwright test tests/e2e/foo.spec.ts"
  ```
- Fix failures your change caused. If a failure is clearly unrelated and also fails on main, note it and move on;
  don't fix other features' tests here.
- If the e2e web server never starts, look at the first `[WebServer]` error in the tee'd file. "Could not find the
  Next.js package" means `node_modules` is a symlink or only partly installed; see step 1.
- Don't run screenshot specs or before/after captures.

## 5. Squash onto main

When typecheck, `npm test` and `npm run e2e` all pass:

```sh
git rebase main                         # resolve conflicts; rerun the suites if the rebase changed code
git reset --soft main
git commit                              # one commit: a short title like the recent `git log` ones, a body if useful
```

End the commit message with the attribution trailer from the system reminder.

## 6. Merge for human testing

```sh
git -C /Users/jeff/workspace/band-tracker status --short    # must be clean
git -C /Users/jeff/workspace/band-tracker merge --ff-only <slug>
```

- If main has uncommitted changes, stop and ask Jeff; don't stash or commit them.
- If `--ff-only` fails because main moved, go back to step 5 (rebase, rerun the suites if anything changed, squash
  again).
- Don't push.

## 7. Clean up and hand over

```sh
npm run worktree:ports -- release
cd /Users/jeff/workspace/band-tracker
git worktree remove ../roadie-<slug>     # it holds no unmerged work now
git branch -d <slug>
```

Then tell Jeff: the commit on main, what to try in the running dev app (pages, flows, seed data needed), and which
specs were added or changed. If anything was skipped or still fails, say so with the output.
