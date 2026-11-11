# Goldfish Review Report: Stage 5, Initial Zoom Out

**Target:** `docs/designs/posts-carousels/design.md` (lines 1–147, full file)
**Standard:** `zoom-out-standard`
**GoldfishContext:** `docs/designs/posts-carousels/canvas/project/` (8 boards), the roadie codebase

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-zoom-out` | completed |
| `egm-inventive-catalyst` | completed |

Verdict from `egm-zoom-out`: passes with changes. Context and the root problem pass; there are no Blockers.

## Prioritized Findings (Blockers -> Major -> Nits)

### Draft and posted state is kept in three places - Severity: Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** "How a photo is marked" (lines 53–55); appProperties steps in lines 73, 77 and 82; the fake Drive (line 108)
* **Discrepancy Description**: A photo's state lives in its folder, in Drive `appProperties`, and in the `posts` doc, which line 55 calls the source of truth. The appProperties copy is an index added for speed before any speed problem has been shown.
* **Rationale & Recommendation**: Each copy is written by createDraft, removeFromDraft, deleteDraft, publish and tidy, and each write can fail on its own, so the copies drift. The index also needs a new `setAppProperties` method, a fake for it, and tests. Instead, work out the badges on the server: load the band's non-deleted draft and posted `posts` docs, build a set of their `media[].driveFileId`, and join it to the `files.list` results in `posts.photos`. Drop appProperties unless a measured need shows up.

### Two publish paths - Severity: Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** lines 79–85; `src/server/commands/posts.ts:51–80`
* **Discrepancy Description**: The new `posts.publish` handles "a draft of one photo or a carousel", yet `posts.publishPhoto` stays as a separate, JPEG-only path. Publish steps 1–2 describe only the CAROUSEL flow. Instagram needs at least 2 children for a carousel, so a one-photo draft needs a branch the doc never describes.
* **Rationale & Recommendation**: Two paths doing the same job will drift on HEIC handling, cropping and failure handling. Use one publish core with an explicit one-item branch (`createImage`, then publish). Make `publishPhoto` a thin wrapper over it, or retire it.

### The design extends the wrong `findOrMakeFolder` - Severity: Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** line 40; `src/server/commands/showPosters.ts:37`, `src/server/commands/releases.ts:359`
* **Discrepancy Description**: There are two copies of `findOrMakeFolder`. The design adds a role argument to the one in showPosters.ts, which returns a bare `DriveFile`. The private copy in releases.ts already returns `{ folder, made }`, which is what `posts.setupFolders` needs to report "found or made" (line 68).
* **Rationale & Recommendation**: Merge the two into one shared helper that returns `{ folder, made }` and takes an optional role (`DriveService.share` already accepts one). Use it for Shows, Releases and Posts, instead of giving one copy a third behaviour.

### Scope added beyond the canvas, against the doc's own rule - Severity: Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** line 9 ("add nothing they don't show") compared with `driveTidy` (line 65), the **Finish tidying Drive** button and `posts.tidy` (line 82), and the per-band thumb signing (line 89)
* **Discrepancy Description**: No board shows a "posted, but the Drive tidy failed" state or a Finish tidying button. The Post board only says that if Instagram turns the post down, nothing moves.
* **Rationale & Recommendation**: The recovery path may be justified, but it adds a field, a command, a UI state and tests that no board asks for. Either get sign-off and add it to the canvas, or make the tidy step idempotent, re-run it on the next `posts.publish` or `posts.photos` for any `posted` post whose folder is still in Drafts, and log the error instead of adding a schema field and a button.

### Canvas items with no place in the architecture - Severity: Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Pages and `posts.photos` (lines 69–71, 100–104), checked against the Main and Post boards
* **Discrepancy Description**: The Main board has "Search all of Drive" in the rail (`posts.photos` has no all-of-Drive folder and `q` is scoped to a folder), sort options "Newest added first" and "Oldest taken first" (the design sorts only newest taken first), and a per-day "Select all 23". The Post board shows "Instagram: 2 of 50 posts used today", and nothing says where that number comes from (for example Graph's `content_publishing_limit`, a call the design doesn't list).
* **Rationale & Recommendation**: The canvas is meant to be the spec, so anything left unmapped will be invented during implementation. Map each item to a command or field, or mark it as cut.

### The HEIC render path accepts a memory-versus-format trade-off it doesn't need - Severity: Major
* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** the media route (lines 92–97), with `DriveService.thumbnail` (line 50) and the editor preview (line 103)
* **Discrepancy Description**: Drive already renders HEIC thumbnails, and the editor preview uses them at `s=1080`. Yet the render route downloads each original and decodes it with a new `heic-decode` dependency, because sharp's prebuilt libvips can't decode HEVC. That forces a choice between raising App Hosting memory to 1024 MiB and relying on photos being rendered one at a time. The published image can also differ from the preview the user approved.
* **Rationale & Recommendation**: Let Drive decode the HEIC. Fetch `thumbnailLink` at a size large enough for the crop (for example `=s2048`) and use sharp only to crop around `focus`, resize and encode sRGB JPEG. This removes `heic-decode` and the memory bump, and the preview and the post come from the same source. Keep the original-download path as a fallback when there is no thumbnail. Remaining risks: Drive's maximum thumbnail size, a second lossy JPEG pass, Drive's colour handling and EXIF rotation, one extra `files.get` per request (thumbnail links are short-lived), and the HEIC fixture test would only cover the fallback.

### Signed thumb URLs defeat the browser cache - Severity: Major
* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** the thumb route (lines 88–91), `posts.photos` (line 69), `src/server/meta/media.ts:13`
* **Discrepancy Description**: `signMediaUrl` sets `exp = now + TTL`, so every `posts.photos` call gives every photo a new URL, and `cache-control: private, max-age=3600` never hits on a reload, folder switch or new page. Every grid load costs two Drive calls per thumbnail, for up to 2,000 photos per view.
* **Rationale & Recommendation**: Round `exp` to a fixed window (for example the end of the next whole hour), so a photo keeps the same URL within the window. Add the file's `modifiedTime` or version to the signed body, so the URL changes only when the photo does. Trade-off: a leaked link works for 1–2 hours instead of exactly 1.

### Too many `files.update` wrappers - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** lines 45–49; `src/server/integrations/drive.ts:39`
* **Discrepancy Description**: `rename` is already a `files.update` PATCH; `move` and `setAppProperties` would be two more.
* **Rationale & Recommendation**: Use one `update(id, { name?, addParents?, removeParents?, appProperties? })`, matching the single fake `PATCH /files/:id` the design already plans.

### The memory setting is left as either-or - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** line 97
* **Discrepancy Description**: "Set `memoryMiB: 1024`, or render the photos one at a time" is two options with no choice made. Meta fetches the carousel items while their containers are created (line 80), so decodes can run at the same time.
* **Rationale & Recommendation**: Pick one, most likely `memoryMiB: 1024`, and say so. (This goes away if the inventive-catalyst finding on thumbnail rendering is taken.)

### Some passages drop to API-call level - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** lines 50–51, 70, 80–81, 93–95
* **Discrepancy Description**: `=s{size}`, field lists, the chunked `in parents` query, Graph parameter names, and the decoder choice and JPEG quality are written as recipes in the design.
* **Rationale & Recommendation**: Keep the limits (sharp can't decode HEIC; the 2,000 cap) and move the API recipes to implementation notes, so the Architecture section reads as components and data flow.

### The media route's signature changes - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** line 92; `src/app/api/posts/media/[id]/route.ts`, `src/server/meta/media.ts:12`
* **Discrepancy Description**: The route moves from `/media/{id}` (which serves `media[0]`) to `/{postId}/{index}`, and `signMediaUrl` only signs the post id, so the index must be signed too.
* **Rationale & Recommendation**: Say that one generalised signer covers both media and thumb URLs, with a scope prefix (`media.`, `thumb.`), rather than two schemes.

### Draft create, remove and delete have no repair path - Severity: Nit
* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** `posts.createDraft` (lines 72–74), compared with `posts.publish` step 3 and `posts.tidy` (line 82)
* **Discrepancy Description**: `createDraft` relies on undoing its own steps within the request. If the undo fails, or the server instance dies mid-request, photos can end up in `Drafts/<name>` with no doc, or a doc can point at photos that never moved, and nothing repairs it. Publish protects its own Drive work with `driveTidy` and a re-runnable `posts.tidy`; create, remove and delete don't.
* **Rationale & Recommendation**: Write the doc first, record each step's result on it (`from`, `moved`, `shortcutId`), make each step idempotent, and use one "bring Drive in line with the doc" command per draft for create, remove and delete, also offered as a retry button. Risk: if that command's idea of "in line" is wrong, it repeats the wrong move.

### Hard cap of 2,000 photos and a full rescan on every view - Severity: Nit
* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** `posts.photos` (lines 69–71)
* **Discrepancy Description**: Drive can't sort by `imageMediaMetadata.time`, so every folder change and page rescans the nested Ideas folders and keeps at most 2,000 photos.
* **Rationale & Recommendation**: Possibly not needed until the Drive 1 audit (#54) shows real volumes. If it is, cache the sorted listing per artist and folder, keyed by Drive's changes token or newest `modifiedTime`. This conflicts with "Roadie keeps nothing outside Drive" unless the cache is in memory only.

## Not flagged
* The My Drive ownership fallback to a shortcut (line 35) is a Drive limit with a named way out (a Shared Drive).
* Rendering on each request so nothing is stored outside Drive is a principle (#53), not a false compromise.
* `src/lib/autosave.ts` and `src/lib/drag-reorder.ts` exist and are correctly reused, and generalising `signMediaUrl` for thumbnails is justified, since an `<img>` can't send a bearer token.
