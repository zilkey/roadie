# Goldfish Review Report: Stage 8, Intermediate Zoom Out

**Target:** `docs/designs/posts-carousels/design.md` (lines 1–147, full file), read together with the stage 5–7 reports
**Standard:** `zoom-out-standard`

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-zoom-out` | completed |

**Verdict: passes with changes.** Context and root-problem focus still pass. The risk is in the earlier recommendations: applied in full, they add a reconciler, a multi-post marker, two render paths, lazy repairs and a second file. Applied as the subset that removes things, the design gets smaller and most other findings go away. The test to use: does the change make the `posts` doc more authoritative and Drive a simpler mirror?

## Prioritized Findings (Blockers -> Major -> Nits)

### Use the subtractive recommendations as one change - Severity: Major
* **Affected Scope:** lines 29–35, 49, 53–55, 59, 63, 73, 77, 82, 85
* **Discrepancy Description**: Dropping appProperties (stage 5) also resolves stage 7's "reusing a posted photo" (there's no longer a one-post marker to overwrite) and half of stage 6 #1 (Roadie stops writing to shortcut targets it may not own).
* **Rationale & Recommendation**: Adopt these together:
  * (a) Drop appProperties, and work out the badges and "Not in a post yet" from the `posts` docs.
  * (b) Use one move rule: "Photos in Ideas are moved when Drive allows; anything else (outside Posts, in Posted, or a move Drive refuses) gets a shortcut."
  * (c) State the invariant: Roadie only moves files out of Ideas, and only creates, renames or trashes things inside Drafts and Posted. At publish it numbers the shortcut, not its target.
  * (d) Merge the publish paths and drop `kind`.

  The result is shorter than today's text.

### Keep the explicit tidy retry; reject the lazy repair - Severity: Major
* **Affected Scope:** lines 33, 65, 82
* **Discrepancy Description**: Stage 5 offers re-running the tidy from `posts.photos`, while stage 7 wants the tidy-failed outcome in the spec. A list command that writes to Drive is wrong: it slows the grid and hides failures.
* **Rationale & Recommendation**: Keep `driveTidy.error`, the idempotent `posts.tidy` and a retry on the post's page. Add one line to the spec and one state to the Post/Posted board.

### Three recommendations together build a sync engine; don't - Severity: Major
* **Affected Scope:** lines 29–34, 72–78
* **Discrepancy Description**: The stage 5 per-draft reconcile command, stage 7's drift detection and stage 7's partial-failure risks would together become a general Drive-to-doc reconciler. That's speculative for a band with one or two admins.
* **Rationale & Recommendation**: Two lines are enough. (i) The doc wins: opening a draft checks each of its at most 10 files and flags any that are missing or trashed, with a Remove action. (ii) Delete draft trashes the folder only if it's empty; otherwise it leaves the folder and says so. Keep `createDraft`'s in-request undo.

### Thumbnail rendering means dropping the HEIC fallback - Severity: Major
* **Affected Scope:** lines 50, 92–97
* **Discrepancy Description**: Rendering from Drive's thumbnail while keeping the original-download fallback for HEIC keeps `heic-decode`, the memory question and the fixture, so there would be two render paths.
* **Rationale & Recommendation**: Choose one. Either render from the thumbnail (originals only for JPEG, PNG and WebP; a HEIC with no thumbnail fails with a clear message), or keep the current design with `memoryMiB: 1024`. First confirm that Drive's maximum thumbnail size covers 1080×1350.

### Cap the structural fixes: move text rather than add it - Severity: Major
* **Affected Scope:** whole document; stage 7's structure Blockers and Majors; stage 6 #2
* **Discrepancy Description**: Applied literally, the fixes add five H2 sections, a glossary and possibly a second file, which could double the doc without changing the design.
* **Rationale & Recommendation**: Alternatives become five one-line rejections. Risks become about six lines gathered from lines 33–35 and 82 plus the platform limits. Make "The ask" a blockquote. Point to "Done when" as the goals instead of adding a Goals section. Use `## Feature spec` / `## Implementation plan` in the same file. One glossary line per roadmap term. Stage 7's Blockers are real gaps, but each closes in under ten lines.

### Record the alternatives as rejected; don't reopen them - Severity: Nit
* **Affected Scope:** stage 7, "No alternatives were considered"
* **Discrepancy Description**: Each alternative already has a short answer.
* **Rationale & Recommendation**:
  * Shortcuts only contradicts the ask ("moves the photos").
  * Firestore-only status is what the design becomes after the bundle above.
  * Drive Labels needs Workspace admin setup.
  * Copy instead of move duplicates bytes.
  * Requiring a Shared Drive adds a setup step that the shortcut fallback already covers.

  Use the wording "folders are a best-effort mirror; Roadie's view is authoritative".

### `kind` is a derived field - Severity: Nit
* **Affected Scope:** line 59; `src/schema/posts.ts`
* **Discrepancy Description**: Once publish is merged, `kind` is the same as `media.length === 1`, so storing it means a default rule and a field that can disagree with the media list.
* **Rationale & Recommendation**: Drop it and branch publish on `media.length`.

### The Drive 2 promise on line 43 is speculative - Severity: Nit
* **Affected Scope:** line 43
* **Discrepancy Description**: `driveLayout` doesn't exist in `src/`, so "Nothing else changes" can't be checked.
* **Rationale & Recommendation**: Delete the line, or reduce it to "Drive 2 (#55) may later own these folder ids."

### List the canvas items being cut - Severity: Nit
* **Affected Scope:** stage 5's "Canvas items with no place", stage 7's "Boards disagree", line 9
* **Discrepancy Description**: "Add nothing they don't show" doesn't mean building everything they show.
* **Rationale & Recommendation**: Keep the per-day Select all, which is client-only. Cut Search all of Drive, the extra sorts, the quota counter and the video copy as "not in this story", under one list titled "Deliberate differences from the canvas".

### Check whether Posts is in a Shared Drive - Severity: Nit
* **Affected Scope:** line 35; `src/server/integrations/drive.ts:107`, `docs/FIREBASE-SETUP.md:81`, `docs/STATUS.md:45`
* **Discrepancy Description**: The code and docs suggest the band folder may already be in a shared drive. If it is, the My Drive ownership refusal may never apply.
* **Rationale & Recommendation**: Check where the production Posts folder lives, and size the ownership caveat to that answer instead of waiting on #54.

### YAGNI calls on stage 5 items - Severity: Nit
* **Affected Scope:** stage 5 Nits and Majors
* **Rationale & Recommendation**: Decline the listing cache until #54 shows the volumes. Accept the `files.update` merge, the `findOrMakeFolder` merge and the rounded `exp` on signed URLs, all small changes to existing code.

## Not flagged
* Reusing `autosave.ts`, `drag-reorder.ts`, `signMediaUrl` and `bandmates()` is right.
* The Settings setup step and the stored folder ids are on the board, so they aren't scope creep (the button wording still needs the stage 7 fix).
* Rendering on each request and storing nothing outside Drive remains sound.
