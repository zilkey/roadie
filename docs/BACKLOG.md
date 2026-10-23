# Backlog

Things that are decided but not done. Newest first within each group. Take an item off when it's done.

## Before or at go-live

- **Deploy indexes and TTL policies.** `npx firebase deploy --only firestore:indexes --project roadie-prod-iab` deploys `firestore.indexes.json`, including its TTL field override on `mutations.expiresAt`. Then check Console → Firestore → TTL that the policy shows as active. TTL deletes run within about 24 hours of expiry, not instantly. It now also carries the TTL on `unsubmittedDrafts.expiresAt` (drafts and unsaved edits expire after 30 days; until the policy is active the app ignores expired ones when listing). Any other TTL fields added later (chat messages) go in the same file and get the same check.
- **Deploy the history indexes and migrate old history.** The same `firestore:indexes` deploy creates the collection-group indexes the History page, `history.undoRun` and `history.myRuns` need (they build for a few minutes; the page shows an error until then). Then run `npm run migrate:history -- --dry-run` and `npm run migrate:history -- --yes` once against production (docs/BACKUP.md), after deploying the new rules and code.
- **Watch for missing-index errors** after first real use: the member ledger query and anything the History page asks for. Click the link in the error, then copy the result into `firestore.indexes.json`.

## Saving (Definition of Done)

- **Typo guard on money.** An amount ten times the usual for its category asks "Did you mean $50?" before saving.
- **Roadie and MCP writes skip double-tap protection.** They don't send `clientMutationId`.
- **Drive picks aren't kept in drafts** for a new song or rehearsal, because `DrivePicker` holds its selection internally.

## Roadie

- **Still missing:** images, the mic, high-fives, the thread list and pruning, and the "Roadie couldn't" gaps list (`gaps.report`).
- **Confirm card Edit.** Yes and Cancel work; "Edit (open the draft in the page)" is not built.
- **Flash the changed field.** The open page should flash a field Roadie just changed, labeled "Roadie · just now" (from `updatedVia` / history actor `via === "assistant"`).
- **Only send the tools the band has on.** Roadie sends every eligible command's definition on every call (`toolDefs` in `src/server/assistant/tools.ts`).
- **Gemini path untested.** Tools are the same, but nobody has checked the generated JSON Schemas against a real model, or the cost of ~90 definitions per call.
- **Bulk check guesses from the input** (an array of more than 5). It should count the records a command would touch.
- **Roadie calls commands through its own runner** (`src/server/assistant/run.ts`), not `dispatch`, so no `_meta` (idempotency, baseRev). Fold into `dispatch` with an exported "run with this Ctx" if wanted.
- **Prefs writes show up in History.** Width and thread changes go through `db.update`. Consider a direct write like `touchLastUsed`.
