# Goldfish Review Report: Stage 9 re-run, on the Nov 12 rewrite

**Target:** `docs/designs/posts-carousels/design.md`, DetailedRange (lines 107–390, `## Implementation plan`)
**Standard:** `implementation-readiness-standard` (implementation-readiness, codebase-details); the style persona's own rules

## Reviewer Status

| Reviewer | Status | Verdict | Raw findings |
| --- | --- | --- | --- |
| `egm-implementation-readiness` | completed | NOT READY | 1 🔴 · 11 🟡 · 2 🟢 |
| `egm-codebase-details` | completed | FAIL | 3 🔴 · 15 🟡 · 12 🟢 |
| `egm-style` | completed | approve with revisions | 0 🔴 · 2 🟡 · 13 🟢 |

**Compared with the first stage 9 run:** none of the first run's Blockers came back. The thumb signing, the Roadie/MCP claim and the autosave input shape are all fixed. The style reviewer went from 6 Majors to 2. The new findings are mostly where the plan meets existing code: undo, the fakes, the Drive service and policy conventions. Deduplicated below: **3 🔴 · 19 🟡 · 14 🟢.**

Each reviewer confirmed that most named files, functions and constants exist as described. The exceptions are listed below.

## Prioritized Findings (Blockers -> Major -> Nits)

### The editor has no command to load its data - Severity: Blocker
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Pages › Editor (lines 299–303); `posts.list` (line 209); Signed URLs (line 189); `Media` (lines 115–125); `src/server/commands/music.ts:68, 181`
* **Discrepancy Description**:
  * The editor needs a signed thumbnail for every photo and a check that each photo still exists. `drive.get` is server-only, and no client-facing command provides either.
  * The thumbnail signature needs `modifiedTime`, which `Media` doesn't store. So `posts.list` and the editor would need one Drive call per photo, in a place the plan doesn't name.
* **Rationale & Recommendation**: Add a read-only `posts.get { id }` (READ_ONLY, with tests) that returns the post plus `{ thumb, missing, trashed }` for each photo. Store `modifiedTime` on `Media` when a photo is picked, and refresh it in `posts.get`.

### The Content manager check has no mechanism - Severity: Blocker
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** `posts.setup` (line 199), fake seed (line 316), tests (lines 328, 359); `drive.ts:28–47, 90, 95`; `fakes/fake-drive/server.ts:15–26`
* **Discrepancy Description**:
  * `DriveService` can't read Shared Drive roles or capabilities.
  * `roleOf` maps `organizer` and `fileOrganizer` both to `writer`.
  * The fake has no Shared Drive concept and no way to seed a "not a Content manager" case.
* **Rationale & Recommendation**: Name the Drive call, for example `files.get` with `capabilities(canMoveItemWithinDrive)` on the Socials folder. Add the `DriveService` method or field for it, say how `toFile` carries it, and describe how the fake models it and how a seed flag switches it.

### The "folder is empty" check before trashing is undefined and unsafe - Severity: Blocker
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** `createDraft` undo (line 221), `deleteDraft` (line 241), Drive layout (lines 44, 47); `list` (line 161); `drive.ts:146–150`
* **Discrepancy Description**: `list` only lists folders or images, so a video, PDF or Doc dropped into a post folder would be missed. Trashing that folder would then trash the file, which breaks "Roadie never deletes a photo".
* **Rationale & Recommendation**: Define "empty" as no non-trashed child of any type, use `search({ parent })` or a `kind: "all"` option, and test it with a non-image file.

### Undo leaves Firestore and Drive out of step - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** `src/lib/autosave.ts:99–101`, `src/server/commands/ai.ts:339–345`, `src/server/undo.ts:6`
* **Discrepancy Description**: The autosave toast's Undo, and Roadie's "undo that" (`history.undoRun`), revert Firestore only. Undoing a title rename, `createDraft`, `removeFromDraft` or `deleteDraft` would leave Drive as it was after the command.
* **Rationale & Recommendation**: Decide whether posts runs can be undone, and if so how (see the decision below).

### An `items` patch loses edits when two saves merge - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** `posts.updateDraft` (lines 228–233); `src/lib/autosave.ts:130`
* **Discrepancy Description**: Autosave merges patches per top-level key, so editing alt text on photo A and then focus on photo B within the debounce sends only B's change.
* **Rationale & Recommendation**: Have the client always send the full `items` map, and say so.

### There is no way to hard-delete a doc - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** `createDraft` undo (line 222); `src/server/db.ts:348–446, 526–552`
* **Discrepancy Description**: `db` offers create, merge, update, softDelete, restore and revert, but no hard delete. Each `db.create` commits straight away.
* **Rationale & Recommendation**: Create the doc last, after the folder and the moves succeed (so undo needs no delete), or name the raw delete and say what happens to its history.

### `addToDraft`, `removeFromDraft` and `deleteDraft` don't define their own steps and undo - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** lines 172, 226, 235–242
* **Discrepancy Description**: Read literally, "the same steps and undo as createDraft" would make a new doc and folder, and on failure would delete the existing draft. `removeFromDraft` and `deleteDraft` have no partial-failure rule.
* **Rationale & Recommendation**: Write out the steps and undo for each. `addToDraft`: move the photos into `driveFolderId`, then append to `media`; on failure, move them back. `deleteDraft`: when a move fails partway, keep going, then report what was left.

### The fake Drive's query format and failure flags are undefined - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** Fakes (lines 310–323); `drive.ts:67`; `fakes/fake-drive/server.ts:171–174`
* **Discrepancy Description**: The fake's `q` already means "name contains", so it can't also parse Drive query syntax on the same route. There are no flags to make the nth move or a rename fail, which the undo and `driveTidy` tests need.
* **Rationale & Recommendation**: Give `list` its own parameters or route on the fake, and add `failMove=<n>` and `failRename` scenario flags.

### The HEIC test can't test what it claims - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** lines 273–274, 323, 365
* **Discrepancy Description**: HEIC renders from the fake's generated JPEG thumbnail, so a rotated `.heic` fixture never reaches sharp. The `.rotate()` path only runs for JPEG, PNG and WebP, and the JPEG fixture has no rotation. Sharp's prebuilt build also can't encode HEIC, so the plan doesn't say where the fixture comes from.
* **Rationale & Recommendation**: Test rotation with a JPEG that has EXIF orientation 6. Make the fake's thumbnail upright and sized from `imageMediaMetadata`. Test HEIC on the thumbnail path, checking only size and type.

### `posts.photos` has gaps in its contract - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** lines 202–206
* **Discrepancy Description**:
  * It takes `pageToken` but returns none, and stops at 2,000.
  * `folders` is a flat list with no `parentId`.
  * It's unclear whether `count` counts every photo or only those under the cap.
  * It's unclear whether a chosen `folder` includes its subfolders, or what happens if it's `Posts/`.
  * There's no rule for merging the results of the 20-parent batches.
* **Rationale & Recommendation**:
  * Drop `pageToken` and add `parentId`.
  * `count` counts everything.
  * A chosen folder includes its subfolders, and `Posts/` is refused.
  * Merge the batches newest first across all of them, then cap at 2,000.

### Old #49 posts appear in the new flows with no rules - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Data (line 110), `posts.list` (line 210), status rule (line 193)
* **Discrepancy Description**: Old `failed` posts have no `title`, folder or `from`, yet "drafts include failed posts" makes them editable. Old `publishing` rows aren't placed in either list.
* **Rationale & Recommendation**: Posts with no `driveFolderId` are read-only and shown under posts, and `publishing` rows show with drafts (see the decision below).

### "Production" isn't defined for the signing-secret fallback - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** lines 184–186; `mcp/web.ts:32–35`
* **Discrepancy Description**: The codebase has no `isProd`. A `NODE_ENV` check would return 503 under `next start` in the e2e tests.
* **Rationale & Recommendation**: Reuse the existing convention: a real project is one where `GCLOUD_PROJECT` is set and not `demo-*`.

### Policy changes don't follow the codebase's conventions - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** lines 259–265, 145; `policy.ts:57, 72–76, 94, 121–127, 224–236`; `people.ts:302`
* **Discrepancy Description**:
  * `posts.setup` changes sharing, but it isn't in `ALWAYS_CONFIRM` or `VOICE_TAP_ONLY`.
  * An `updateDraft` with an `order` of more than 5 ids triggers a bulk confirm unless it's in `ONE_RECORD_LISTS`.
  * There's no `SUMMARY` card text for the new commands, and `tidy`'s confirm behaviour isn't stated.
  * `artists.update` (`ArtistIn`) can still set `postFoldersId`, so "only `posts.setup` sets it" isn't enforced.
* **Rationale & Recommendation**:
  * Add `posts.setup` to both lists, and `posts.updateDraft` to `ONE_RECORD_LISTS`.
  * Write the card summaries, and state `tidy`'s confirm behaviour.
  * Omit `postFoldersId` from `ArtistIn`, and add `people.ts` to the file list.

### Phase 1 doesn't typecheck - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** lines 174–179, 284, 327–328; `commands/posts.ts:14, 30–35`
* **Discrepancy Description**: Merging `findOrMakeFolder` changes its return type, but `postsMonthFolder` still uses the old one until phase 2. `JPEG_ONLY` is in `commands/posts.ts`, not in the schema. The phase 1 gate names tests that aren't in the file list.
* **Rationale & Recommendation**: Move the `postsMonthFolder` and `JPEG` changes into phase 1, and name the test files.

### Whether `rename` stays is ambiguous - Severity: Major
* **Reviewer Lens:** `egm-style`, `egm-codebase-details`
* **Affected Scope:** line 162; `src/server/recordings.ts:85`, `tests/emulator/recordings.test.ts:50`
* **Discrepancy Description**: "`rename` becomes update(id, { name })" could mean it's removed or that it's kept as a wrapper. `recordings.ts` still calls it.
* **Rationale & Recommendation**: Say "`rename` stays as a wrapper over `update`".

### `posts.tidy` contradicts itself - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** lines 255, 364
* **Discrepancy Description**: It's "allowed only with `driveTidy`" and it clears `driveTidy`, yet a second run "changes nothing" rather than being refused.
* **Rationale & Recommendation**: When `driveTidy` is already clear, return `{ ok: true }` and change nothing.

### `thumbnail()` and `createImage` are underspecified - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** lines 166, 170, 246, 315; `drive.ts:90`, `graph.ts:132–133`
* **Discrepancy Description**: `FILE_FIELDS` doesn't gain `thumbnailLink`, and the fake's thumbnail endpoint has no path. `createImage` needs an `alt` parameter that isn't given.
* **Rationale & Recommendation**: Name the fields, the fake's path, and the new signatures.

### Migrating the existing tests isn't planned - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** line 348; `tests/emulator/posts.test.ts:15–301`, `tests/e2e/posts.spec.ts:102–168`
* **Discrepancy Description**: The existing tests import `signMediaUrl`, the `[id]` route and `publishPhoto`, including the token-renewal and 403-role coverage, and the e2e covers `NewPhotoPost`.
* **Rationale & Recommendation**: List which tests are rewritten and which are deleted, and move the token-renewal coverage onto `publish`.

### Posts page states when Instagram isn't connected aren't covered - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** lines 288–290; `posts/page.tsx:40–45`, `posts.spec.ts:73–100`
* **Discrepancy Description**: The current page branches on `meta.status`. The plan doesn't say what the tabs and the Post dialog do when Instagram isn't connected or needs signing in again.
* **Rationale & Recommendation**: Photos and drafts work without Instagram. **Post now** is disabled with the current connect or re-sign-in message.

### The inbox check, the "already in X" lookup and the upload route are underspecified - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** lines 213, 281–284; `upload/route.ts:26–27`, `posts.ts:20`
* **Discrepancy Description**:
  * How is "in the inbox" decided?
  * How is the post that already holds a photo found? Firestore can't query `media[].driveFileId`.
  * Upload hardcodes `mimeType: JPEG` and shares each file it uploads.
  * It's unclear whether `NO_POSTS_FOLDER` is replaced.
* **Rationale & Recommendation**:
  * Reuse the `posts.photos` folder walk for the inbox check.
  * A photo whose parent is a post folder is found through `posts` where `driveFolderId == parent`.
  * Upload sends the type inferred from the file extension and drops the per-file share, since Socials is already shared.
  * Replace `NO_POSTS_FOLDER`.

### Nits
* `JPEG_ONLY` and `JPEG` live in `commands/posts.ts` and `page.tsx`, not in the schema. Also update the stale `META_APP_SECRET` comments in `graph.ts:9` and `media.ts:1–4`. (codebase-details, style)
* "As `get` already does": `get` sends only `supportsAllDrives`. "Ownership fallback" was never defined, so drop it. "Merge the two copies": they differ in return type. (style)
* `signedUrl.ts` "replaces" `media.ts`, but `media.ts` is also "reduced to a call to" it; pick one. `exp` should be "the start of the current hour + 2 h". Say which id each scope signs. (style)
* The Commands intro promises each command lists its statuses; drop that line. "Safe to run twice": state what the second run does. (style)
* `createdAt` should be `createdTime`. Cite the 20-parent chunk limit or call it a conservative choice. `takenAt` from `createdTime` needs a time formatter, since `dateInBandZone` returns a date only. `dateInBandZone` takes a `Date`, not an ISO string. (style, codebase-details, implementation-readiness)
* Move "Only Make the draft creates a draft" to the top of `createDraft`. Define what counts as a hashtag, with the regex. (style, implementation-readiness)
* Unpublished Instagram containers expiring: cite it or drop it. "Exactly what gets posted" should be "the same crop". Name the memory setting. Name the fallback size if 2048 is too small. (style)
* Say which show statuses label a day (cancelled and dropped?). Trim **Decided** to the link plus anything said nowhere else. (style, codebase-details)
* HEIC files that Drive types as `application/octet-stream` are skipped by `mimeType contains 'image/'`. (codebase-details, implementation-readiness)
* Pin sharp to `0.35.5` (`node_modules/next/package.json:115`). (codebase-details)
* `modifiedTime` can be undefined, and the fake's `POST /files` doesn't set it. (codebase-details)
* The `YYYY-MM-DD - <title>` rename needs a clash rule. Use a transactional check-and-set for "refused while publishing". (codebase-details, implementation-readiness)
* Phase order: remove `NewPhotoPost` (phase 3) before `publishPhoto` (phase 5). (codebase-details)
* `useDragReorder` has no touch support, so the up/down buttons are the only way to reorder on phones; say so. (codebase-details)
* Say which `google.status` fields drive the `Status` rows in `shared.tsx`. Say how a drag maps to `focus`. Say whether the media route upscales crops under 1080 px. (implementation-readiness)
