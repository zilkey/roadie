# Goldfish Review Report: Stage 9, Implementation Readiness

**Target:** `docs/designs/posts-carousels/design.md` (DetailedRange, lines 37–147)
**Standard:** `implementation-readiness-standard` (implementation-readiness, codebase-details); the style persona's own rules
**GoldfishContext:** the roadie codebase, `canvas/project/`

## Reviewer Status

| Reviewer | Status | Verdict |
| --- | --- | --- |
| `egm-implementation-readiness` | completed | not ready: 1 🔴 · 14 🟡 · 6 🟢 |
| `egm-codebase-details` | completed | NOT READY: 3 🔴 · 12 🟡 · 4 🟢 |
| `egm-style` | completed | no blockers: 0 🔴 · 6 🟡 · 7 🟢 |

Deduplicated below: 3 🔴 · 17 🟡 · 10 🟢.

## Prioritized Findings (Blockers -> Major -> Nits)

### The thumb route can't verify its signature or choose a Drive account - Severity: Blocker
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** lines 88–91, 139; `src/server/meta/media.ts:10–21`, `src/app/api/posts/media/[id]/route.ts:21–22`, `src/server/meta/graph.ts:46–56`
* **Discrepancy Description**: The HMAC covers "artist, file and expiry", but `/api/posts/thumb/{fileId}?s=&exp=&sig=` carries no artist and there's no post doc to look one up from. The server can't rebuild the MAC or pick which band's Drive token to use, so the "another band's file" test can't be written. Generalising `signMediaUrl` also inherits `hmac()`, which throws `meta_not_configured` without `META_APP_SECRET`, so the Photos grid would fail on any server without Meta set up.
* **Rationale & Recommendation**: Give the exact URL shape (for example `?a=<artistId>&s=&exp=&sig=`), say whether `s` is signed, name the secret (preferably not the Meta one), and give the new signer's signature.

### The plan claims MCP and Roadie access to posts commands that the code denies - Severity: Blocker
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** lines 67, 85; `src/server/commands/posts.ts:52`, `src/server/assistant/policy.ts:17, 92, 97`, `src/server/dispatch.ts:65`
* **Discrepancy Description**: `posts.publishPhoto` has `roles: ["admin"]` (no `mcp`), and `policy.ts` excludes every `posts.` command from Roadie until #19. Making line 67 true needs `mcp` roles, a narrower exclusion, `ALWAYS_CONFIRM` for publish and delete, `READ_ONLY` for `posts.photos`, and a decision about `BULK_LIMIT = 5` given drafts of up to 10 photos.
* **Rationale & Recommendation**: Name each `policy.ts` change, or drop the claim.

### `posts.updateDraft`'s input doesn't fit `useAutosave` - Severity: Blocker
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** line 76; `src/lib/autosave.ts:18, 94, 130`
* **Discrepancy Description**: The hook always sends `{ id, patch }` with `baseRev`, so a flat `{ id, title?, caption?, … }` input fails zod parsing on every save. The plan also doesn't say how `items` (an array) merges, whether `baseRev` conflicts are honoured, or whether every debounced title keystroke renames the Drive folder.
* **Rationale & Recommendation**: Define the input as `{ id, patch: {...} }`, say how `items` and `order` are patched, and rename the folder only on blur or Done.

### No phases or complete file list - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** lines 37–147
* **Discrepancy Description**: The plan is one flat list. Files it changes but never names: `src/schema/artists.ts`, `src/server/meta/graph.ts` (carousel calls), `src/server/commands/google.ts` (status rows), `src/components/google/FolderCard.tsx` and `shared.tsx`, `src/server/assistant/policy.ts`, `package.json`, the media route move, and the tests that will break (`tests/emulator/posts.test.ts`, `tests/e2e/posts.spec.ts`).
* **Rationale & Recommendation**: Split the work into phases, each with its own test gate: schema, Drive service and fakes; folder setup and Settings; photos, thumb route and the Photos page; draft commands and the editor; render route, publish and tidy. List every file to create, modify or delete.

### The `media[]` schema and `publishPhoto` are left inconsistent - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** lines 63, 85, 92; `src/schema/posts.ts:13–15`, `src/server/commands/posts.ts:60–65`
* **Discrepancy Description**: The new fields aren't marked required or optional. The #49 docs and `publishPhoto` lack them. `caption` is required but `createDraft` takes none. Nothing says what aspect and focus a post renders at when they're missing, whether `publishPhoto` stays JPEG-only, or whether the old route is deleted (Next can't have `[id]` beside `[postId]/[index]`). Its signer is also used in tests.
* **Rationale & Recommendation**: Mark each field required or optional, set defaults (aspect 4:5, focus at the centre, caption ""), and say what happens to the old route and to `publishPhoto`.

### `DriveService` contracts are missing - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** lines 45–51, 70; `src/server/integrations/drive.ts:12–29, 90, 146–149`, `fakes/fake-drive/server.ts:171–174`
* **Discrepancy Description**: `search` takes a single parent, matches names only and requires an exact mimeType, with no paging and no image fields. The plan needs `(a in parents or …) and mimeType contains 'image/'`, page tokens, and `imageMediaMetadata`, `appProperties` and `shortcutDetails`. The return types of `move`, `shortcut`, `trash` and `thumbnail` aren't given. Which Drive error counts as "refused because of ownership" isn't given either, and that is what decides between a shortcut and a rollback. The field is `createdAt` in Roadie, not `createdTime`.
* **Rationale & Recommendation**: Write out the TypeScript signatures for both the real and the fake service, state the refused-move detection rule, and give the output type of every command.

### Folder setup and sharing are undefined - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** line 40; `src/server/commands/showPosters.ts:37–43`, `releases.ts:359–365`, `google.ts:321–331`
* **Discrepancy Description**: `findOrMakeFolder` shares only when it creates a folder, so an existing Ideas folder never gets writer access, and it can't report found-or-made. "Drafts and Posted get the Posts folder's sharing" could mean inherit, share as reader, or copy permissions. Nothing says what happens to `postsFolders` when Settings › Change points somewhere else, which `google.status` fields drive the Settings rows, or what happens to bandmates added after setup.
* **Rationale & Recommendation**: Merge the two `findOrMakeFolder` copies into one that returns `{ folder, made }`, takes a role, and shares found folders as well. Then specify each case above.

### The preview crop and the rendered crop disagree - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** lines 63, 93–94, 103
* **Discrepancy Description**: CSS `object-position: x%` and "crop centred on focus" give the same result only at 0, 0.5 and 1, so Instagram won't get what the editor shows. libheif already applies the image's rotation while decoding, so rotating by EXIF again risks a double rotation. `imageMediaMetadata` width and height are reported before rotation.
* **Rationale & Recommendation**: Use one formula on client and server, for example `left = fx·(W − cw)`. Say whether `focus` is measured before or after rotation, how each decoder handles orientation, and whether the stored dimensions are swapped for 90° and 270° photos.

### Publish failure, retry and status transitions are undefined - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** lines 80–82; the Post board
* **Discrepancy Description**: Nothing says whether a `failed` draft can be edited and published again, whether the draft commands refuse `publishing` or `posted` docs, whether a second publish is blocked, or what happens to item containers already made. "Same as `publishPhoto`" doesn't carry over, because a draft doc already exists. The `alt_text` fallback has no rule for detecting a refusal, no retry rule, and no fake behaviour.
* **Rationale & Recommendation**: Define each command's allowed status transitions. Check whether Graph accepts `alt_text` on carousel items, then state the behaviour.

### Day groups can't name past shows - Severity: Major
* **Reviewer Lens:** `egm-style`, `egm-codebase-details` (also noted by implementation-readiness)
* **Affected Scope:** line 102; `src/lib/calendarData.ts:39, 49`
* **Discrepancy Description**: `useCalendarItems` drops shows and rehearsals before today, and photos are from the past, so no show would be named, which breaks "Done when" line 130. The Posts page doesn't load shows. EXIF time has no timezone.
* **Rationale & Recommendation**: Join on the `shows` and `rehearsals` collections, unfiltered, and use the band's timezone (`dateInBandZone`).

### "The newest 2,000" isn't the newest - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** line 71
* **Discrepancy Description**: Drive can't sort by taken time, so the 2,000 photos kept are the first 2,000 Drive returns, not the newest.
* **Rationale & Recommendation**: Say what Drive orders by before the cap (for example `createdTime desc`), and word the message to match.

### `posts.photos` can't serve the Photos board - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** lines 69–71, 101; the Main board
* **Discrepancy Description**: There's no sort input, no all-of-Drive folder, no "Loose in Ideas" grouping, and no source-folder label. `mimeType contains 'image/'` drops shortcuts, so the Drafts counts would be wrong.
* **Rationale & Recommendation**: Add the inputs, or cut the controls (see stage 8). Say how shortcuts are resolved when listing Drafts.

### The Posts tab and the draft list are unspecified - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** line 100; `posts/page.tsx:29–155`, `components/music/common.tsx:43–44`
* **Discrepancy Description**: Nothing says whether `NewPhotoPost` stays, how drafts are listed, how `PostList` renders a carousel (it uses `media[0]` and `drive.google.com/thumbnail`, which line 91 rules out), where "Or add to a draft" gets its list, or how the editor's Add photos carries the draft id back to Photos.
* **Rationale & Recommendation**: Specify each of these.

### The fakes can't support the tests - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** lines 107–113, 137–142; `fakes/fake-drive/server.ts:73–74, 198–204`, `fakes/fake-meta/server.ts:75`
* **Discrepancy Description**: The fake Drive serves only text, a 1×1 JPEG or audio. It has no seeded Ideas, Drafts or Posted folders, no show-folder poster, no stored `shortcutDetails` and no trash filtering. The fake Meta rejects anything without `image_url` and has no `media_type`, `children`, item limit, `alt_text` handling, or failure flag for one item.
* **Rationale & Recommendation**: List each change to the fakes, the seed data, and the scenario flags.

### Upload accepting HEIC is underspecified - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** line 42; `upload/route.ts:23`, `posts/page.tsx:94–97`, `posts.ts:20`
* **Discrepancy Description**: Browsers often send an empty MIME type for `.heic`. The page's input accepts only `image/jpeg`. The error text shown when Ideas is missing isn't given.
* **Rationale & Recommendation**: Check by file extension as well as MIME type, update `accept`, and give the new error text.

### The memory setting and `heic-decode` are undecided - Severity: Major
* **Reviewer Lens:** all three (also stages 5–8)
* **Affected Scope:** lines 93, 97; `apphosting.yaml`, `package.json`
* **Discrepancy Description**: Line 97 is an either/or, and `heic-decode` isn't installed.
* **Rationale & Recommendation**: Decide, and pin the version (see stage 8, "thumbnail rendering means dropping the HEIC fallback").

### Claims that overreach - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** lines 50, 80, 96, 100
* **Discrepancy Description**: "Roadie keeps nothing outside Drive" isn't true, because the `posts` doc holds titles, captions and alt text. "Drive renders HEIC thumbnails" and "`alt_text` when the Graph API takes it" are unverified. "Two tabs, **Posts · Photos**" reads as a single label.
* **Rationale & Recommendation**: Say "no image bytes outside Drive", cite or add a check for each external claim, and write "two tabs: **Posts** and **Photos**".

### Rollback in `createDraft` is incomplete - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** lines 74–75
* **Discrepancy Description**: The undo steps leave out the draft folder, shortcuts and appProperties it created, and don't say whether the doc delete is hard or soft. Nothing says `addToDraft` shares the same pipeline.
* **Rationale & Recommendation**: List every rollback step, and have `addToDraft` reuse `createDraft`'s pipeline.

### Nits
* The numbering format is `01 <original name>`; shortcuts are numbered too; dates use the band's timezone. (`egm-implementation-readiness`)
* Does the " (2)" clash rule also apply when `updateDraft` renames, and what does a third clash get? How do `order` and `items` combine? (`egm-implementation-readiness`, `egm-style`)
* Is the 30-hashtag limit checked on the server? (`egm-implementation-readiness`)
* Name the default role `findOrMakeFolder` keeps for existing callers (reader). (`egm-implementation-readiness`)
* The "unit tests" need the emulator and the fakes, so put them in `tests/emulator/posts.test.ts`. (`egm-codebase-details`)
* Reuse the existing `rename` and extend the fake's PATCH rather than replacing it. (`egm-codebase-details`)
* Say whether `setupFolders` works when `postsFolderId` is unset. (`egm-codebase-details`)
* Wording: line 74's "explicit create press" becomes "Only **Make the draft** creates a draft"; line 83's "adds itself" becomes "Stage 2 adds Facebook to…"; line 76's "the Saved tick" belongs to the canvas, not to `autosave.ts`; give the chunk size behind "in chunks"; replace "safe to run twice" with "idempotent". (`egm-style`)
* Redundancy: the type list repeats on lines 42 and 72, so use one constant. "(settings, not env vars)" has no clear purpose. Say whether `trash` enforces its rule or relies on callers. (`egm-style`)
* Line 137's "an item container that fails" gives no expected result; state it ("post `failed`, Drive untouched"). (`egm-style`)

## Verified as accurate
`findOrMakeFolder` in showPosters.ts, `postsMonthFolder`, `publishPhoto`, `signMediaUrl` in media.ts, `autosave.ts`, `drag-reorder.ts`, `src/schema/posts.ts`, both fakes, and `tests/fixtures` all exist. `sharp` is only a transitive dependency. The posts rules are admin-read only. `share()` already takes a role.
