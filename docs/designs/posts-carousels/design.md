# Social media asset organization

Source: zilkey/roadie-issues#75. Part of zilkey/roadie-issues#19 (Posts). This is that issue's **Stage 6 · Carousels**, plus a Drive layout that keeps itself tidy. Fits under zilkey/roadie-issues#53's **Content** slot.

### The ask
Drive is a cesspool of assets. We upload to a folder like "Jeff's phone spring 26", post some things, and never mark what we posted. Suggest a Drive layout that's really easy to dump things in, and really easy for Roadie to organize and view. Then: a photo browser on Drive with multi-select and an **Add to carousel draft** button that moves the photos in Drive and stores the draft; editing the carousel (reorder, text); and posting it. All of it under Posts.

### Design
**Canvas:** [Posts: photos from Drive](https://claude.ai/artifact/WmxZWS9psxqNqauFRniMNW). Build from these boards and add nothing they don't show. Ask first if something seems missing.
1. **Dump it in Drive.** *Drive layout* (the folders and what happens at each step) and *Settings › Google · Posts folder* (Set up Drafts and Posted).
2. **Pick photos.** *Posts › Photos* (folder rail, photos grouped by the day they were taken with that day's show or rehearsal named, "Not in a post yet", numbered multi-select, a sticky **Add to carousel draft** bar), *Add to carousel draft* (new draft by name, or add to an existing one; says what moves in Drive), and *Phone · Photos*.
3. **Edit the carousel.** Preview with the crop frame, photos in a list (drag, or the up/down buttons), alt text per photo, 4:5 or Square for the whole carousel, × to take a photo out, Add photos, caption with counts. Autosaved, with Done; rename is the pencil on the title.
4. **Post it.** *Post it* (accounts, checks that warn about blank alt text, Now or Pick a time, what happens in Drive, an explicit **Post now**) and *After posting* (links per platform, the folder in Posted with its numbered photos).

The older [Roadie Posts](https://claude.ai/artifact/RBsrzxbwZiDisHXSuMgYXk) canvas is still the reference for the rest of Posts. Where they overlap (its Carousel and Add media boards), this canvas wins for picking, drafting, editing and posting a carousel.

### The Drive layout
```
Posts                         the Posts folder (Settings › Google; Drive 2's Content slot)
├── Ideas                     everyone in the band can add. Dump here, any folder names, loose files fine
│   ├── Jeff's phone spring 26/
│   └── IMG_4410.HEIC
├── Drafts                    Roadie keeps this: one folder per draft, named after the draft
│   └── Hi-Dive announcement/
└── Posted                    Roadie keeps this: a folder per month
    └── 2026-11/
        └── 2026-11-10 Hi-Dive announcement/   01 …, 02 …, numbered in carousel order
```
- **Where a photo sits says where it is in its life.** In Ideas: unused. In Drafts: in a draft. In Posted: went out. Nobody renames or tags anything by hand.
- **Add to carousel draft** makes `Drafts/<name>` and **moves** the photos from Ideas into it.
- **A photo from outside Posts** (a show folder, a poster) isn't moved: the draft folder gets a **Drive shortcut** to it.
- **Taking a photo out** of a draft moves it back where it came from (or removes the shortcut). **Delete draft** puts every photo back and sends the empty folder to Drive's trash.
- **When the post goes out**, Roadie numbers the files `01 …` in carousel order, renames the folder `YYYY-MM-DD <name>` (the day it posted) and moves it to `Posted/YYYY-MM`. If the post fails, nothing moves.
- **Roadie never deletes a photo.** It only removes shortcuts and empty folders it made itself (zilkey/roadie-issues#53's principle).
- **Drive ownership:** in a My Drive, Drive can refuse to move a file the band account doesn't own (Dean's phone upload into Ingrid's Ideas). Then Roadie leaves it in Ideas, gives the draft a shortcut, and says so: "2 photos are Dean's in Drive, so they stay in Ideas and the draft links to them." The Drive 1 audit (zilkey/roadie-issues#54) says how often that will happen; a Shared Drive makes it go away.

### Architecture

**Settings and folders**
- New `artists.postsFolders: { ideasId, draftsId, postedId }`, set only by `posts.setupFolders`. It finds folders with those names under `postsFolderId` first and makes the missing ones. It shares Ideas with every bandmate as **writer** (so phones can dump into it); Drafts and Posted get the Posts folder's sharing. `findOrMakeFolder` (`src/server/commands/showPosters.ts`) gets a role argument.
- Settings › Google's Posts folder card becomes the table on the Settings board. Until Ideas exists, Upload and Add to carousel draft are off with "Set up the Posts folder in Settings › Google" (settings, not env vars).
- `/api/posts/upload` saves into **Ideas** (no month folder) and takes JPEG, HEIC/HEIF, PNG and WebP. `postsMonthFolder` goes away. The month folders #49 already made are left alone.
- When Drive 2 (zilkey/roadie-issues#55) lands, these three become fixed sub-slots of the Posts folder in `driveLayout`. Nothing else changes.

**`DriveService` additions** (`src/server/integrations/drive.ts`, the real one and the fake):
- `move(id, { to, from })`: `files.update` with `addParents` / `removeParents`.
- `shortcut(targetId, parentId, name)`: a file with mimeType `application/vnd.google-apps.shortcut` and `shortcutDetails.targetId`.
- `trash(id)`: only ever for a shortcut or an empty folder Roadie made.
- `setAppProperties(id, props)`: `files.update` `appProperties`.
- `thumbnail(id, size)`: `files.get` `thumbnailLink`, fetched at `=s{size}` with the band token. Drive renders HEIC thumbnails, so the grid needs no conversion.
- `search` grows `pageToken`/paging and the fields `imageMediaMetadata(width,height,time,rotation)`, `appProperties`, `shortcutDetails`, `size`.

**How a photo is marked**
- Drive `appProperties` on the photo itself (a shortcut's target, not the shortcut): `roadiePost` (the post id), `roadiePostStatus` (`draft` | `posted`), `roadiePostedOn` (`YYYY-MM-DD`). Only Roadie's OAuth client can see them, and they come back on `files.list`, so the grid gets every badge in the same call that lists the photos.
- The `posts` doc is the source of truth. appProperties are the index Drive carries with the file.

**Data: `posts` grows** (`src/schema/posts.ts`; rules unchanged: admins read, the server writes)
- `status`: `draft | publishing | posted | failed` (Stage 3 adds `scheduled`).
- `kind`: `photo | carousel`. No `kind` means `photo` (the posts from #49).
- `title`: the draft's name, which is also the folder name. A clash in Drafts gets " (2)".
- `aspect`: `4:5 | 1:1`.
- `driveFolderId`: the draft's folder, then the Posted one.
- `media[]` (1–10, in carousel order), each: `driveFileId`, `mimeType`, `name`, `url`, `width`, `height`, `alt` (optional), `focus` (`{ x, y }` from 0 to 1: where the crop centres; the crop always fills the shape), `from: { folderId, moved }` (where it goes back to), `shortcutId` (optional).
- `postedAt`.
- `driveTidy` (optional): `{ error }` when the post went out but the Drive move didn't (see publish).

**Commands** (`src/server/commands/posts.ts`; admins; all of them work from Roadie and MCP, with help text)
- `posts.setupFolders {}` returns each folder and whether it was found or made.
- `posts.photos { folder: "ideas" | "drafts" | "posted" | "shows" | { id }, q?, notInPost?, pageToken? }` returns the subfolders with their counts, plus photos (`driveFileId`, `name`, `mimeType`, `width`, `height`, `takenAt` = `imageMediaMetadata.time`, else `createdTime`, the folder, a signed `thumb` URL, and `post?` from appProperties).
  - Ideas is walked to any depth: list its folders, then query `(a in parents or b in parents …) and mimeType contains 'image/'` in chunks.
  - Sorting by taken time happens on the server, which reads at most 2,000 photos per view ("Showing the newest 2,000").
- `posts.createDraft { title, driveFileIds (1–10) }`. Photos only (JPEG, HEIC/HEIF, PNG, WebP); a photo already in a draft is refused by name ("IMG_4410 is in Thanks, Denver").
  - Steps: write the doc (`status: draft`), make the folder, move each photo or make its shortcut, set appProperties, save the folder and shortcut ids.
  - If a step fails halfway, it undoes the moves it made and deletes the doc. "Make the draft" is the explicit create press: nothing autosaves a draft into being.
- `posts.addToDraft { id, driveFileIds }` adds photos to the end, 10 at most.
- `posts.updateDraft { id, title?, caption?, aspect?, order?, items?: [{ driveFileId, alt?, focus? }] }`. This is the editor's autosave (`src/lib/autosave.ts`, the Saved tick). A new title renames the folder. `order` is the whole list of ids.
- `posts.removeFromDraft { id, driveFileId }` moves the photo back to `from.folderId` (Ideas if that folder is gone), or removes the shortcut, and clears its appProperties.
- `posts.deleteDraft { id }` does that for every photo, trashes the empty folder, and soft-deletes the doc.
- `posts.publish { id }`, for a draft of one photo or a carousel:
  1. Each photo gets a carousel item container (`image_url` = its signed render URL, `is_carousel_item=true`, plus `alt_text` when the Graph API takes it; if it refuses, the post goes without and the result says so). Poll each one until it is `FINISHED`.
  2. A `CAROUSEL` container with `children` and the caption; poll it, `media_publish`, then `permalink`. Same failure handling as `publishPhoto`.
  3. Then tidy Drive: number the files, move the folder to `Posted/YYYY-MM` (made if needed), rename it, set `roadiePostStatus=posted`. A tidy failure leaves the post `posted` with `driveTidy.error` and a **Finish tidying Drive** button (`posts.tidy { id }`, safe to run twice).
  4. Instagram only. Facebook is Stage 2's work (unpublished photos, then a feed post with `attached_media`), and it adds itself to this command and the Post dialog then.
  5. **Pick a time** appears only once Stage 3 (scheduling) has shipped. Until then it's **Now** only.
- `posts.publishPhoto` stays for "post this photo now" from Roadie and MCP.

**Routes**
- `GET /api/posts/thumb/{fileId}?s=&exp=&sig=` streams `drive.thumbnail`.
  - The `thumb` URLs that `posts.photos` returns are signed (an HMAC over artist, file and expiry, valid 1 hour; generalise `signMediaUrl` in `src/server/meta/media.ts`). An `<img>` can't send the bearer token.
  - `cache-control: private, max-age=3600`.
  - Not `drive.google.com/thumbnail`: that only works when the viewer's browser is signed in to a Google account that can open the file.
- `GET /api/posts/media/{postId}/{index}?exp=&sig=` (the #49 route, per photo) renders what Meta fetches:
  1. Download the original and decode it (HEIC/HEIF with `heic-decode`, since sharp's prebuilt libvips doesn't decode HEVC HEIC; everything else with `sharp`).
  2. Rotate by EXIF, crop to the shape around `focus`, resize to 1080 × 1350 (4:5) or 1080 × 1080.
  3. sRGB JPEG, quality 90.

  It's made on each request and never stored, so Roadie keeps nothing outside Drive. Add `sharp` as a direct dependency (it's only there through `next` today). A 12 MP HEIC decodes to about 50 MB, and App Hosting's default is 512 MiB: set `runConfig.memoryMiB: 1024` in `apphosting.yaml`, or render the photos one at a time (they are anyway, as Meta fetches them).

**Pages**
- Posts gets two tabs, **Posts · Photos**. Photos is `/artists/[slug]/posts/photos`. Drafts open at `/artists/[slug]/posts/[id]`, and so do posts that went out.
- Photos: the folder rail, the day groups, and the selection. The selection is an ordered array: tap order is carousel order, shift-click picks a range, Space toggles. Upload goes into Ideas.
  - Day groups name that day's show or rehearsal by joining `takenAt`'s date with the calendar the client already loads. No new field.
- Editor: reorder with `src/lib/drag-reorder.ts`, plus the up/down buttons. The preview uses the thumbnail at `s=1080` with CSS `object-position` from `focus`; dragging the photo sets `focus`.
- On a phone it's the same pages: three across, and a bottom bar while photos are picked.

**Fakes and tests**
- `fakes/fake-drive`:
  - `PATCH /files/:id` with `addParents`, `removeParents`, `name` and `appProperties`
  - shortcuts, trash
  - `imageMediaMetadata` on seeded photos
  - a thumbnail endpoint (a small generated PNG)
  - refusing to move a file owned by someone else, behind a seed flag
- `fakes/fake-meta`: carousel item containers, `CAROUSEL` with `children`, status polling, and the item limit.
- A small HEIC fixture in `tests/fixtures` for the render test.

### Not in this story
- Facebook (Stage 2), video in carousels (Stage 7), Reels, Stories, TikTok, YouTube.
- Text drawn on a photo: decided against, the caption and alt text are the text.
- Members using Posts. Posts stays admins-only; members only dump into Ideas from Drive.
- Moving photos that are already scattered around Drive into Ideas. That's Drive 3 (zilkey/roadie-issues#56), from Drive 1's list.

### Decided
All of these are Jeff's, from Nov 11. No open questions are left.
- **Text is the caption and alt text per photo, nothing more.** No text drawn on photos.
- **The folders are Ideas, Drafts and Posted.** The dump folder is "Ideas", not "Inbox".
- **Posted has a folder per month** (`Posted/2026-11/…`).
- **Facebook waits** for Stage 2 of zilkey/roadie-issues#19. This story posts to Instagram only.

### Done when
- On prod: Settings › Google sets up Drafts and Posted. Jeff drops a phone folder of HEIC photos into Posts › Ideas from the Drive app on his phone, and it shows in Posts › Photos under its day, with the show named.
- He picks 4 photos and a poster from a show folder, presses Add to carousel draft, and Drive shows `Drafts/<name>` with the 4 photos moved and a shortcut to the poster.
- He reorders them, writes a caption, and adds alt text on one photo, all autosaved. Post now puts the carousel on Instagram in his order, cropped 4:5. Drive shows `Posted/YYYY-MM/YYYY-MM-DD <name>` with `01`–`05`, and the 4 photos no longer show under "Not in a post yet". (Delete the post in the Instagram app afterward.)
- Taking a photo out of a draft puts it back in its folder. Deleting a draft puts them all back and trashes the empty folder.
- Unit tests:
  - `createDraft`: moved vs shortcut, a move Drive refuses falls back to a shortcut, a photo already in a draft is refused, a failure halfway undoes its moves
  - `removeFromDraft` and `deleteDraft` restore where each photo came from
  - `publish`: the carousel call order, an item container that fails, Drive tidy (numbering, month folder made once, rename), a tidy failure leaves the post `posted` with `driveTidy`, `posts.tidy` run twice
  - the render route: a HEIC fixture comes out as a 1080 × 1350 JPEG, `focus` moves the crop
  - signed thumb URLs: expired, wrong signature, another band's file
  - `posts.photos`: walks nested Ideas folders, badges come from appProperties, sorted by taken time
- E2E (Graph stubbed):
  - pick 5 → Make the draft → reorder → caption autosaves → Post now → the fake Drive's Posted folder holds `01`–`05`
  - delete a draft and Ideas has its photos back
  - Upload lands in Ideas
  - Add to carousel draft is off until the folders are set up
  - members don't see Posts
- `npm run typecheck` is clean.
