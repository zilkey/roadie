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

### Phase 2 — done
**Built**
- `posts.setup` (`src/server/commands/posts.ts`, roles admin + mcp): refuses without Socials ("Choose the Socials folder in Settings › Google first") and when `canMoveIn(Socials)` is false ("Roadie's Google account needs Content manager…", code `drive_permission`, nothing changed); else `findOrMakeFolder(Socials, "Posts")`, shares Socials with `bandmates()` as writer, saves `postFoldersId`, returns `{ socials, posts: { id, made }, sharedWithBand }`. Also exports `setUpSocials(artistId)` and `NOT_SET_UP` ("Set up the Socials folder in Settings › Google"). `postsMonthFolder` and `NO_POSTS_FOLDER` are gone.
- `google.setPostsFolder` clears `postFoldersId` when the chosen folder changes (choosing the same one keeps it); its description now speaks of Socials. `google.status` gains `posts: { socialsId, socialsName, postsId?, setUp } | null`; `shared.tsx` `Status` gains it (`PostsSetup`). `ArtistIn` omits `postFoldersId`.
- Settings card: the Posts folder card is now **Socials folder** (test ids unchanged: `posts-folder-*`), with rows for Socials and `Posts/` (Working / Not set up) and a **Set up** button running `posts.setup` (`SocialsSetup` in `FolderCard.tsx`; ids `socials-row`, `socials-posts-row`, `socials-setup-button`, `socials-setup-note`).
- `POST /api/posts/upload`: needs Set up (`NOT_SET_UP`), saves into the Socials root, no per-file share; returns Socials as `folder`. The Posts page's Upload is off until `postFoldersId` is set, with the new message.
- `scripts/migrate-posts-49.ts` + `npm run migrate:posts-49` (dry run unless `--apply`): exports `migratePosts49({ apply })`, `titleFor`, `INTERRUPTED`.
- `tests/emulator/mcp.test.ts`: `posts.setup` added to the expected MCP tool list (the spec gives posts commands the mcp role).

**Deviations**
- `google.status().posts` is `null` until a Socials folder is chosen (the spec's shape has no "unchosen" case).
- `sharedWithBand` is the number of bandmates Socials is shared with on that run (all of them; sharing is idempotent), not only the newly added.
- Migration: a `publishing` post is set to `status: "failed"` with `error: "Interrupted before it posted"` (so it's editable like a failed one). An artist whose Set up hasn't run is skipped with a reason. If a move or the update fails mid-post, that post's moves are put back and its empty folder trashed, then it's reported as skipped. `modifiedTime` comes from the moved file (the move can bump it), else from `drive.get`. Posts are matched per artist by `artistId`.
- `tests/e2e/posts.spec.ts`: the upload step now chooses Socials and presses Set up (not run until phase 5; phase 3 replaces the NewPhotoPost flow anyway).

**Tests**
- `npx next typegen && npm run typecheck` → clean.
- `npx tsx --test tests/unit/photos.test.ts tests/unit/signedUrl.test.ts` → 6/6 pass.
- `npx firebase emulators:exec … "npx tsx --test --import ./tests/emulator/setup.mjs tests/emulator/posts.test.ts tests/emulator/google.test.ts tests/emulator/drive-list.test.ts"` → 33/33 pass (setup made/found/second run/noMove/Socials change; upload into the Socials root; migration title, dry run, `--apply`, re-run).
- `… tests/emulator/mcp.test.ts tests/emulator/roadie-policy.test.ts tests/emulator/roadie-tools.test.ts` → 37/37 pass.

**Manual steps for the owner**
- On prod, after deploying: Settings › Google › Socials folder › **Set up**, then `GCLOUD_PROJECT=roadie-prod-iab GOOGLE_APPLICATION_CREDENTIALS=… npm run migrate:posts-49` (dry run), check the report, then again with `-- --apply`.
- Next session (phase 3): `session_01MmV83ZHFX2S3DLFYsJ3CJJ`, created and in the working state (still starting up when checked).

### Phase 3 — done
**Built**
- `posts.photos { folder? }` (admin + mcp): `{ folders: { id, name, parentId, count }[], photos: Photo[], capped }`. Folders from `inboxFolders()`; every inbox folder's images are read with `listAll(…, "images", "createdTime desc")` (20 parents per query, every page), merged newest added first and cut at `photosLimits.max` (2,000; `CAPPED` message). `Photo` is `{ driveFileId, name, mimeType (photoType), width, height (swapped on an odd rotation), takenAt, folderId, thumb }`; `takenAt` is the EXIF time as written, else `createdTime` via the new `dateTimeInBandZone()` (`src/lib/timezone.ts`). A folder outside the inbox (Posts/, a post folder, anything outside Socials) is refused: "That folder isn't in Socials" (`not_in_socials`).
- `posts.list {}` (admin + mcp): `{ drafts, posts }` of `PostRow`; drafts = every non-posted status by `updatedAt` desc, posts = posted by `postedAt` (else `createdAt`) desc; `thumb` signed from the first photo's stored `modifiedTime`. Soft-deleted and other bands' posts left out.
- `thumbUrl(artistId, fileId, modifiedTime, size)` and `THUMB_SIZES` in `src/server/signedUrl.ts`; `listAll` takes an optional `orderBy`.
- `GET /api/posts/thumb/[artistId]/[fileId]?v=&s=&exp=&sig=`: `signedOk("thumb", …)`, `s` ∈ 400/1080/2048 (unsigned), streams `drive.thumbnail`, `cache-control: private, max-age=3600`; 503 for a missing secret on a real project, else a plain 404.
- `src/lib/photoDays.ts`: `photoDay` (before 04:00 → the day before), `dayLabels(shows, rehearsals)`, `groupByDay`, `dayTitle`.
- Pages: `PostsTabs` (Posts | Photos as links); **Posts** tab (`posts/page.tsx`) now lists Drafts then Posted from `posts.list`, keeps the Instagram not-connected / sign-in-again messages (plus "Posting to @…" when connected). `NewPhotoPost` is removed. **Photos** (`posts/photos/page.tsx` + `components/posts/PhotoGrid.tsx`): folder rail (Socials, nested folders with counts, link to Posts), Upload into the Socials root (off until Set up), day groups labelled from `useCollection("shows")`/`("rehearsals")`, numbered ordered picking with Shift-click ranges and per-day Select all, a sticky bottom bar (count + Clear), the 2,000 note; 3-column grid on a phone.
- `posts.photos`/`posts.list` added to the expected MCP tool list in `tests/emulator/mcp.test.ts`.

**Deviations**
- **Played shows label a day too** (hold, confirmed, played; not canceled or dropped). The decision "only hold and confirmed shows label a day" would leave every past show unlabelled once it's marked played, which breaks Done when ("with the show named"); I read it as excluding canceled/dropped. The seeded past show (2026-10-10, Creamery Arts Center) is `played`, so no new seed show was needed. Rehearsals label as "Rehearsal" or "Rehearsal · <location name>".
- `posts.photos` with `folder` still returns **every** inbox folder in `folders` (so the rail keeps its tree); only `photos` is narrowed to that folder and its subfolders. Socials' own id as `folder` means everything. Counts are always whole, so every inbox folder is listed from Drive on each call.
- Socials itself isn't in `folders` (as `inboxFolders` returns); the rail shows it as "Socials" (all) without a count. Files Drive lists as images that aren't a `photoType` (e.g. GIF) are left out of photos and counts. `width`/`height` are omitted when Drive has no `imageMediaMetadata`.
- The sticky bar has the count and Clear only: **Add to carousel draft**, the dialog, `?draft=` and "Make the draft is off until Set up" are phase 4. Posts tab rows don't link anywhere yet (the editor is phase 4).
- `photosLimits.max` is a mutable export (like `publishTiming`) so the cap test lowers it to 3 instead of seeding 2,001 files; the test also asserts the default is 2,000.
- `tests/e2e/posts.spec.ts`: the two `NewPhotoPost` tests (Post now from Drive/upload; a failed container) are replaced by one Photos test (Upload off until Set up, day label for the 01:30 photo, numbered picking, a folder in the rail, upload lands in Socials, empty Drafts). The failed-container e2e comes back with phase 5's publish. Not run (e2e runs in phase 5).

**Tests**
- `npx next typegen && npm run typecheck` → clean.
- `npx tsx --test tests/unit/photoDays.test.ts tests/unit/photos.test.ts tests/unit/signedUrl.test.ts` → 9/9 pass.
- `npx firebase emulators:exec --config firebase.test.json --only firestore,auth --project demo-band-tracker "npx tsx --test --import ./tests/emulator/setup.mjs tests/emulator/posts.test.ts tests/emulator/mcp.test.ts tests/emulator/drive-list.test.ts tests/emulator/google.test.ts tests/emulator/roadie-policy.test.ts tests/emulator/roadie-tools.test.ts"` → 76/76 pass (new: posts.photos whole inbox / nested + Posts skipped + folder refusal / batches + cap; the 01:30 photo's day labelled Creamery Arts Center; posts.list; thumb route signed, sizes, expiry, wrong sig, other version, other band, no preview, 503).

**Manual steps for the owner**
- None new. (Still: `SIGNED_URL_SECRET` before deploying; Set up + migration on prod.)
- Next session (phase 4): `session_01MmV83Xtps1NAg4VEXz2BaJ`, created and in the working state (still starting up when checked).

### Phase 4 — done
**Built**
- Commands in `src/server/commands/posts.ts` (admin + mcp, with help text): `posts.get`, `posts.createDraft`, `posts.addToDraft`, `posts.updateDraft`, `posts.rename`, `posts.removeFromDraft`, `posts.deleteDraft`.
  - Shared checks (`pickable`): each photo is in the inbox (Socials or an inbox folder), is a `photoType`, isn't trashed; a photo in a post's folder names that post (one `driveFolderId ==` query per parent). Nothing moves until every photo passes.
  - `createDraft`: `uniqueName("DRAFT - " + title)` folder in `Posts/`, moves each photo in, then the doc (`draft`, `caption: ""`, `aspect: "4:5"`, `media` with name, upright size, `modifiedTime` from the move, `url`, `from.folderId`). On a failed move or create: moves put back, the folder trashed if empty, no doc.
  - `addToDraft` (cap 10, "A post holds at most 10 photos"), `rename` (folder renamed back if the save fails), `removeFromDraft` ("Delete the draft instead" for the last photo; moved back into the draft if the save fails), `deleteDraft` (keeps going past a failed move; trashes the folder only if empty, else leaves it and says so; soft-deletes the doc).
  - `updateDraft`: `{ caption?, aspect?, order?, items? }`, Firestore only; refuses >30 hashtags, an `order` that isn't every photo once, an `items` key not in the post. Draft edits refuse `posted` / `publishing` posts with the spec's messages.
  - `posts.list` rows gain `driveFolderId`.
- `src/server/undo.ts`: `changedDrive(entry)` + `DRIVE_CHANGED`; `undoRun` refuses (409 `drive_changed`, nothing reverted) any run with a `posts` create/delete/restore, a `title`/`status`/`driveFolderId` change, or a change in which `driveFileId`s are in `media`. Reorder/caption/alt/crop/aspect stay undoable.
- `src/server/assistant/policy.ts`: `posts.` no longer excluded; `ALWAYS_CONFIRM` + `posts.setup/publish/deleteDraft/removeFromDraft`; `VOICE_TAP_ONLY` + `posts.setup/publish`; `READ_ONLY` + `posts.photos/list/get`; `ONE_RECORD_LISTS` + `posts.updateDraft`; the four `SUMMARY` lines. `tools.ts` `fillPost` gives those cards the post's title, photo count and the photo's name.
- UI: `AddToDraftDialog.tsx` (new draft by name or an existing draft/failed post with a folder; says the photos move to `Posts/DRAFT - <name>`); Photos' bar gets **Add to carousel draft** (off with the Set up link until Set up), and with `?draft=<id>` reads **Add to <title>** and calls `addToDraft`. Posts tab rows link to the editor. Editor `posts/[id]/page.tsx` + `CarouselEditor.tsx`: crop preview (s=1080, `object-fit: cover`, drag sets `focus` by `−dx/(renderedWidth − frameWidth)`), 4:5 / Square, list with drag (`drag-reorder.ts`) and ↑/↓, alt text, ×, Add photos, caption with characters/2,200 and hashtags/30, pencil rename on blur/Enter, Delete draft, missing/trashed photo "… is no longer in Drive" + Remove, read-only when posted/publishing, autosave via `useAutosave("posts.updateDraft")` with SaveStatus.

**Deviations**
- `posts.get` returns `{ ...post, photos: { [driveFileId]: { thumb1080, missing, trashed } } }`. The `modifiedTime` save-back is a direct Firestore transaction (no rev, no history), as the spec says it isn't in history.
- `deleteDraft` returns `{ folderLeft, notMoved, message? }`: `notMoved` is the photos' names (no extension) and `message` carries the spec's sentence ("Couldn't move IMG_4412 back: … The draft keeps it" / "Left DRAFT - x in Drive: …"). When some photos couldn't move back the draft stays, so `folderLeft` is true.
- Messages name a photo by its file name without the extension ("IMG_4410"), matching the spec's examples.
- A photo Drive answers 404 for (deleted for good) leaves the post without a move in `removeFromDraft`/`deleteDraft`; otherwise the editor's **Remove** on a missing photo could never work.
- A post with no `driveFolderId` (an unmigrated #49 post) is refused for draft edits: "This post has no folder in Drive yet; run the #49 migration first".
- `updateDraft` accepts `caption: null` (autosave's `bind` sends null for an emptied field) and saves `""`; `alt: ""` clears the alt text.
- "Return no runId": the dispatcher still returns a `runId` for every command; the client shows no Undo toast for the Drive commands (only autosave toasts), and `undoRun` refuses those runs anyway.
- `posts.publishPhoto` stays in `EXCLUDED` (by name) until phase 5 deletes it, so Roadie isn't offered the old one-photo post; `posts.publish`'s policy entries are in place for phase 5.
- The editor reads the live doc (`useDoc("posts", id)`, admins can read posts) so an Undo shows at once, and calls `posts.get` for previews and missing flags (again whenever the set of photos changes). Delete draft asks with `window.confirm`. **Post now** / `PostDialog.tsx` are phase 5.
- `tests/e2e/posts.spec.ts`: the Photos test also checks Make the draft is off until Set up; new test "Drafts: pick 5, Make the draft, reorder, caption and alt autosave; Delete draft puts them back" (relies on the Photos test's Set up). Not run (e2e runs in phase 5).

**Tests**
- `npx next typegen && npm run typecheck` → clean.
- `npx tsx --test tests/unit/photos.test.ts tests/unit/signedUrl.test.ts tests/unit/photoDays.test.ts` → 9/9 pass; `tests/unit/roadie-policy.test.ts tests/unit/roadie-tools.test.ts tests/unit/help.test.ts tests/unit/roadie-script.test.ts` → 22/22 pass.
- `npx firebase emulators:exec --config firebase.test.json --only firestore,auth --project demo-band-tracker "npx tsx --test --import ./tests/emulator/setup.mjs tests/emulator/posts.test.ts tests/emulator/mcp.test.ts tests/emulator/roadie-policy.test.ts tests/emulator/roadie-tools.test.ts tests/emulator/undo.test.ts tests/emulator/history.test.ts tests/emulator/drive-list.test.ts tests/emulator/google.test.ts"` → 97/97 pass (new: createDraft moves + `from`, refusals naming the post, " (2)", `failMove: 2` undo; addToDraft append/cap/`failMove`; updateDraft shape/whole items/hashtags/`baseRev` conflict/locked; rename + clash; removeFromDraft own folder/root/last/failed move; deleteDraft back + trash/PDF left/partial; posts.get trashed flag + save-back; undo refusal vs caption/order revert; policy).

**Manual steps for the owner**
- None new. (Still: `SIGNED_URL_SECRET` before deploying; Set up + migration on prod.)
- Next session (phase 5): `session_01MmV83YbpT97cJ1EkkRyixq`, created and in the working state (still starting up when checked).
