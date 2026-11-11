# Comprehension Report: Stage 6

**Target:** `docs/designs/posts-carousels/design.md` (FeatureRange 1–36, DetailedRange 37–147)
**Reviewer:** `egm-comprehension` (completed). It read the document alone, with no codebase and no canvas.

**What this proposes**

Roadie, a band-management app, gets a Drive folder layout for social-media photos. Under the band's "Posts" folder there are three subfolders. Ideas is a dump folder that every bandmate can write to. Drafts holds one folder per carousel draft. Posted holds one folder per month, with one folder per published post inside it. Which folder a photo sits in tells you where it is in its life, so nobody has to tag anything by hand. Admins browse photos in a new Posts › Photos tab, grouped by the day they were taken, with that day's show or rehearsal named. They multi-select photos and press "Add to carousel draft". That moves the photos into `Drafts/<name>`, or adds a Drive shortcut for photos outside Posts or ones Drive won't let Roadie move. Admins then edit the draft (order, crop focus, alt text, aspect ratio, caption, all autosaved) and publish it to Instagram only, as a carousel. After posting, Roadie numbers the files, renames the folder `YYYY-MM-DD <name>` and moves it to `Posted/YYYY-MM`. Each photo's status is also stored in Drive `appProperties` so the grid can show badges. The `posts` Firestore doc stays the source of truth.

**How the existing system works, per this document**

Roadie already has a Posts feature (from #49) that posts a single photo now (`posts.publishPhoto`). Uploads currently go into month folders (`postsMonthFolder`), and Meta fetches photos through a signed `/api/posts/media` route. An artist has a configured `postsFolderId`, set in Settings › Google. There is a `DriveService` with a real and a fake implementation, and a helper `findOrMakeFolder` in the show-posters command. A `posts` collection is readable by admins and written by the server. There is an autosave helper, a drag-reorder helper, and fakes for Drive and Meta. Posts is admin-only, and the client already loads the band's calendar.

## Findings

No section was impossible to paraphrase, so there are no Blockers. The FeatureRange (lines 1–36) is clear and self-contained apart from finding 2. Most gaps are in the DetailedRange: what Roadie touches outside the Posts tree (findings 1 and 3) and how a photo's status changes when it is reused (finding 4).

### 1. What "numbering the files" does to shortcuts is unclear - Severity: 🟡 Major
* **Affected Scope:** lines 31, 33, 54, 82, 132
* The "Done when" list expects `Posted/.../<name>` to hold `01`–`05`, and one of those five is the poster that was added as a shortcut. The doc never says whether publishing renames the shortcut or its target file. The target lives outside Posts, in a show folder, and may be owned by someone else.
* `appProperties` go on "a shortcut's target, not the shortcut" (line 54), which suggests Roadie writes to files it doesn't own. The doc doesn't say what happens when that write is refused, as it does for moves in the ownership case (line 35).
* A reader can't tell which files Roadie touches outside the Posts tree.

### 2. Project roadmap terms are used without saying what they mean - Severity: 🟡 Major
* **Affected Scope:** lines 3, 19, 35, 43, 83–84, 117, 120
* The doc relies on "Stage 2 / 3 / 6 / 7", "Drive 1 / 2 / 3", "#53's Content slot", "fixed sub-slots … in `driveLayout`" and "#53's principle". The issue numbers are given, but a reader still can't tell what a "slot" is, whether `driveLayout` exists yet, or what the Drive 1 audit measures.
* Line 43 ("these three become fixed sub-slots … Nothing else changes") is the claim that most needs this context, and it can't be checked from the doc alone.
* Fix: one line per term, for example "Drive 2 = a planned per-artist map of named Drive folders".

### 3. "Show folders" and the "shows" source are assumed - Severity: 🟡 Major
* **Affected Scope:** lines 31, 69, 131
* `posts.photos` takes `folder: "shows"`, and the acceptance test picks "a poster from a show folder". The doc never says what show folders are, where they live, or how Roadie finds them; it only hints that `showPosters.ts` creates folders.
* A new reader can't tell whether "shows" is one folder, one folder per show, or something derived from the calendar.

### 4. Reusing a posted photo, and what "Not in a post yet" covers, are not stated - Severity: 🟡 Major
* **Affected Scope:** lines 29, 69, 72, 132
* The doc says a photo already in a draft is refused. It doesn't say what happens when someone picks a photo that is already in Posted, for example to repost it, or picks from the Posted folder view: is it moved out of Posted, given a shortcut, or refused?
* It's also unclear whether `notInPost` / "Not in a post yet" leaves out photos that are only in a draft, or only posted ones. Line 132 implies posted ones; drafts are ambiguous.

### 5. One-photo drafts, `kind` and `publishPhoto` - Severity: 🟢 Nit
* **Affected Scope:** lines 59, 79, 85
* `posts.publish` handles "a draft of one photo or a carousel", and `kind` is `photo | carousel`. The doc doesn't say whether a one-photo draft gets `kind: photo` or `carousel`, or whether publishing it uses a `CAROUSEL` container (Instagram needs 2 or more children) or the `publishPhoto` path. The 1–10 range on `media[]` makes this a real case.

### 6. The memory decision is left open - Severity: 🟢 Nit
* **Affected Scope:** line 97
* "Set `runConfig.memoryMiB: 1024` … or render the photos one at a time" reads as two options, not a decision. Say which one is chosen, or that no change is needed.

### 7. Some data fields and terms are undefined - Severity: 🟢 Nit
* **Affected Scope:** lines 35, 40, 50, 63, 89
* `media[].url`: is it the Drive file, the signed render URL or the thumbnail? `from.moved` is understandable but never explained.
* "Artist", "band", "band account" and "band token" are used interchangeably. The doc never says that one artist is one band, or which Google account "the band account" is.
* "Every bandmate" (line 40): it's unclear where their Google identities come from to share Ideas with them.

### 8. Where drafts are listed is not stated - Severity: 🟢 Nit
* **Affected Scope:** lines 11, 100–101
* Posts gets two tabs, Posts and Photos, and drafts open at `/posts/[id]`. The doc never says where a user finds the list of existing drafts, or where "add to an existing one" (line 11) gets its list from.

### 9. The UI depends on boards a reader can't see - Severity: 🟢 Nit
* **Affected Scope:** lines 9–15
* "Build from these boards and add nothing they don't show" makes the linked canvas the spec for UI behaviour. The Design section summarises the boards well enough to follow, but some items, such as the "checks that warn about blank alt text", are known only by name.
