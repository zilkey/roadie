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
   - Photos are grouped by the day they were taken. Each day is labelled with that day's hold or confirmed show, or rehearsal.
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
  - Undo covers edits only (caption, alt text, crop, order, aspect). Anything that moves or renames in Drive is put right with the opposite action instead: take the photo out, or delete the draft.
- **Volume.** Photos reads at most the 2,000 most recently added photos in a view. If the Drive 1 audit (#54) shows more than that is normal, add paging by day.

### Not in this story
- Facebook (Stage 2), scheduling (Stage 3), video in carousels (Stage 7), Reels, Stories, TikTok, YouTube.
- Reposting a photo that's already been posted. Picking photos from outside Socials.
- Text drawn on a photo. The caption and alt text are the text.
- Members using Posts. Posts stays admin-only; members only add photos to Socials from Drive.
- Moving photos already scattered around Drive into Socials. That's Drive 3 (#56).

## Implementation plan

### Data
**`posts`** (`src/schema/posts.ts`; the rules don't change: admins read, the server writes). The #49 docs still validate, because every new field is optional. The #49 docs are also migrated (see [Migrating the #49 posts](#migrating-the-49-posts)).
```ts
export const postStatus = z.enum(["draft", "publishing", "posted", "failed"]);
const Focus = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const Media = z.strictObject({
  driveFileId: z.string().min(1),
  mimeType: z.string(),
  url: z.string().optional(),          // the photo's Drive link ("Open in Drive")
  name: z.string().optional(),         // file name when picked
  width: z.number().int().optional(),  // after EXIF rotation
  height: z.number().int().optional(),
  modifiedTime: z.string().optional(), // Drive's modifiedTime when picked; refreshed by posts.get; signs the thumbnail
  alt: z.string().max(1000).optional(),
  focus: Focus.optional(),             // CSS object-position fractions on the rotated photo; missing = { x: 0.5, y: 0.5 }
  from: z.strictObject({ folderId: z.string() }).optional(), // where it goes back to
});
export const Post = entity({
  artistId: id,
  title: z.string().trim().min(1).max(100).optional(),   // the folder is "DRAFT - <title>", then "YYYY-MM-DD - <title>"
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
- There is no `kind`: one photo or a carousel follows from `media.length`.
- **Photo types:** `src/lib/photos.ts` exports `PHOTO_TYPES = ["image/jpeg", "image/heic", "image/heif", "image/png", "image/webp"]` and `photoType(name, mimeType)`.
  - `photoType` returns the type to use: `mimeType` if it is in `PHOTO_TYPES`, else the type of a `.jpg`/`.jpeg`/`.heic`/`.heif`/`.png`/`.webp` extension, else `null`.
  - It replaces the `JPEG` check and the `JPEG_ONLY` message in `src/server/commands/posts.ts`, `src/app/api/posts/upload/route.ts` and `posts/page.tsx`.
- **Hashtags:** `src/lib/photos.ts` also exports `hashtagCount(caption)`, which counts the matches of `/(^|\s)#[\p{L}\p{N}_]+/gu`. The editor's counter and `updateDraft` both use it.

**`artists`** (`src/schema/artists.ts`)
- `postsFolderId` stays as the Socials folder. Its doc comment changes from "{YYYY-MM}" to the layout above.
- A new `postFoldersId` holds the id of `Socials/Posts`. Only `posts.setup` sets it: `ArtistIn` (`src/server/commands/people.ts:302`) omits it, so `artists.update` can't.
- `google.setPostsFolder` clears `postFoldersId` when Socials changes, so Set up runs again.

### Drive service
`src/server/integrations/drive.ts`, both the real service (`googleDrive`) and the fake client (`fakeDriveClient`). `search`, `rename` and their callers are unchanged: `rename` stays, as a wrapper over `update(id, { name })`.
```ts
export interface DriveFile {
  // …existing fields…
  size?: number;
  /** imageMediaMetadata. width/height as Drive reports them (before rotation). time is "YYYY:MM:DD HH:MM:SS", camera-local. */
  image?: { width: number; height: number; time?: string; rotation?: number };
  thumbnailLink?: string;
  trashed?: boolean;
}
export interface DriveService {
  // …existing…
  /** One page of non-trashed files whose parent is any of `parents`. kind "images" = mimeType contains 'image/' OR a photo extension. */
  list(opts: { parents: string[]; kind: "folders" | "images" | "all"; orderBy?: "createdTime desc"; pageSize?: number; pageToken?: string }): Promise<{ files: DriveFile[]; nextPageToken?: string }>;
  /** files.update: name and/or parents. */
  update(id: string, opts: { name?: string; addParents?: string[]; removeParents?: string[] }): Promise<DriveFile>;
  /** files.update trashed=true. postFolder.ts calls it only for a post folder it made, after isEmpty(). */
  trash(id: string): Promise<void>;
  /** files.get thumbnailLink, then fetch it at "=s{size}" with the band token. Throws IntegrationError 404 when Drive has no thumbnail yet. */
  thumbnail(id: string, size: number): Promise<Response>;
  /** files.get capabilities(canMoveChildrenWithinDrive) on a folder: can the band account move files in and out of it? */
  canMoveIn(folderId: string): Promise<boolean>;
}
```
- `FILE_FIELDS` gains `size,imageMediaMetadata(width,height,time,rotation),thumbnailLink,trashed`.
- **Real `list`** builds `q` as `(${parents.map(p => `'${p}' in parents`).join(" or ")}) and trashed = false`, plus:
  - for images: `and (mimeType contains 'image/' or name contains '.heic' or name contains '.HEIC' or name contains '.heif')`;
  - for folders: `and mimeType = '${FOLDER_MIME}'`.

  It sends `supportsAllDrives` (as `get` does) and adds `includeItemsFromAllDrives`. `pageSize` defaults to 1000.
- **Fake `list`** calls a new fake route, `GET /files/list?parents=a,b&kind=images&orderBy=createdTime%20desc&pageSize=&pageToken=`. The fake's existing `GET /files` and its `q` (name contains) stay as they are for `search`.
- **Errors:** every Drive error during a move aborts the command, which then runs that command's undo steps (below).

**`findOrMakeFolder`**: the two versions (`src/server/commands/showPosters.ts:37` returns `DriveFile`; `src/server/commands/releases.ts:359` returns `{ folder, made }`) merge into one function in `src/server/driveFolders.ts`.
```ts
findOrMakeFolder(drive, parentId, name, share?: { emails: string[]; role?: "reader" | "writer" }): Promise<{ folder: DriveFile; made: boolean }>
```
- It shares only a folder it makes, as today. The default role stays reader.
- Show posters, releases and `postsMonthFolder` (until phase 2 removes it) switch to it and use `.folder`.

**`src/server/postFolder.ts`** holds the Drive steps every posts command shares:
- `isEmpty(folderId)`: `list({ parents: [folderId], kind: "all", pageSize: 1 })` returns no files. Any type counts, so a PDF or a video makes the folder not empty.
- `uniqueName(parentId, base)`: `base`, then `base (2)`, `base (3)`… so the name isn't taken by a folder in `Posts/`. Used for `DRAFT - <title>` and for `YYYY-MM-DD - <title>`.
- `inboxFolders(artistId)`: walks the folder tree under Socials, except `Posts`, with `list({ kind: "folders" })` one level at a time. It returns `{ id, name, parentId }[]`. Both `posts.photos` and the inbox check use it.
- `moveInto(fileId, to, from)` and `moveBack(media)`. `moveBack` sends a photo to `from.folderId`, or to the Socials root when that folder is gone or trashed.

### Signed URLs
`src/server/signedUrl.ts` holds the signing, and `src/server/meta/media.ts` becomes a call to it.
- **Key:** an HMAC with the new App Hosting secret `SIGNED_URL_SECRET`, not `META_APP_SECRET`, so Photos works on a server without Instagram set up.
- **Missing key:** it follows the codebase's real-project rule (`mcp/web.ts:32–35`). When `GCLOUD_PROJECT` is set and doesn't start with `demo-`, a missing secret fails with 503 "Signed links aren't set up on this server". Otherwise, in dev, the emulator and e2e, a fixed dev key is used.
- **Deploy order:** set the secret before the deploy that references it in `apphosting.yaml`.
- **Signed body:** `"<scope>.<artistId>.<id>.<v>.<exp>"`.
  - `thumb`: `id` is the Drive file id and `v` is the file's `modifiedTime`, or `"0"` when it's unknown.
  - `media`: `id` is the post id and `v` is the photo's index.
- **Expiry:** `exp` is the start of the current hour plus 2 hours, so a URL stays the same within the hour and the browser's cache works.
- **Functions:** `signUrl(scope, artistId, id, v)` and `signedOk(scope, artistId, id, v, exp, sig)`.
- Update the `META_APP_SECRET` comments in `graph.ts:9` and `media.ts:1–4`.

### Commands
All of these live in `src/server/commands/posts.ts` with `roles: ["admin", "mcp"]` and help text.
- **Draft edits** (`addToDraft`, `updateDraft`, `rename`, `removeFromDraft`, `deleteDraft`) and `publish` are allowed only on a post with a `driveFolderId` whose status is `draft` or `failed`. Otherwise they're refused:
  - `posted`: "This post has gone out; it can't be changed".
  - `publishing`: "This post is being posted right now".
- **Finding which post holds a photo:** a photo whose parent folder is a post folder belongs to the post where `driveFolderId == parent`. That's one query per parent, so `media[].driveFileId` never needs to be queried.

**`posts.setup {}`** returns `{ socials: { id, name }, posts: { id, made }, sharedWithBand: number }`.
- Without `postsFolderId`: "Choose the Socials folder in Settings › Google first".
- If `canMoveIn(Socials)` is false: "Roadie's Google account needs Content manager on the band's Shared Drive to move photos". Nothing is changed.
- Otherwise it calls `findOrMakeFolder(Socials, "Posts")`, saves `postFoldersId`, and shares Socials with every bandmate (`bandmates()`) as writer.
- A second run finds `Posts` (`made: false`) and shares Socials with members who joined since.

**`posts.photos { folder?: string }`** (read-only) returns `{ folders: { id, name, parentId, count }[], photos: Photo[], capped: boolean }`.
- `folders` comes from `inboxFolders()`. `count` is every photo in that folder alone, not capped.
- With no `folder`, every inbox folder is listed. With `folder`, that folder and its subfolders are listed. A folder that isn't in the inbox (including `Posts/`) is refused: "That folder isn't in Socials".
- Photos come from `list({ kind: "images", orderBy: "createdTime desc" })` in batches of 20 parent folders. 20 is a conservative size that keeps `q` well under Drive's query-length limit. The batches are merged newest-added first across all of them, then cut at 2,000 (`capped`: "Showing the 2,000 most recently added").
- `Photo` is `{ driveFileId, name, mimeType, width, height, takenAt, folderId, thumb }`.
  - `width` and `height` are swapped when `rotation` is odd.
  - `takenAt` is `"YYYY-MM-DD HH:MM"`: `image.time` as written (camera-local), or else `createdTime` formatted in the band's timezone with a new `dateTimeInBandZone(date)` in `src/lib/timezone.ts`.
  - `thumb` is `signUrl("thumb", …)` at `s=400`.

**`posts.list {}`** (read-only) returns `{ drafts: PostRow[], posts: PostRow[] }`.
- `PostRow` is `{ id, title, status, postedAt, count, thumb, permalink, error, driveTidy }`. `thumb` is signed from the first photo's stored `modifiedTime`, so there's no Drive call.
- `drafts` holds `draft`, `failed` and `publishing` posts, newest change first. `posts` holds `posted` posts, newest first.

**`posts.get { id }`** (read-only) returns the post plus, for each photo, `{ thumb1080, missing, trashed }`.
- It calls `drive.get` for each photo, at most 10. A photo that's gone or trashed is flagged.
- A changed `modifiedTime` is saved back to the doc. That save is the only write and isn't in history.
- The editor loads through this command.

**`posts.createDraft { title, driveFileIds (1–10) }`** returns `{ id, folderName }`. Only this command, from **Make the draft**, creates a draft; autosave never does.
- **Checks** (nothing changes if one fails, and the message names the photo):
  - Each photo's parent is in `inboxFolders()` (or is Socials itself). If its parent is a post folder: "IMG_4410 is already in Hi-Dive announcement". Otherwise: "IMG_4410 isn't in Socials".
  - Each photo has a `photoType()` and isn't trashed.
- **Steps**, with the doc made last so that undo never has to delete a doc:
  1. Make `Posts/<uniqueName("DRAFT - " + title)>`.
  2. Move each photo in with `moveInto`.
  3. Create the doc: `status: draft`, `caption: ""`, `aspect: "4:5"`, `driveFolderId`, and `media` with `name`, `width`/`height` (rotated), `modifiedTime`, `url`, `from.folderId`.
- **Undo** if step 2 or 3 fails: move each moved photo back, then trash the folder if `isEmpty`. Then return the error.

**`posts.addToDraft { id, driveFileIds }`** returns `{ count }`. The same checks apply, and the total stays at 10 or fewer.
- **Steps:** move each photo into `driveFolderId`, then append the photos to `media`.
- **Undo** when a move or the update fails: move back the photos this call moved.

**`posts.updateDraft { id, patch }`** is the editor's autosave (`useAutosave("posts.updateDraft")`, `src/lib/autosave.ts`) and returns the doc. It changes only Firestore.
- `patch` is `{ caption?, aspect?, order?: string[], items?: Record<driveFileId, { alt?, focus? }> }`.
- `order` is the whole list of ids. The client always sends the **whole** `items` map, because autosave merges per top-level key and a partial map would drop another photo's edit.
- It refuses a caption whose `hashtagCount` is over 30.
- `baseRev` conflicts work as for every autosaved record. Its Undo toast reverts Firestore only, which is all this command changes.

**`posts.rename { id, title }`** returns `{ folderName }`.
- The editor's pencil icon calls this on blur or Enter. Autosave never does.
- It renames the folder to `uniqueName("DRAFT - " + title)` and then saves `title`. If the save fails, the folder is renamed back.

**`posts.removeFromDraft { id, driveFileId }`** returns `{ count }`.
- **Steps:** `moveBack` the photo, then remove it from `media`. If the update fails, the photo is moved back into the draft.
- Removing the last photo is refused: "Delete the draft instead".

**`posts.deleteDraft { id }`** returns `{ folderLeft: boolean, notMoved: string[] }`.
- **Steps:** `moveBack` each photo and keep going if one fails.
- **If any photo couldn't be moved back,** `media` keeps those photos and the draft stays: "Couldn't move IMG_4412 back: <reason>. The draft keeps it".
- **If every photo moved back,** the folder is trashed if `isEmpty`. Otherwise it's left: "Left DRAFT - x in Drive: it has files Roadie didn't put there". Then the doc is soft-deleted.

**`posts.publish { id }`** returns `{ status, permalink?, error?, driveTidy? }`.
- **Start:** in one transaction (`run`/`w.get`), it checks that the status is `draft` or `failed` and sets `publishing`. A second publish is refused by that check.
- **Token:** `freshToken(artistId)` first, as `publishPhoto` did.
- **One photo:** `graph.createImage(igId, t, imageUrl, caption, alt?)`.
- **2–10 photos:**
  1. `graph.createCarouselItem(igId, t, imageUrl, alt?)` for each photo, each polled until `FINISHED`.
  2. `graph.createCarousel(igId, t, childIds, caption)`, polled.
  3. `graph.publish` and `graph.permalink`.
- `imageUrl` is the signed `media` URL for that index.
- **If any container fails,** the status becomes `failed` with Instagram's reason and the photo's name, and Drive is untouched. Unpublished containers expire on Instagram's side after 24 hours ([Graph content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing)), so nothing needs cleaning up.
- **When the post goes out:** `status: posted`, `postedAt`, `instagram`. Then the folder is renamed to `uniqueName(dateInBandZone(new Date(postedAt)) + " - " + title)`. If that rename fails, the post stays posted with `driveTidy.error`.
- **Alt text:** phase 5 starts by checking Graph's docs, or with one test call, whether `alt_text` is accepted on image and carousel-item containers. The result is written here.
  - If it is accepted, it's sent.
  - If it isn't, the `alt` argument is dropped, alt text stays in Roadie only, and the "no alt text" warning is dropped from the Post dialog.

**`posts.tidy { id }`** returns `{ ok: true }`.
- It is refused unless the status is `posted`.
- With `driveTidy` set, it renames the folder (same rule as above) and clears `driveTidy`.
- Without `driveTidy`, it changes nothing and still returns `{ ok: true }`.

**`posts.publishPhoto` is removed** in phase 5. Posting one photo means making a one-photo draft and posting it.

### Undo
- **Autosaved edits:** caption, alt text, crop, order and aspect go through `updateDraft`, which only writes Firestore, so their Undo toast works as usual.
- **Anything that changes Drive** (setup, create, add, rename, remove, delete, publish, tidy) can't be undone.
  - `undoRun` (`src/server/undo.ts`) refuses a run that touched a `posts` doc in any of these ways:
    - created it or deleted it;
    - changed `title`, `status` or `driveFolderId`;
    - changed which `driveFileId`s are in `media`.
  - The refusal message is: "This changed Drive, so it can't be undone. Take the photo out or delete the draft instead".
  - These commands return no `runId` for the client's Undo toast.

### Migrating the #49 posts
`scripts/migrate-posts-49.ts`, run as `npm run migrate:posts-49`. It is a dry run by default and changes nothing until `--apply`. It runs once per artist as the band account.
- **Which posts:** every post with no `driveFolderId`.
  - `title` is the first 40 characters of the caption, cut at a word boundary, or else `Photo <createdAt date>`.
  - The folder is made in `Posts/`:
    - `posted`: `YYYY-MM-DD - <title>`, using the date it was created.
    - `failed`: `DRAFT - <title>`, so it becomes an editable draft.
    - `publishing`: same as `failed`, with `error: "Interrupted before it posted"`.
  - Its photo is moved in, with `from.folderId` set to the month folder.
  - `modifiedTime`, `name`, `width` and `height` are filled in from `drive.get`.
- **Failures:** a post whose photo is gone is reported and skipped.
- **Re-runs:** it is safe to run again, because posts that already have `driveFolderId` are skipped.
- **When:** run it after phase 2's setup is done on prod.
- **Package script:** `package.json` gains `"migrate:posts-49": "tsx scripts/migrate-posts-49.ts"`.

### Roadie and MCP
`src/server/assistant/policy.ts`:
- Remove `"posts."` from `EXCLUDED`.
- **`ALWAYS_CONFIRM`:** add `posts.setup` (it changes sharing), `posts.publish`, `posts.deleteDraft` and `posts.removeFromDraft`.
- **`VOICE_TAP_ONLY`:** add `posts.setup` and `posts.publish`.
- **`READ_ONLY`:** add `posts.photos`, `posts.list` and `posts.get`.
- **`ONE_RECORD_LISTS`:** add `posts.updateDraft`, so a long `order` isn't treated as a bulk change.
- `createDraft` or `addToDraft` with more than 5 photos asks for a confirm through `BULK_LIMIT`. `tidy` and `rename` need no confirm.
- **`SUMMARY`:**
  - `posts.publish`: "Post <title> (<n> photos) to Instagram now".
  - `posts.deleteDraft`: "Delete the draft <title> and put its photos back in Socials".
  - `posts.removeFromDraft`: "Take <photo> out of <title>".
  - `posts.setup`: "Set up the Socials folder and let the band add to it".

### Routes
**`GET /api/posts/thumb/{artistId}/{fileId}?v=&s=&exp=&sig=`**
- Checks `signedOk("thumb", …)`, then streams `driveClient({ artistId }).thumbnail(fileId, s)`.
- `s` is one of 400, 1080 or 2048 and isn't signed.
- The response uses `cache-control: private, max-age=3600`.
- Drive's own `drive.google.com/thumbnail` isn't used, because it works only when the viewer is signed in to Google.

**`GET /api/posts/media/{postId}/{index}?exp=&sig=`** replaces `src/app/api/posts/media/[id]/route.ts`, which is deleted. It renders what Meta fetches:
1. **Source:** JPEG, PNG and WebP come from the original via `download`. HEIC and HEIF come from `thumbnail(id, 2048)`, because Drive already decodes HEIC and sharp's prebuilt build can't. A HEIC with no thumbnail fails with "Drive hasn't made a preview of IMG_4410 yet; try again in a minute". There's no `heic-decode`, and `runConfig.memoryMiB` in `apphosting.yaml` stays as it is.
2. **Crop:** `sharp(buf).rotate()` applies EXIF orientation (Drive thumbnails are already upright). Then, for target aspect `a` (0.8 or 1), from the rotated `W×H`:
   - if `W/H > a`: `cw = round(H·a)`, `left = round(fx·(W − cw))`, `top = 0`;
   - otherwise: `ch = round(W/a)`, `top = round(fy·(H − ch))`, `left = 0`.

   This is the same rule as CSS `object-fit: cover; object-position: fx·100% fy·100%`, so the editor shows the same crop that gets posted.
3. **Output:** resize to 1080 wide (1080×1350 or 1080×1080), upscaling when the crop is narrower than 1080. Encode as sRGB JPEG at quality 90 with `cache-control: private, no-store`. It's made on each request and never stored.
- Phase 5 first checks on prod that `=s2048` thumbnails of an iPhone HEIC come back at 1350 px or more on the long edge. If not, the route uses `=s4000` for HEIC, which `thumbnail()` already accepts as a size.

**`POST /api/posts/upload`**
- Saves into the Socials root, with the type from `photoType(name, file.type)`. Anything else is refused: "Roadie takes JPEG, HEIC, PNG and WebP photos".
- The per-file `drive.share` goes, because Socials is already shared with the band.
- Without `postFoldersId`: "Set up the Socials folder in Settings › Google". That message replaces `NO_POSTS_FOLDER`.
- `postsMonthFolder` is removed. The month folders #49 made stay where they are as inbox subfolders.

**`package.json`:** add `"sharp": "0.35.5"` as a direct dependency (the version `next` installs).

### Pages
**Posts** (`src/app/(signed-in)/(app)/artists/[slug]/posts/page.tsx`) gets two tabs: **Posts** and **Photos**.
- The Posts tab lists drafts (with failed and publishing posts) first, then posts, from `posts.list`.
- The old "Post a photo" card (`NewPhotoPost`) is removed in phase 3.
- **Instagram not connected, or needing a new sign-in** (`meta.status`, as today): Photos and drafts work as usual, and **Post now** is off with the current connect or sign-in message and link.

**Photos:** `/artists/[slug]/posts/photos`
- **Folder rail:** from `posts.photos().folders`, nested by `parentId`, plus a link to the Posts tab.
- **Day groups:** photos are grouped by the date part of `takenAt`, newest day first. A photo taken before 04:00 counts toward the previous day, so late-show photos land on the show's day.
- **Day labels:** each day shows that date's hold or confirmed shows (`showName`) and rehearsals, matched on `date`. They come from `useCollection("shows")` and `useCollection("rehearsals")`, not from `useCalendarItems`, which drops past dates.
- **Selection:** an ordered array. Tap order is carousel order, Shift-click picks a range, Space toggles, and Select all works per day.
- **Upload** goes to the Socials root.
- **From the editor:** opened with `?draft=<id>` (the editor's Add photos), the bar reads **Add to <title>** and calls `addToDraft`.

**Add to carousel draft dialog:** a new draft by name, or one of `posts.list().drafts` that has a `driveFolderId` and is `draft` or `failed`.

**Editor:** `/artists/[slug]/posts/[id]`, loaded through `posts.get`.
- A `posted` or `publishing` post is shown read-only.
- **Saving:** it autosaves through `useAutosave("posts.updateDraft")`, and the pencil icon calls `posts.rename`.
- **Reorder:** `src/lib/drag-reorder.ts` (HTML5 drag, mouse only) plus up/down buttons, which are the way to reorder on a phone.
- **Crop:** the preview uses the `s=1080` thumbnail with `object-fit: cover; object-position: fx·100% fy·100%`. Dragging moves the photo. `fx` changes by `−dx / (renderedWidth − frameWidth)`, clamped to 0–1 (the same for y), and is saved as `focus`.
- **Missing photos:** a photo `posts.get` reports as missing or trashed shows "IMG_4412 is no longer in Drive" with **Remove**.

**Settings › Google** (`src/components/google/FolderCard.tsx`, `src/components/google/shared.tsx`, `google.status` in `src/server/commands/google.ts`): the Posts folder card becomes **Socials folder**.
- `google.status` adds `posts: { socialsId, socialsName, postsId?, setUp: boolean }`, and `shared.tsx`'s `Status` gains that field.
- The card shows a row for Socials and one for `Posts/` (Working, or Not set up), and a **Set up** button that runs `posts.setup`.
- Until `postFoldersId` is set, Upload and Make the draft are off with "Set up the Socials folder in Settings › Google".

**On a phone:** the same pages, with a three-column grid and a bottom bar while photos are picked.

### Fakes and fixtures
**`fakes/fake-drive/server.ts`:**
- `PATCH /files/:id` takes `name`, `addParents`, `removeParents` and `trashed`.
- `GET /files/list` serves `list` (parameters above).
- `GET /files/:id` returns `imageMediaMetadata`, `thumbnailLink`, `modifiedTime` and `capabilities`. `POST /files` and every PATCH set `modifiedTime`.
- `GET /files/:id/content` serves fixture bytes for the seeded photos.
- `GET /thumbnails/:id?s=` returns a JPEG generated with sharp, upright, sized from `imageMediaMetadata` after rotation, with the long edge equal to `s`.
- `POST /__scenario` (as in fake-meta) takes:
  - `{ failMove?: n }`: the nth move fails with a 500;
  - `{ failRename?: true }`;
  - `{ noMove?: true }`: `canMoveChildrenWithinDrive` is false;
  - `{ noThumbnail?: string[] }`.
- **Seed:** a Socials folder (`canMoveChildrenWithinDrive: true`) containing:
  - `Jeff's phone spring 26/` with 6 photos: 2 HEIC; one JPEG with EXIF orientation 6 (`photo-rotated.jpg`); and one with `imageMediaMetadata.time` at 01:30 the day after a seeded past confirmed show;
  - 3 loose photos;
  - a `2026-10` month folder holding one #49 post's photo;
  - a PDF, for the not-empty test.

**`fakes/fake-meta/server.ts`:**
- `POST /:igId/media` takes `is_carousel_item`, `alt_text`, and `media_type=CAROUSEL` with `children` (2–10; otherwise Instagram's error).
- It reports each container's status.
- `__scenario` gains `{ failItem?: n }`, which fails the nth item container.

**`tests/fixtures/`:**
- `photo-rotated.jpg`: 1200×900 stored, EXIF orientation 6 (900×1200 upright).
- `photo-landscape.jpg`: 1600×1000, no rotation.
- HEIC renders from the fake's thumbnail, so there's no HEIC fixture. The HEIC test checks that the output is 1080×1350 and taken from the thumbnail route.

### Phases
Each phase ends with `npm run typecheck` and its tests green.
1. **Data and Drive.**
   - The schema changes, `src/lib/photos.ts`, `DriveService.list/update/trash/thumbnail/canMoveIn` (real and fake), `postFolder.ts`, and the merged `findOrMakeFolder`, with `postsMonthFolder` switched to `.folder`.
   - `signedUrl.ts`, with `media.ts`, `publishPhoto` and the existing media route switched to it.
   - `JPEG`/`JPEG_ONLY` replaced by `photoType`; the fake-drive routes, scenario and seed.
   - *Gate:* `tests/emulator/drive-list.test.ts` (list, update, trash, isEmpty with a PDF, uniqueName, canMoveIn), `tests/unit/signedUrl.test.ts`, `tests/unit/photos.test.ts`; the show-poster, release and recording tests still pass.
2. **Setup.**
   - `posts.setup`, `google.setPostsFolder` clearing `postFoldersId`, `ArtistIn` omitting it, `google.status`, the Settings card, and the upload route into Socials.
   - Then on prod: Set up, then the migration.
   - *Gate:* the setup tests; upload lands in the Socials root; the migration's dry run and `--apply` against the fake seed.
3. **Photos.**
   - `posts.photos`, `posts.list`, the thumb route, the Photos page with day groups, and the Posts tab.
   - `NewPhotoPost` is removed; `publishPhoto` stays, without its card, until phase 5.
   - *Gate:* the `posts.photos` tests; signed thumb tests; a day label naming the seeded past show for the 01:30 photo.
4. **Drafts.**
   - `posts.get`, `createDraft`, `addToDraft`, `updateDraft`, `rename`, `removeFromDraft`, `deleteDraft`, the undo refusal, the dialog and the editor, and the policy changes.
   - *Gate:* the draft, undo and policy tests; the e2e for pick, make the draft, reorder and autosave.
5. **Posting.**
   - Check `alt_text` and the HEIC thumbnail size first.
   - Then the media route `[postId]/[index]` (deleting `[id]`), `publish`, `tidy`, the graph calls, fake-meta, and removing `publishPhoto`.
   - *Gate:* the publish tests and the full e2e.

### Files
**Create:**
- `src/lib/photos.ts`, `src/server/driveFolders.ts`, `src/server/signedUrl.ts`, `src/server/postFolder.ts`
- `src/app/api/posts/thumb/[artistId]/[fileId]/route.ts`, `src/app/api/posts/media/[postId]/[index]/route.ts`
- `src/app/(signed-in)/(app)/artists/[slug]/posts/photos/page.tsx`, `src/app/(signed-in)/(app)/artists/[slug]/posts/[id]/page.tsx`
- `src/components/posts/PhotoGrid.tsx`, `AddToDraftDialog.tsx`, `CarouselEditor.tsx`, `PostDialog.tsx`
- `scripts/migrate-posts-49.ts`
- `tests/emulator/drive-list.test.ts`, `tests/unit/signedUrl.test.ts`, `tests/unit/photos.test.ts`
- `tests/fixtures/photo-rotated.jpg`, `tests/fixtures/photo-landscape.jpg`

**Modify:**
- `src/schema/posts.ts`, `src/schema/artists.ts`, `src/lib/timezone.ts` (`dateTimeInBandZone`), `src/server/integrations/drive.ts`
- `src/server/commands/posts.ts`, `src/server/commands/google.ts`, `src/server/commands/showPosters.ts`, `src/server/commands/releases.ts`, `src/server/commands/people.ts` (`ArtistIn`)
- `src/server/meta/graph.ts` (`createImage` gains `alt?`; adds `createCarouselItem` and `createCarousel`; the comment), `src/server/meta/media.ts`
- `src/server/assistant/policy.ts`, `src/server/undo.ts`
- `src/app/api/posts/upload/route.ts`, `src/app/(signed-in)/(app)/artists/[slug]/posts/page.tsx`
- `src/components/google/FolderCard.tsx`, `src/components/google/shared.tsx`
- `fakes/fake-drive/server.ts`, `fakes/fake-meta/server.ts`
- `apphosting.yaml` (`SIGNED_URL_SECRET`), `package.json` (`sharp`, `migrate:posts-49`)
- `tests/emulator/posts.test.ts`, `tests/e2e/posts.spec.ts`

**Delete:** `src/app/api/posts/media/[id]/route.ts`

**Existing tests:**
- **`tests/emulator/posts.test.ts`:**
  - The token expiry and renewal tests and the 403 role check move from `publishPhoto` to `publish`.
  - The media-URL test moves to the `[postId]/[index]` route and `signUrl`.
  - The month-folder and JPEG-only upload test becomes the Socials upload test.
  - The `publishPhoto` tests are deleted with the command.
- **`tests/e2e/posts.spec.ts`:**
  - The connect and re-sign-in tests (lines 73–100) stay, checking that **Post now** is off.
  - The `NewPhotoPost` flow (lines 102–168) is replaced by the e2e below.

### Done when
**On prod:**
- Settings › Google › Set up makes `Socials/Posts`, and the migration has moved the #49 posts into it.
- Jeff drops a phone folder of HEIC photos into Socials from the Drive app on his phone. They show in Posts › Photos under their day, with the show named.
- He picks 5 photos and presses Add to carousel draft. Drive shows `Posts/DRAFT - <name>` holding them, and they're gone from the inbox.
- He reorders them, writes a caption and adds alt text to one, all autosaved. Post now puts the carousel on Instagram in his order, cropped 4:5 as the editor showed. The folder is now `Posts/YYYY-MM-DD - <name>`. (Delete the post in the Instagram app afterwards.)
- Taking a photo out of a draft puts it back in its folder. Deleting a draft puts them all back and trashes the empty folder.

**Emulator tests** (`tests/emulator/posts.test.ts` unless named):
- **`setup`:** made vs found; a second run; Socials shared as writer; refused when `noMove` is set.
- **`createDraft`:**
  - Moves the photos and records `from`.
  - Refuses a photo outside Socials, or one already in a post (naming the post).
  - A folder name clash gives " (2)".
  - `failMove: 2` undoes the first move and trashes the empty folder, with no doc left.
- **`addToDraft`:** appends the photos; enforces the cap of 10; `failMove` moves back only this call's photos.
- **`updateDraft`:** the patch shape; the whole `items` map; a `baseRev` conflict; more than 30 hashtags refused; refused once posted.
- **`rename`:** renames the folder; a clash gives " (2)".
- **`removeFromDraft` and `deleteDraft`:**
  - Each photo goes back to its own folder, or the Socials root when that folder is gone.
  - Removing the last photo is refused.
  - A folder holding the seeded PDF is left.
  - A failed move partway keeps those photos in the draft.
- **Undo:**
  - `undoRun` refuses a run of `createDraft`, `rename`, `removeFromDraft` or `deleteDraft`.
  - It reverts an `updateDraft` caption edit.
- **`publish`:**
  - Call order for one photo vs a carousel.
  - `failItem` leaves the post `failed` with Drive untouched; a failed post can be published again.
  - A second publish is refused while one is publishing.
  - `failRename` sets `driveTidy`; `tidy` clears it, and a second `tidy` returns `{ ok: true }`.
  - Token renewal before posting, and the 403 for members.
- **The media route:**
  - `photo-rotated.jpg` comes out as 1080×1350 and upright.
  - `focus` moves the crop.
  - A HEIC renders from the thumbnail; with `noThumbnail` it gives its error.
- **Signed URLs** (`tests/unit/signedUrl.test.ts`): expired; wrong signature; another band's file; the same URL within the hour; a missing secret on a real project gives 503.
- **`posts.photos`:** walks nested folders; skips `Posts/`; refuses a folder outside Socials; newest added first across batches; caps at 2,000; puts the 01:30 photo on the previous day.
- **`posts.get`:** flags a trashed photo.
- **Migration:** the dry run changes nothing; `--apply` moves the #49 photo into `YYYY-MM-DD - <title>`; a second run changes nothing.
- **Policy:**
  - Posts commands are offered to Roadie.
  - `publish` and `setup` ask for a confirm and need a tap.
  - An `updateDraft` with 7 ids in `order` doesn't ask for a confirm.

**E2E** (`tests/e2e/posts.spec.ts`, Graph stubbed):
- Pick 5, Make the draft, reorder, the caption autosaves, Post now; the fake Drive shows `YYYY-MM-DD - <name>`.
- Delete a draft, and the inbox has its photos back.
- Upload lands in Socials.
- Make the draft is off until Set up has run.
- Post now is off while Instagram isn't connected.
- Members don't see Posts.

`npm run typecheck` is clean.

### Decided
See the [decision log](https://github.com/zilkey/roadie-issues/issues/75#issuecomment-6802964109). The decisions not stated elsewhere in this document:
- Undo covers Firestore edits only, never Drive moves.
- The #49 posts are migrated into `Posts/`.
- Only hold and confirmed shows label a day.
- Facebook waits for Stage 2; this story posts to Instagram only.
