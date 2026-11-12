# Social media photos and carousel posts

Source: [zilkey/roadie-issues#75](https://github.com/zilkey/roadie-issues/issues/75), part of [#19 (Posts)](https://github.com/zilkey/roadie-issues/issues/19) Stage 6. Rewritten on Nov 12 from the EGM review and the decisions recorded in [the decision log on #75](https://github.com/zilkey/roadie-issues/issues/75#issuecomment-6802964109). Reports: [consolidated_review_report.md](consolidated_review_report.md).

## Feature spec

### Problem

> Drive is a cesspool of assets. We upload to a folder like "Jeff's phone spring 26", post some things, and never mark what we posted. Suggest a Drive layout that's really easy to dump things in, and really easy for Roadie to organize and view. Then: a photo browser on Drive with multi-select and an **Add to carousel draft** button that moves the photos in Drive and stores the draft; editing the carousel (reorder, text); and posting it. All of it under Posts.
>
> (the ask on #75)

### What this story delivers
- **Dumping is easy.** One Drive folder, Socials, where anyone in the band puts photos, loose or in folders named however they like. Nobody renames or tags anything.
- **You can always tell what was used.** Any photo still in the inbox hasn't been used in a post. A post's photos sit together in one folder named after the post.
- **One flow in Roadie** for a post: pick photos, make a draft, edit it (order, crop, alt text, caption), and post it to Instagram as one photo or a carousel.
- Success is measured by [Done when](#done-when).

### Glossary
- **Socials folder**: the Drive folder chosen in Settings › Google (stored as `artists.postsFolderId`; the UI used to call it "Posts folder"). It lives in the band's Shared Drive.
- **Inbox**: the Socials folder and every folder under it except `Posts/`.
- **Post folder**: one folder per post, inside `Socials/Posts/`.
- **Stage N**: a stage of the Posts plan in #19. Stage 2 is Facebook, Stage 3 is scheduling, and Stage 7 is video.
- **Drive 1 / 2 / 3**: the Drive issues #54 (audit), #55 (folder layout in Settings) and #56 (moving what's already in Drive).

### Drive layout
```text
Socials/                                    the Socials folder; anyone in the band adds here
├── Jeff's phone spring 26/                 subfolders are fine; Roadie looks through every folder except Posts/
│   └── IMG_2201.HEIC
├── IMG_4413.HEIC                           anything in the inbox hasn't been used yet
└── Posts/                                  Roadie keeps this folder: one folder per post
    ├── DRAFT - Hi-Dive announcement/       a draft
    │   ├── IMG_4410.HEIC
    │   └── IMG_4412.HEIC
    └── 2026-11-03 - Thanks, Denver/        posted on Nov 3
        ├── IMG_4300.HEIC
        └── IMG_4301.HEIC
```
- **Make the draft** creates `Posts/DRAFT - <name>` and moves the chosen photos into it. Renaming the draft renames the folder.
- **When the post goes out**, Roadie renames the folder to `YYYY-MM-DD - <name>`, using the date it posted in the band's timezone. Files keep their names. The carousel order is kept only in Roadie.
- **If the post fails**, nothing in Drive changes.
- **Taking a photo out of a draft** moves it back to the folder it came from, or to the Socials root if that folder is gone.
- **Delete draft** puts every photo back. It then trashes the draft's folder if the folder is empty. If someone has added a file to it in Drive, Roadie leaves the folder and says so.
- **Only the inbox can be picked from.** A photo already in a post folder can't go into another post (reposting is not in this story). A photo from elsewhere in Drive has to be moved into Socials in Drive first.
- **Roadie is the source of truth; the folders follow it.** A post's status (draft, publishing, posted, failed) is stored only in Roadie. Roadie writes nothing to Drive except moving photos and making, renaming and trashing post folders.
- **Roadie never deletes a photo.** The only thing it trashes is an empty post folder it made.

### User flow
The canvas [Posts: photos from Drive](https://claude.ai/artifact/WmxZWS9psxqNqauFRniMNW) shows the screens (copy in [canvas/](canvas/project/)). Build from those boards, minus the differences listed below.
1. **Set up.** *Settings › Google · Socials folder* (the *Settings* board) shows the Socials folder and its `Posts/` folder, plus **Set up**. Set up makes `Posts/` and lets everyone in the band add to Socials.
2. **Pick photos.** *Posts › Photos* (the *Posts › Photos · multi-select* board, and *Phone · Photos*).
   - A folder rail lists Socials and its subfolders, with a link to the Posts tab.
   - Photos are grouped by the day they were taken. Each day is labelled with that day's show or rehearsal.
   - Picking is numbered and multi-select, with a sticky **Add to carousel draft** bar.
   - The *Add to carousel draft* dialog makes a new draft by name or adds to an existing draft, and says that the photos will move to `Posts/DRAFT - <name>`.
3. **Edit.** The *Edit the carousel* board.
   - A preview with the crop frame. Dragging the photo sets where the crop is centred.
   - Photos in a list, reordered by dragging or with up/down buttons.
   - Alt text for each photo, and 4:5 or Square for the whole carousel.
   - × takes a photo out, and Add photos adds more.
   - A caption showing its character count (out of 2,200) and hashtag count (out of 30).
   - Everything autosaves. Done goes back to Posts. The pencil icon renames the post.
4. **Post it.**
   - The *Post it* board shows the Instagram account, a warning when any photo has no alt text, what will happen in Drive, and an explicit **Post now**.
   - The *After posting* board shows the Instagram link and the folder now named `YYYY-MM-DD - <name>`.

**Deliberate differences from the canvas.** These are not built in this story:
- Search all of Drive.
- The Newest added first and Oldest taken first sorts.
- The Not in a post yet / All toggle. It isn't needed: everything in the inbox is unused.
- The Show folders entry in the rail.
- The "2 of 50 posts used today" counter.
- Pick a time (Stage 3).
- Video in the inbox (Stage 7).
- The Layout board's Ideas / Drafts / Posted folders, which the layout above replaces.
- × "back to Ideas", which now sends the photo back to its own folder.

This story also adds two things that aren't on the canvas: the Settings rows for Socials and `Posts/`, and a **Finish tidying Drive** retry on a posted post whose folder rename failed. Both get added to the canvas.

**The older canvas** [Roadie Posts](https://claude.ai/artifact/RBsrzxbwZiDisHXSuMgYXk) is still the reference for the rest of Posts. Where it overlaps this one (its Carousel and Add media boards), this canvas takes precedence.

### Alternatives considered
- **Ideas / Drafts / Posted folders, with Posted split into months.** This was the first draft. It's three folders to keep in sync, and the state is stored twice (folder and Drive tags). Rejected for the simpler model above.
- **Shortcuts only, never move.** This conflicts with the ask ("moves the photos in Drive"), and the inbox would stop showing what's unused.
- **Store status in Drive tags (appProperties) or Drive Labels.** That's a second copy that can disagree with Roadie, and Labels need Workspace admin setup. Status stays in Roadie only.
- **Copy instead of move.** It duplicates the files, and the inbox no longer shows what's unused.
- **Move photos only when the post goes out.** It's simpler in Drive, but the inbox would then mix unused photos with photos already in a draft.

### Risks and limits
- **Anyone in the band can add, move or delete photos in Socials.** It is shared as writer so phones can add to it. Roadie checks that every draft photo still exists when the draft opens. A photo that has gone missing is flagged with a **Remove** button.
- **Drive storage.** Socials is in the band's Shared Drive, so photos count against the Shared Drive's storage, not each member's. Moving files within a Shared Drive needs the band account to be a Content manager or higher. Set up checks this and says so if it isn't.
- **Instagram limits.** A carousel holds 2–10 photos. A caption holds 2,200 characters and 30 hashtags. An account can publish 50 posts in 24 hours. When Instagram refuses a post, the reason is shown on the post and the draft stays as it is.
- **Partial failures.**
  - Making a draft undoes its own steps if any step fails.
  - A failed post leaves Drive untouched and the draft can be posted again.
  - If the post goes out but the folder rename fails, the post shows as posted with **Finish tidying Drive**.
- **Volume.** Photos reads at most the 2,000 most recently added photos in a view. If the Drive 1 audit (#54) shows more than that is normal, add paging by day.

### Not in this story
- Facebook (Stage 2), scheduling (Stage 3), video in carousels (Stage 7), Reels, Stories, TikTok, YouTube.
- Reposting a photo that's already been posted. Picking photos from outside Socials.
- Text drawn on a photo. The caption and alt text are the text.
- Members using Posts. Posts stays admin-only; members only add photos to Socials from Drive.
- Moving photos already scattered around Drive into Socials. That's Drive 3 (#56).

## Implementation plan

### Data
**`posts`** (`src/schema/posts.ts`; the rules don't change: admins read, the server writes). The #49 docs still validate, because every new field is optional.
```ts
export const postStatus = z.enum(["draft", "publishing", "posted", "failed"]);
export const PHOTO_TYPES = ["image/jpeg", "image/heic", "image/heif", "image/png", "image/webp"] as const; // replaces JPEG_ONLY
const Focus = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const Media = z.strictObject({
  driveFileId: z.string().min(1),
  mimeType: z.string(),
  url: z.string().optional(),          // the photo's Drive link ("Open in Drive")
  name: z.string().optional(),         // file name when picked
  width: z.number().int().optional(),  // after EXIF rotation
  height: z.number().int().optional(),
  alt: z.string().max(1000).optional(),
  focus: Focus.optional(),             // crop centre on the rotated photo; missing = { x: 0.5, y: 0.5 }
  from: z.strictObject({ folderId: z.string() }).optional(), // where it goes back to
});
export const Post = entity({
  artistId: id,
  title: z.string().trim().min(1).max(100).optional(),   // the draft's name; the folder is "DRAFT - <title>", then "YYYY-MM-DD - <title>"
  caption: z.string().max(2200),                          // createDraft sets ""
  aspect: z.enum(["4:5", "1:1"]).optional(),              // missing = "4:5"
  media: z.array(Media).min(1).max(10),                   // carousel order
  driveFolderId: z.string().optional(),                   // the post's folder in Socials/Posts
  status: postStatus,
  postedAt: z.string().optional(),                        // ISO
  instagram: z.strictObject({ mediaId: z.string(), permalink: z.string().nullable() }).optional(),
  error: z.string().optional(),
  driveTidy: z.strictObject({ error: z.string() }).optional(), // posted, but the folder rename failed
  createdVia: via,
});
```
There is no `kind`: one photo or a carousel follows from `media.length`.

**`artists`** (`src/schema/artists.ts`)
- `postsFolderId` stays (now "the Socials folder"). Its doc comment changes from "{YYYY-MM}" to the layout above.
- A new `postFoldersId` holds the id of `Socials/Posts`. Only `posts.setup` sets it.
- `google.setPostsFolder` clears `postFoldersId` when Socials changes, so Set up runs again.

### Drive service
`src/server/integrations/drive.ts`, both the real service and the fake client. `search` and its callers are unchanged.
```ts
export interface DriveFile {
  // …existing fields…
  size?: number;
  /** imageMediaMetadata; width/height as Drive reports them (before rotation). time is "YYYY:MM:DD HH:MM:SS", camera-local. */
  image?: { width: number; height: number; time?: string; rotation?: number };
  trashed?: boolean;
}
export interface DriveService {
  // …existing…
  /** One page of files. `parents` are ORed; Drive's q is built as `(… in parents or …) and mimeType … and trashed = false`. */
  list(opts: { parents: string[]; kind: "folders" | "images"; orderBy?: "createdTime desc"; pageSize?: number; pageToken?: string }): Promise<{ files: DriveFile[]; nextPageToken?: string }>;
  /** files.update: rename and/or move. `rename` becomes update(id, { name }). */
  update(id: string, opts: { name?: string; addParents?: string[]; removeParents?: string[] }): Promise<DriveFile>;
  /** Moves to Drive's trash. Callers only pass an empty post folder Roadie made; postFolder.ts checks that before calling. */
  trash(id: string): Promise<void>;
  /** The file's thumbnailLink fetched at =s{size} with the band token. 404 when Drive has no thumbnail yet. */
  thumbnail(id: string, size: number): Promise<Response>;
}
```
- `FILE_FIELDS` gains `size,imageMediaMetadata(width,height,time,rotation),trashed`.
- `list` uses `supportsAllDrives` / `includeItemsFromAllDrives`, as `get` already does for shared-drive items.
- Every Drive error during a move aborts the command and runs its undo steps. Socials is in a Shared Drive, so there is no ownership fallback.

**`findOrMakeFolder`**: merge the two copies (`src/server/commands/showPosters.ts:37`, `src/server/commands/releases.ts:359`) into one function in `src/server/driveFolders.ts`.
```ts
findOrMakeFolder(drive, parentId, name, share?: { emails: string[]; role?: "reader" | "writer" }): Promise<{ folder: DriveFile; made: boolean }>
```
- It shares only a folder it makes, as today. The default role stays reader.
- Show posters and releases switch to it and use `.folder`.

### Signed URLs
`src/server/signedUrl.ts` replaces the signing in `src/server/meta/media.ts`.
- **Key:** an HMAC with a new App Hosting secret, `SIGNED_URL_SECRET`, not `META_APP_SECRET`. That way Photos works on a server without Instagram set up.
  - Outside production, an unset secret falls back to a fixed dev key.
  - In production, an unset secret fails with 503 "Signed links aren't set up on this server".
  - Set the secret before the deploy that references it (`apphosting.yaml`).
- **Body:** `"<scope>.<artistId>.<id>.<v>.<exp>"`, where `scope` is `thumb` or `media`.
- **Expiry:** `exp` is the end of the next whole hour, so a URL stays the same for 1–2 hours and the browser cache works.
- **Version:** `v` is the photo's `modifiedTime` for thumbs (the URL changes when the photo does) and the photo index for media.
- `signUrl(scope, artistId, id, v)` and `signedOk(scope, artistId, id, v, exp, sig)`.

### Commands
All of these live in `src/server/commands/posts.ts` with `roles: ["admin", "mcp"]` and help text. Each command below lists its input, its output, and the statuses it allows. Draft edits are allowed only while the post is `draft` or `failed`. Anything else is refused with "This post has gone out; it can't be changed" or "This post is being posted right now".

**`posts.setup {}`** returns `{ socials: { id, name }, posts: { id, made }, sharedWithBand: number }`.
- Needs `postsFolderId`. Without it: "Choose the Socials folder in Settings › Google first".
- Finds or makes `Posts` in Socials and saves `postFoldersId`.
- Shares Socials with every bandmate (`bandmates()`) as writer.
- Checks that the band account can move files in the Shared Drive (Content manager or higher). If it can't: "Roadie's Google account needs Content manager on the band's Shared Drive to move photos".
- It is safe to run twice, and running it again shares Socials with members who joined since.

**`posts.photos { folder?: string, pageToken? }`** (read-only) returns `{ folders: { id, name, count }[], photos: Photo[], capped: boolean }`.
- `folder` is a folder id in the inbox. If it's left out, the whole inbox is listed.
- `Photo` is `{ driveFileId, name, mimeType, width, height, takenAt, folderId, thumb }`. `takenAt` is `image.time` as a camera-local `YYYY-MM-DD HH:MM`, or else `createdAt` in the band's timezone. `thumb` is a signed URL at `s=400`.
- It walks the folder tree under Socials except `Posts`, then lists images, newest added first (`createdTime desc`), 20 parent folders per query (Drive's `q` length limit).
- It stops at 2,000 photos and sets `capped`, which shows "Showing the 2,000 most recently added".

**`posts.list {}`** (read-only) returns `{ drafts: PostRow[], posts: PostRow[] }`.
- `PostRow` is `{ id, title, status, postedAt, count, thumb, permalink, error, driveTidy }`, where `thumb` is the first photo's signed thumbnail.
- Drafts include `failed` posts. `posts` lists published posts, newest first.

**`posts.createDraft { title, driveFileIds (1–10) }`** returns `{ id, folderName }`.
- **Checks.** Each file must be in the inbox, be a photo (`PHOTO_TYPES`, or a `.heic` / `.heif` extension), and not be trashed. The command names the first photo that fails ("IMG_4410 is already in Hi-Dive announcement").
- **Steps:**
  1. Create the doc: `status: draft`, `caption: ""`, `aspect: "4:5"`, and `media` with `name`, `width`/`height` (swapped when `rotation` is odd), `url`, and `from.folderId`.
  2. Make `Posts/DRAFT - <title>`. If the name is taken, add " (2)", " (3)" and so on.
  3. Move each photo with `update(id, { addParents: [folder], removeParents: [from] })`.
  4. Save `driveFolderId`.
- **Undo** when any step fails:
  1. Move back each photo already moved.
  2. Trash the folder if it's empty.
  3. Hard-delete the doc.

  Then return the error. Only **Make the draft** creates a draft; autosave never does.

**`posts.addToDraft { id, driveFileIds }`** returns `{ count }`. It uses the same checks, steps and undo as `createDraft` and adds the photos at the end, up to 10 in total.

**`posts.updateDraft { id, patch }`** is what the editor autosaves through (`useAutosave`, `src/lib/autosave.ts`). It returns the doc.
- `patch` is `{ title?, caption?, aspect?, order?: string[], items?: Record<driveFileId, { alt?, focus? }> }`.
- `order` is the whole list of ids. `items` replaces the alt text and focus for the photos it names.
- `baseRev` conflicts work as for every autosaved record.
- A new `title` renames the folder (`DRAFT - <title>`, with the clash rule). The editor sends the title only when the field loses focus or Enter is pressed, never as you type.
- It refuses more than 30 hashtags in the caption.

**`posts.removeFromDraft { id, driveFileId }`** returns `{ count }`.
- It moves the photo back to `from.folderId`, or to the Socials root if that folder is gone.
- Removing the last photo is refused: "Delete the draft instead".

**`posts.deleteDraft { id }`** returns `{ folderLeft: boolean }`.
- It moves every photo back.
- It trashes the folder if it's now empty. Otherwise it leaves the folder and says "Left DRAFT - x in Drive: it has files Roadie didn't put there".
- It soft-deletes the doc.

**`posts.publish { id }`** returns `{ status, permalink?, error?, driveTidy? }`.
- Allowed from `draft` or `failed`. It first sets `publishing`, and a second `publish` is refused while that's set.
- **One photo:** `graph.createImage` (image URL, caption, alt text). **2–10 photos:** an item container for each photo (`is_carousel_item=true`, `image_url`, alt text), each polled until `FINISHED`; then a `CAROUSEL` container with `children` and the caption, which is polled, then `media_publish` and `permalink`.
- The `image_url` is the signed media URL for that photo.
- **If any container fails,** the status becomes `failed` with Instagram's reason and the photo's name, and Drive is untouched. Containers that were made and not published expire on Instagram's side.
- **When the post goes out:** `status: posted`, `postedAt`, `instagram`. Then the folder is renamed `YYYY-MM-DD - <title>` (`dateInBandZone(postedAt)`). If that rename fails, the post stays posted with `driveTidy.error`.
- `src/server/meta/graph.ts` gains `createCarouselItem(igId, t, imageUrl, alt?)` and `createCarousel(igId, t, children, caption)`.
- **Alt text:** phase 5 starts by checking Graph's docs, or with one test call, whether `alt_text` is accepted on image and carousel-item containers. The result is written here.
  - If it is accepted, it's sent.
  - If it isn't, alt text is kept in Roadie only and the "no alt text" warning is dropped from the Post dialog.

**`posts.tidy { id }`** returns `{ ok }`. It is allowed only for `posted` posts with `driveTidy`. It renames the folder and clears `driveTidy`, and running it again changes nothing.

**`posts.publishPhoto` is removed.** Posting one photo means making a one-photo draft and posting it.

### Roadie and MCP
`src/server/assistant/policy.ts`:
- Remove `"posts."` from `EXCLUDED`.
- Add `posts.publish`, `posts.deleteDraft` and `posts.removeFromDraft` to `ALWAYS_CONFIRM`.
- Add `posts.publish` to `VOICE_TAP_ONLY`.
- Add `posts.photos` and `posts.list` to `READ_ONLY`.
- `createDraft` or `addToDraft` with more than 5 photos asks for a confirm through `BULK_LIMIT`, as other bulk commands do.

### Routes
- **`GET /api/posts/thumb/{artistId}/{fileId}?v=&s=&exp=&sig=`** checks `signedOk("thumb", …)` and streams `driveClient({ artistId }).thumbnail(fileId, s)`.
  - `s` is one of 400, 1080 or 2048, and isn't signed.
  - The response is sent with `cache-control: private, max-age=3600`.
  - Not `drive.google.com/thumbnail`, which works only when the viewer is signed in to Google.
- **`GET /api/posts/media/{postId}/{index}?exp=&sig=`** replaces `src/app/api/posts/media/[id]/route.ts`, which is deleted. It renders what Meta fetches:
  1. **Source:** JPEG, PNG and WebP are downloaded as the original. HEIC and HEIF come from `drive.thumbnail(id, 2048)`, because Drive already decodes HEIC and sharp's prebuilt build can't. If a HEIC has no thumbnail: "Drive hasn't made a preview of IMG_4410 yet; try again in a minute". There is no `heic-decode` and no change to memory.
  2. **Crop:** `sharp(buf).rotate()` (applies EXIF; Drive thumbnails are already upright). Then, for target aspect `a` (0.8 or 1), from the rotated `W×H`:
     - if `W/H > a`: `cw = round(H·a)`, `left = round(fx·(W − cw))`, `top = 0`;
     - otherwise: `ch = round(W/a)`, `top = round(fy·(H − ch))`, `left = 0`.

     This is the same rule as CSS `object-fit: cover; object-position: fx·100% fy·100%`, so the editor shows exactly what gets posted.
  3. **Output:** resize to 1080 wide (1080×1350 or 1080×1080), sRGB JPEG at quality 90, with `cache-control: private, no-store`. It is made on each request and never stored.
  - Phase 5 first checks on prod that `=s2048` thumbnails of an iPhone HEIC come back at 1350 px or more on the long edge. If not, raise the size.
- **`POST /api/posts/upload`** saves into the Socials root.
  - It accepts `PHOTO_TYPES` or a `.heic` / `.heif` / `.jpg` / `.jpeg` / `.png` / `.webp` extension (browsers often send an empty type for HEIC).
  - Without `postFoldersId`: "Set up the Socials folder in Settings › Google".
  - `postsMonthFolder` is removed. The month folders #49 made are left where they are and show up as inbox subfolders.
- **`package.json`:** add `sharp` as a direct dependency, pinned to the version `next` already installs.

### Pages
- **Posts** (`src/app/(signed-in)/(app)/artists/[slug]/posts/page.tsx`) gets two tabs: **Posts** and **Photos**.
  - The Posts tab lists drafts and failed posts first, then posts, from `posts.list`, with signed thumbnails.
  - The old "Post a photo" card (`NewPhotoPost`) is removed.
- **Photos:** `/artists/[slug]/posts/photos`.
  - The folder rail comes from `posts.photos`.
  - Photos are grouped by the date of `takenAt`, newest day first. A photo taken before 04:00 counts toward the previous day, so late-show photos land on the show's day.
  - Each day is labelled with that day's shows and rehearsals by date, from `useCollection("shows")` and `useCollection("rehearsals")`, unfiltered. Not `useCalendarItems`, which drops past dates.
  - The selection is an ordered array. Tap order is carousel order, Shift-click picks a range, Space toggles, and Select all works per day.
  - Upload goes to the Socials root.
  - Opened with `?draft=<id>` (from the editor's Add photos), the bar reads **Add to <title>** and calls `addToDraft`.
- **Add to carousel draft dialog:** new draft by name, or one of `posts.list().drafts`.
- **Editor:** `/artists/[slug]/posts/[id]`, also used to view posts that went out (read-only).
  - It autosaves through `useAutosave("posts.updateDraft")`.
  - Reorder uses `src/lib/drag-reorder.ts` plus up/down buttons.
  - The preview uses the thumbnail at `s=1080` with the crop formula above. Dragging sets `focus`.
  - On open it checks each photo with `drive.get`. A photo that is missing or trashed shows "IMG_4412 is no longer in Drive" with **Remove**.
- **Settings › Google** (`src/components/google/FolderCard.tsx`, `src/components/google/shared.tsx`, `google.status`): the Posts folder card becomes **Socials folder**.
  - It has rows for Socials and `Posts/`, each with its status, and a **Set up** button that runs `posts.setup`.
  - Until `postFoldersId` is set, Upload and Make the draft are off and show "Set up the Socials folder in Settings › Google".
- **On a phone** it's the same pages, with a three-column grid and a bottom bar while photos are picked.

### Fakes and fixtures
**`fakes/fake-drive/server.ts`:**
- `PATCH /files/:id` with `name`, `addParents`, `removeParents` and `trashed`.
- `GET /files` with OR'd `in parents`, `mimeType contains 'image/'`, `trashed = false`, `orderBy=createdTime desc` and `pageToken`.
- `imageMediaMetadata` on seeded photos.
- `GET /files/:id/content` serves fixture bytes for seeded photos.
- A thumbnail endpoint that returns a generated JPEG at the requested size. A seed flag gives one HEIC no thumbnail.
- A seed with a Shared Drive Socials folder containing `Jeff's phone spring 26/` (6 photos, 2 HEIC) and 3 loose photos, and a band account that is a Content manager.

**`fakes/fake-meta/server.ts`:**
- `POST /:igId/media` takes `is_carousel_item`, `alt_text`, and `media_type=CAROUSEL` with `children` (2–10; otherwise Instagram's error).
- The status of each container.
- A scenario flag that fails the nth item container.

**`tests/fixtures/`:** `photo-portrait.heic` (EXIF rotation 6) and `photo-landscape.jpg`.

### Phases
Each phase ends with `npm run typecheck` and its tests green.
1. **Data and Drive.** The schema changes, `DriveService.list/update/trash/thumbnail` (real and fake), the merged `findOrMakeFolder`, `signedUrl.ts`, and the fake-drive seed. *Gate:* emulator tests for the new Drive methods against the fake; the show poster and release tests still pass.
2. **Setup.** `posts.setup`, `google.setPostsFolder` clearing `postFoldersId`, the Settings card, and the upload route into Socials. *Gate:* the setup tests (made, found, run twice, no Content manager); upload lands in the Socials root.
3. **Photos.** `posts.photos`, the thumb route, the Photos page with day groups, and `posts.list` with the Posts tab. *Gate:* `posts.photos` walks subfolders, skips `Posts/` and caps at 2,000; signed thumb tests; day labels name a past show.
4. **Drafts.** `createDraft`, `addToDraft`, `updateDraft`, `removeFromDraft`, `deleteDraft`, the dialog and the editor, and the policy changes. *Gate:* the draft tests below; the e2e for pick, make the draft, reorder and autosave.
5. **Posting.** Check `alt_text` and the HEIC thumbnail size first. Then the media route, `publish`, `tidy`, the graph calls and fake-meta, and removing `publishPhoto`. *Gate:* the publish tests and the full e2e.

### Files
- **Create:**
  - `src/server/driveFolders.ts`, `src/server/signedUrl.ts`, `src/server/postFolder.ts` (the move, undo, rename and clash helpers)
  - `src/app/api/posts/thumb/[artistId]/[fileId]/route.ts`, `src/app/api/posts/media/[postId]/[index]/route.ts`
  - `src/app/(signed-in)/(app)/artists/[slug]/posts/photos/page.tsx`, `src/app/(signed-in)/(app)/artists/[slug]/posts/[id]/page.tsx`
  - `src/components/posts/PhotoGrid.tsx`, `AddToDraftDialog.tsx`, `CarouselEditor.tsx`, `PostDialog.tsx`
  - `tests/fixtures/photo-portrait.heic`, `tests/fixtures/photo-landscape.jpg`
- **Modify:**
  - `src/schema/posts.ts`, `src/schema/artists.ts`, `src/server/integrations/drive.ts`
  - `src/server/commands/posts.ts`, `src/server/commands/google.ts`, `src/server/commands/showPosters.ts`, `src/server/commands/releases.ts`
  - `src/server/meta/graph.ts`, `src/server/meta/media.ts` (reduced to a call to `signedUrl.ts`), `src/server/assistant/policy.ts`
  - `src/app/api/posts/upload/route.ts`, `src/app/(signed-in)/(app)/artists/[slug]/posts/page.tsx`
  - `src/components/google/FolderCard.tsx`, `src/components/google/shared.tsx`
  - `fakes/fake-drive/server.ts`, `fakes/fake-meta/server.ts`
  - `apphosting.yaml` (`SIGNED_URL_SECRET`), `package.json` (`sharp`)
  - `tests/emulator/posts.test.ts`, `tests/e2e/posts.spec.ts`
- **Delete:** `src/app/api/posts/media/[id]/route.ts`

### Done when
- **On prod:**
  - Settings › Google › Set up makes `Socials/Posts`.
  - Jeff drops a phone folder of HEIC photos into Socials from the Drive app on his phone. They show in Posts › Photos under their day, with the show named.
  - He picks 5 photos and presses Add to carousel draft. Drive shows `Posts/DRAFT - <name>` holding them, and they are gone from the inbox.
  - He reorders them, writes a caption and adds alt text to one, all autosaved. Post now puts the carousel on Instagram in his order, cropped 4:5, as the editor showed. The folder is now `Posts/YYYY-MM-DD - <name>`. (Delete the post in the Instagram app afterwards.)
  - Taking a photo out of a draft puts it back in its folder. Deleting a draft puts them all back and trashes the empty folder.
- **Emulator tests** (`tests/emulator/posts.test.ts`):
  - `setup`: made vs found, safe to run twice, shares Socials as writer, refuses without Content manager.
  - `createDraft`: moves the photos and records `from`; refuses a photo outside the inbox or already in a post; the folder name clash gets " (2)"; a failure halfway undoes the moves, trashes the empty folder and deletes the doc.
  - `addToDraft` reuses the same steps and enforces the cap of 10.
  - `updateDraft`: patch shape, `baseRev` conflict, a title change renames the folder, more than 30 hashtags refused, refused once posted.
  - `removeFromDraft` and `deleteDraft` restore each photo's folder (Socials root when its folder is gone); a folder that isn't empty is left; removing the last photo is refused.
  - `publish`: one photo vs carousel call order; a failed item container leaves the post `failed` and Drive untouched; a failed post can be published again; a second publish is refused while publishing; a rename failure sets `driveTidy`; `tidy` run twice changes nothing.
  - The media route: the HEIC fixture comes out as a 1080×1350 JPEG, upright; `focus` moves the crop; a HEIC with no thumbnail gives its error.
  - Signed URLs: expired, wrong signature, another band's file, and the same URL within the hour.
  - `posts.photos`: walks nested folders, skips `Posts/`, sorts newest added first, caps at 2,000.
  - Policy: posts commands are eligible for Roadie; `publish` asks for a confirm.
- **E2E** (`tests/e2e/posts.spec.ts`, Graph stubbed):
  - Pick 5, Make the draft, reorder, caption autosaves, Post now; the fake Drive shows `YYYY-MM-DD - <name>`.
  - Delete a draft and the inbox has its photos back.
  - Upload lands in Socials.
  - Make the draft is off until Set up has run.
  - Members don't see Posts.
- `npm run typecheck` is clean.

### Decided
All of these are Jeff's, Nov 11–12 ([decision log](https://github.com/zilkey/roadie-issues/issues/75#issuecomment-6802964109)).
- The caption and alt text for each photo are the only text. Nothing is drawn on photos.
- The layout is Socials as the inbox, with `Posts/DRAFT - <name>`, renamed `YYYY-MM-DD - <name>` once posted. Photos move when the draft is made. Files keep their names.
- Status lives only in Roadie. There are no Drive tags.
- There is one publish path, and `publishPhoto` is retired.
- HEIC is rendered from Drive's thumbnail.
- Signed URLs use Roadie's own secret.
- Posts commands are open to Roadie and MCP, with confirms.
- A failed folder rename gets a retry button.
- The canvas extras listed above are cut.
- Day groups name the show.
- Socials is in a Shared Drive.
- Facebook waits for Stage 2. This story posts to Instagram only.
