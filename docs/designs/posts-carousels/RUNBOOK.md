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

### Phase 1 — done
**Built**
- `src/schema/posts.ts`: the new `Post` (status `draft`, `title`, `aspect`, `media` items with `name`/`width`/`height`/`modifiedTime`/`alt`/`focus`/`from`, max 10, `driveFolderId`, `postedAt`, `driveTidy`); exports `PostMedia`. `src/schema/artists.ts`: `postsFolderId` doc comment for the Socials layout, new `postFoldersId`.
- `src/lib/photos.ts`: `PHOTO_TYPES`, `photoType(name, mimeType)`, `hashtagCount`, plus `PHOTOS_ONLY` ("Roadie takes JPEG, HEIC, PNG and WebP photos"), `CAPTION_MAX`, `HASHTAG_MAX`.
- `src/server/integrations/drive.ts`: `DriveFile` gains `size`, `image`, `thumbnailLink`, `trashed`; `FILE_FIELDS` asks for them; `DriveService.list/update/trash/thumbnail/canMoveIn` on the real service and the fake client; `rename` is a wrapper over `update`; exported `listQuery()` builds the real `q`.
- `src/server/driveFolders.ts`: the merged `findOrMakeFolder(drive, parentId, name, share?)` → `{ folder, made }`. Show posters, releases and `postsMonthFolder` use it (`.folder`).
- `src/server/postFolder.ts`: `isEmpty`, `uniqueName`, `inboxFolders`, `moveInto`, `moveBack`, plus helpers `listAll` (pages, 20 parents per query) and `socialsOf`.
- `src/server/signedUrl.ts`: `signUrl` / `signedOk` / `expiryFor` (HMAC with `SIGNED_URL_SECRET`, 503 on a real project without it, a fixed dev key otherwise; exp = hour start + 2 h). `src/server/meta/media.ts` now signs through it (scope `media`, index `"0"`); the existing `[id]` media route answers 503 for that error. Comments in `graph.ts` and `media.ts` updated. `apphosting.yaml` references `SIGNED_URL_SECRET`; `docs/SETUP.md` says how to set it.
- `JPEG`/`JPEG_ONLY` replaced by `photoType`/`PHOTOS_ONLY` in `posts.ts` (`publishPhoto`), the upload route and `posts/page.tsx`.
- `fakes/fake-drive/server.ts`: `GET /files/list`, `PATCH /files/:id` (name, addParents/removeParents, trashed, bumps `modifiedTime`), `POST /files` sets `modifiedTime`, `GET /files/:id` adds `capabilities` on folders, `GET /files/:id/content` serves fixture bytes, `GET /thumbnails/:id?s=` (sharp, upright, long edge `s`), `POST /__scenario` (`failMove`, `failRename`, `noMove`, `noThumbnail`), search leaves trashed files out. Seed: `Socials` (`SOCIALS_FOLDER_ID = "fake-folder-socials"`, in the band folder) with `Jeff's phone spring 26/` (6 photos), 3 loose photos, `2026-10/` with one #49 photo, and `Set list.pdf`.
- `tests/fixtures/photo-rotated.jpg` (1200×900, EXIF 6) and `photo-landscape.jpg` (1600×1000): four coloured quadrants, so crops and rotation show in the pixels.
- `package.json`: `"sharp": "0.35.5"` (lockfile edited by hand to the minimal change: the local npm is 10, and a full `npm install` rewrote unrelated `libc` fields).

**Deviations**
- The `postFolder.ts` functions take the `DriveService` as their first argument (`isEmpty(drive, id)`, `inboxFolders(drive, artistId)`, `moveBack(drive, { socialsId, postFolderId }, media)`), so a command makes one client and passes it on. `moveBack` needs the post folder to remove the photo from, so it takes it. `uniqueName` takes an optional `self` folder id so `posts.rename` doesn't clash with its own folder.
- `inboxFolders` does not include Socials itself (createDraft's check says "or is Socials itself"); it skips Posts/ by `postFoldersId`, and also by the name `Posts` directly under Socials, so it works before Set up.
- `signUrl` returns `{ exp, sig }` (the query values), not a whole URL; callers build their path (thumb and media routes differ). Until phase 5 the media link keeps its `/api/posts/media/{postId}` path, signed with `v = "0"`.
- The fake's files use the client's `DriveFile` shape (`image`, not `imageMediaMetadata`), as the fake already did for `createdAt`/`ownerEmail`. `capabilities.canMoveChildrenWithinDrive` is true on every fake folder unless `noMove`.
- The seed has no past *confirmed* show: the only past show (2026-10-10, Creamery Arts Center) is `played`. The 01:30 photo (`fake-social-late`, `IMG_2210.JPG`) is dated 2026-10-11 01:30 for that show. **Phase 3:** either count `played` shows as labels too, or seed a past confirmed show, and record it.
- The 2 HEICs: one `image/heic`, one `application/octet-stream` (found by its `.HEIC` name). The loose photos are a JPEG, a HEIC and a PNG.
- `publishPhoto` now accepts any `photoType` (as the spec says); posting a HEIC or PNG through it would still be refused by Instagram until phase 5's media route converts it.
- `tests/emulator/posts.test.ts`: the upload and `publishPhoto` refusals now use a PDF (a PNG is a photo now), and the upload test also checks an octet-stream HEIC is kept as `image/heic`. `tests/e2e/posts.spec.ts` got the same change (PDF instead of PNG, new message); not run until phase 5.

**Tests**
- `npx next typegen && npm run typecheck` → clean (on a fresh clone `tsc` reports missing `PageProps`/`LayoutProps` until `next typegen` has run once).
- `npx tsx --test tests/unit/photos.test.ts tests/unit/signedUrl.test.ts tests/unit/integrations.test.ts` → 14/14 pass.
- `npx firebase emulators:exec --config firebase.test.json --only firestore,auth --project demo-band-tracker "npx tsx --test --import ./tests/emulator/setup.mjs tests/emulator/drive-list.test.ts tests/emulator/show-posters.test.ts tests/emulator/releases.test.ts tests/emulator/recordings.test.ts tests/emulator/posts.test.ts tests/emulator/google.test.ts"` → 45/45 pass.

**Manual steps for the owner**
- Set the `SIGNED_URL_SECRET` App Hosting secret before deploying anything from this branch (`apphosting.yaml` now references it; command in `docs/SETUP.md`).
- Local dev: a persisted `.fake-data/fake-drive.json` predates the Socials seed; reset the fake (its page's Reset button, or delete the file) to get it.
- Next session (phase 2): `session_01MmV83WH51qR8HAz7wiZSxj`, started and running.
