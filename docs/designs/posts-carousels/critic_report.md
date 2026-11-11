# Goldfish Review Report: Stage 7, Critic Review

**Target:** `docs/designs/posts-carousels/design.md` (FeatureRange, lines 1–36)
**Standards:** `feature-spec-standard` (design, structural); the style persona's own rules
**GoldfishContext:** `canvas/project/` (8 boards), the roadie codebase

## Reviewer Status

| Reviewer | Status | Verdict |
| --- | --- | --- |
| `egm-design` | completed | does not pass: 1 🔴 · 6 🟡 · 3 🟢 |
| `egm-structural` | completed | FAIL: 2 🔴 · 3 🟡 · 5 🟢 |
| `egm-style` | completed | passes with changes: 0 🔴 · 5 🟡 · 10 🟢 |

Deduplicated below: 2 🔴 · 11 🟡 · 12 🟢.

## Prioritized Findings (Blockers -> Major -> Nits)

### No alternatives were considered - Severity: Blocker
* **Reviewer Lens:** `egm-design`, `egm-structural`
* **Affected Scope:** lines 17–35 and the whole spec range; "Decided" (lines 122–127)
* **Discrepancy Description**: The spec gives one path: move files between Ideas, Drafts and Posted, mark them with appProperties, and fall back to shortcuts. It never weighs that against other designs. "Decided" records choices without trade-offs and credits them to "Jeff, Nov 11" with no link to where they were decided.
* **Rationale & Recommendation**: Add an Alternatives Considered section with a concrete reason for rejecting each option: shortcuts only and never move (removes the ownership failure and the undo complexity, but loses the clean folder story; this one most needs an answer), status kept in Firestore only with no moves, Drive Labels, copy instead of move, and requiring a Shared Drive. Link where each decision was made.

### No Risks & Mitigations section - Severity: Blocker
* **Reviewer Lens:** `egm-structural`, `egm-design`
* **Affected Scope:** lines 1–36; the only risks are inside bullets at lines 33–35
* **Discrepancy Description**: The spec misses several risks. Ideas is writer-shared with every bandmate, so anyone can delete or move anyone's photos. Member uploads count against each uploader's own Drive quota. Instagram's daily publishing cap (shown on the Post board) and the 10-photo carousel cap aren't stated. Partial failures aren't covered, such as an interrupted multi-file move or a post that goes out while the Drive tidy fails.
* **Rationale & Recommendation**: Add a Risks & Mitigations section covering security, quota, platform limits and partial failures, and move the risk bullets from lines 33–35 into it.

### The core rule is broken by the spec's own exceptions - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** line 29 compared with lines 31 and 35
* **Discrepancy Description**: "Where a photo sits says where it is in its life" fails for photos outside Posts (never moved) and photos Drive refuses to move (they stay in Ideas). After posting, those photos still sit in Ideas, which says "unused". The cross-owner case (Dean's phone dump) is the one the ask itself describes, so it may be the common case.
* **Rationale & Recommendation**: Weaken the rule to what is guaranteed ("Roadie's view is authoritative; folders are a best-effort mirror"), or require a Shared Drive. Say what a band member sees in the Drive app in the fallback case, and set a threshold from the #54 audit above which the design changes.

### Edits made directly in Drive aren't handled - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** lines 29–34; the Layout board's "the folders make sense without Roadie"
* **Discrepancy Description**: The spec invites people to work in the Drive app but never says what happens when someone drags a photo out of a draft folder, trashes a photo that's in a draft, renames a draft folder, or drops their own file into one. In the last case Delete draft finds a folder that isn't empty, so "trash the empty folder" no longer applies.
* **Rationale & Recommendation**: Say which side wins (the `posts` doc, per line 55), how Roadie detects drift and tells the user (for example "IMG_4412 is no longer in Drive"), and what Delete draft does with a folder that isn't empty.

### Reusing a posted photo is undefined - Severity: Major
* **Reviewer Lens:** `egm-design` (also stage 6)
* **Affected Scope:** lines 29–33, 54
* **Discrepancy Description**: Posted sits inside Posts, so by line 30 a photo picked from Posted would be moved out of its posted folder, which damages the record of the earlier post. The appProperties hold only one post, so a second post would overwrite the first.
* **Rationale & Recommendation**: Either posted photos can't be picked, or they are always added by shortcut and the marker can hold several posts.

### It's unclear who creates Ideas - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** lines 10 and 19–22, the Settings board, line 40
* **Discrepancy Description**: The button says "Set up Drafts and Posted", and the board shows Ideas as already "Working". Upload and Add to carousel draft stay off until Ideas exists, but nothing in the spec makes Ideas. The architecture (line 40) says setup makes whichever folders are missing.
* **Rationale & Recommendation**: Say that setup finds or makes all three folders, and rename the button or change the board to match.

### The boards disagree with the spec - Severity: Major
* **Reviewer Lens:** `egm-design` (also stage 5)
* **Affected Scope:** line 9 ("add nothing they don't show"), lines 11, 13 and 32
* **Discrepancy Description**: The Layout board says "Photos and video both land here", but video is Stage 7. The Post board shows **Pick a time**, which is deferred to Stage 3, and an Instagram quota counter the spec doesn't mention. The Edit board says × puts a photo back in Ideas, while line 32 says "back where it came from". The Photos board has Search all of Drive and a Newest added first sort. The canvas is also an external artifact that can drift from the repo copy.
* **Rationale & Recommendation**: List each place where the spec deliberately overrides a board, or fix the boards.

### The spec's headings are wrong and the required sections are missing or misnamed - Severity: Major
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** line 1 followed by lines 5, 8, 17 (and 37, 116, 122, 129)
* **Discrepancy Description**: The H1 is followed directly by H3s, with no H2 level. The spec has no Problem Statement (only "The ask"), no Goals, and no architecture summary in the spec range. Non-goals ("Not in this story"), decisions and "Done when" all sit after Architecture, outside the spec range (also flagged by `egm-design`).
* **Rationale & Recommendation**: Make the sections H2s, structured as Problem Statement, Goals & Non-Goals, Proposed Design, Alternatives Considered, and Risks & Mitigations. Bring the non-goals and a summary of "Done when" into the spec section, or point to them from it.

### Nothing marks where the spec ends and the plan begins - Severity: Major
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** lines 36/37
* **Discrepancy Description**: "### Architecture" sits at the same heading level as the spec's own sections, so nothing in the document says lines 37 onward are the implementation plan.
* **Rationale & Recommendation**: Wrap the two parts in `## Feature spec` and `## Implementation plan`, or split the plan into its own file.

### "A layout that keeps itself tidy" overpromises - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** lines 3, 29–33
* **Discrepancy Description**: Ideas is never tidied ("any folder names, loose files fine"). Roadie keeps only Drafts and Posted in order, and only Roadie's actions do it, not the layout.
* **Rationale & Recommendation**: Say instead: "a Drive layout in which Roadie files Drafts and Posted; Ideas stays freeform."

### "The ask" uses opinion words and can't be measured - Severity: Major
* **Reviewer Lens:** `egm-style`, `egm-structural`
* **Affected Scope:** line 6
* **Discrepancy Description**: "Cesspool" and "really easy" are judgments with no test, and the paragraph isn't marked as a quote, so it reads as the spec's own goal statement.
* **Rationale & Recommendation**: Make it a blockquote of the request, and restate the goals so they can be checked (line 29 already has two: nobody renames or tags by hand, and every photo's state can be read).

### The numbering rule is a placeholder - Severity: Major
* **Reviewer Lens:** `egm-style` (also stage 6)
* **Affected Scope:** lines 27, 33; tests at lines 137 and 142
* **Discrepancy Description**: "01 …" doesn't say whether the original filename is kept, what separator is used, whether the extension survives, or how a shortcut is named, yet tests check against it. The Layout board implies `NN <original name>`.
* **Rationale & Recommendation**: State the pattern, for example "`NN <original filename>`, two digits, starting at 01, in carousel order", and how shortcuts are named.

### The outcome where the post goes out but the Drive move fails is missing - Severity: Major
* **Reviewer Lens:** `egm-style`, `egm-design`
* **Affected Scope:** line 33 compared with line 82
* **Discrepancy Description**: The spec covers only two outcomes: success with everything moved, and failure with nothing moved. The third (posted, but the Drive tidy failed) appears only in the architecture section.
* **Rationale & Recommendation**: Add the user-facing behaviour to the spec, or drop it to match the canvas (stage 5, Major 4).

### The Shared Drive and ownership caveats aren't actionable - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** line 35
* **Discrepancy Description**: "The Drive 1 audit says how often" gives no number. "A Shared Drive makes it go away" is stated as certain, but moves there need the band account to be Content manager or higher. "Drive can refuse to move" hedges a condition that is known.
* **Rationale & Recommendation**: Say "frequency unknown until #54", name the decision that depends on it, narrow the Shared Drive claim, and state the refusal as a rule.

### Nits
* Dates use undefined timezones: day grouping uses EXIF time, so photos from after midnight at a late show fall on the next day. "The day it posted" and `Posted/YYYY-MM` could be in UTC or the band's local time. Use the band's timezone. (`egm-design`)
* Moving off the old layout: the existing `Posts/YYYY-MM` upload folders sit beside Ideas, Drafts and Posted, and the spec doesn't say how they appear in Photos, or what Settings › Change does to the three saved folder ids. (`egm-design`)
* Board references are inconsistent: item 3 doesn't cite *Edit the carousel*, and the short names vary. (`egm-structural`, `egm-style`)
* Issue references (#19, #53, #54, #75) are plain text, not links. (`egm-structural`)
* The code fence has no language tag, and trailing `/` on folder names is inconsistent. (`egm-structural`)
* Roadmap terms (Stage 6, Content slot, Drive 1/2/3) aren't defined, and line 3 ties the Content slot to #53 while line 19 ties it to Drive 2 (#55). (`egm-structural`, `egm-style`; also stage 6)
* "Dean's phone upload into Ingrid's Ideas" uses names a reader can't place. Use roles instead. (`egm-style`)
* "Caption with counts": say it's characters (of 2,200) and hashtags (of 30), as on the Edit board. (`egm-style`)
* "Autosaved, with Done": say that Done returns to Photos, so nobody reads it as a save button. (`egm-style`)
* "Moves the photos from Ideas" needs "(exceptions below)", and "back where it came from" needs "(Ideas, if that folder is gone)". (`egm-style`)
* Removal verbs differ between "removes" and "trashes". Use "trashes" throughout. (`egm-style`)
* "This canvas wins" is informal; use "takes precedence". "Reorder, text" should be "reorder, caption, alt text". (`egm-style`)
