# Status

Consolidated after the final pass. Spec: `docs/blueprint.html`; conventions: `PLAN.md`; how to run: `README.md`; going live: `docs/FIREBASE-SETUP.md`.

**Test state:** `npm run typecheck` clean; `npm test` 95 unit and rules tests pass; `npm run e2e` 29 Playwright specs pass (run twice in a row, no flakes). Everything runs offline against the emulators and the fakes. Nothing has ever been run against a real Firebase project or a real Google/Bandsintown/Spotify API.

## What is built, by area

**Foundation**
- Next 16 app, phone bottom tabs and desktop sidebar, light and dark. Members see Home, Shows, Songs, My money; admins also get Booking, Money, Stats, and the People/Admin pages.
- Zod schema for every collection (strict). `src/server/db.ts` is the only write path: stamps common fields, writes `history` (diff + runId), dedupes on `matchKey`, soft delete, atomic multi-write runs. Ledger, statSnapshots and history are immutable.
- Command registry with roles `admin | member | mcp`, `POST /api/commands/[name]` with Firebase ID token, structured errors with Zod issues.
- Auth: Google sign-in; `/api/session` looks the email up in `users` (invite only) and sets custom claims `{role, musicianId}`; "not invited" page. Dev "Sign in as" buttons when emulators are on.
- `firestore.rules`: reads per the access table, all client writes denied; rules tests.
- People admin: users, musicians, artist configurations ("billed as"), gear and sound gear.

**Booking** (admin): venues, promoters, festivals + editions, contacts with one-search box, Pitch List (status flow, assignee, next step, comments, calls, timeline), flag-to-pitch buttons, email templates with fields (incl. Spotify numbers), send email via Gmail and "check for replies".

**Shows**: Booked it (show + private deal in one transaction), billed-as/personnel/sound/needs, checklist from templates, gear and who brings it (packed boxes), Google Calendar event with attendees, Bandsintown listing (public + confirmed only), availability asks (members in-app, subs by hashed no-login link, reminders), after-the-show rating, Home logic ("How Home decides").

**Music**: songs with Drive files (search, kind/key, sharing check, "copy to band folder", "share with band"), inline playback where the URL allows, setlists (drag + buttons, total vs set length, attach to a show), rehearsals.

**Money + Reach**: ledger (income, spending, payouts, reimbursements, corrections with `reversesId`), expenses and receipts (Drive link), owed per person, settle a show (income + payouts atomically), My money for members, SVG charts, Stats page (Spotify current numbers + charts, Pull now, Spotify for Artists CSV import), `npm run stats:pull`.

**Safety net**: MCP server (HTTP :3300 and stdio; tool per `mcp` command plus read tools; bearer tokens hashed in `mcpTokens`, revocable live); drafts-only email; History page with filters and "Undo this run"; AI keys page; backup/restore scripts and a nightly workflow (never run).

**Final pass**: one timezone constant (`src/lib/timezone.ts`, America/Denver) for "today", date-stamped ledger/expense rows, show-time display, and the Calendar and Bandsintown payloads (`timeZone` field); screenshots in `docs/screenshots/`; `scripts/bootstrap-admin.ts`.

## What is faked, and where

| Service | Fake | Interface (swap point) |
| --- | --- | --- |
| Gmail | `fakes/fake-gmail` :3201 | `src/server/integrations/gmail.ts` |
| Drive | `fakes/fake-drive` :3202 | `.../drive.ts` |
| Calendar | `fakes/fake-calendar` :3203 | `.../calendar.ts` |
| Bandsintown | `fakes/fake-bandsintown` :3204 | `.../bandsintown.ts` |
| Spotify | `fakes/fake-spotify` :3205 | `.../spotify.ts` |

Each client is plain HTTP aimed at `<SVC>_BASE_URL` (defaults to the fake). **No real implementation exists for any of them.** The sending account for Gmail is just the admin's login email; Drive has no per-user view in the fake. Firebase itself is the emulator (`demo-band-tracker`). Spotify charts start empty on a real account because the real API has no history. The seed data (`scripts/seed.ts`) is demo content.

## Known gaps

- No real Google/Bandsintown/Spotify clients, no OAuth connect flow, no stored refresh tokens (see FIREBASE-SETUP step 5 and 6).
- No scheduled job exists for the daily Spotify pull (script only) and none was ever run for backup.
- Real Drive: group, domain or "anyone with the link" sharing is not modelled in the sharing check. PDFs are skipped in Drive search on purpose.
- Calendar: attendee responses can't be simulated; sub-musicians without email are not invited.
- Sent email is logged after sending in a separate step, so a log failure after a successful send is not recorded. Integration side effects of `users.add` (Auth user, claims) are outside the Firestore transaction.
- Role changes take effect when the person's token refreshes (refresh tokens are revoked on change).
- No UI to edit checklist templates (commands exist), rename configuration ids, enter a per-item note on setlist items, upload receipts (links only), or show settled money on the show page. Show `docs` are title + link. Songs can appear twice in a setlist.
- Money has no year filter. Members can't see other people's availability answers.
- History view reads the newest 100 on the client and sorts client-side; would need `orderBy` + limit + index at scale. The restore script does not delete documents missing from the backup.
- `pitches.checkReplies` is app-only. No "redo" (undo the undo run).
- Fake state in `.fake-data` outlives e2e runs, so specs reset or compare rather than assume empty.
- Not exercised: a real phone, Safari, real Google popup sign-in, production Firestore index needs (member ledger query combines `payeeUserId ==`, `kind in`, `deletedAt ==`; create the index from the console link if asked).

## Decisions for a human to review

1. **Members can read their own payout, reimbursement and correction ledger rows** (`payeeUserId == uid`, kinds payout/reimbursement/correction), so "paid back" and reversals show in My money. Originally payout-only.
2. **Every expense counts as approved.** There is no approval step; an expense is owed to the submitter until an admin marks it reimbursed.
3. **The Spotify for Artists CSV headers are a guess** (date/month + listeners + streams [+ followers], flexible names). Adjust `HEADS` in `src/lib/stats.ts` against a real export. Snapshots are immutable, so re-importing a day or month is skipped, not updated.
4. **Undo does not revert external side effects.** Sent mail, Calendar events, Bandsintown listings and Drive copies stay; ledger entries and stat snapshots are reported as "needs manual correction".
5. **MCP availability asks create drafts** instead of sending (`availability.ask/remind` through MCP). `pitches.sendEmail` is app-only and MCP can only `draftEmail`. MCP can't archive places, songs or shows, or touch users and AI keys.
6. Bandsintown listings are created only for shows that are `public` and `confirmed` (default off). Holds, private, canceled and archived shows are removed.
7. A "played" show is one marked played, or confirmed with a past date; nothing flips status by itself except rating the show.
8. Auth: "one account per email" must stay on; `users.add` pre-creates the Auth user so the first Google sign-in reuses its uid.
9. Times are stored as wall-clock strings (`HH:MM`, `YYYY-MM-DD`) in venue-local time and interpreted as America/Denver for the band's integrations. A show outside Mountain time would need a per-show zone.
10. The auth emulator port is 9319 (not the default 9299), hard-coded in several files (`firebase.json`, `.env.development`, `src/lib/firebase-client.ts`, `package.json`, `playwright.config.ts`, `tests/unit/helpers.ts`, `scripts/seed.ts`).
11. `mcpTokens.lastUsedAt` and restore write outside `db.ts` on purpose (telemetry should not appear in or be undone with an AI run; restore must keep ids and timestamps).
12. `npm run lint` is `tsc --noEmit`; there is no ESLint.
13. `history.diff` is `{field: {before, after}}`, not the blueprint's `[before, after]` (Firestore forbids nested arrays).

## Roadie (slice 8a)

**Built**
- Genkit (`genkit`, `@genkit-ai/google-genai`, dev `genkit-cli`). Flow `assistant.chat` in `src/server/assistant/` (`flow.ts`, model setup in `ai.ts`, canned replies in `script.ts`). `npm run genkit:ui` opens the Developer UI on `src/server/assistant/dev.ts` with the emulator env vars (`ROADIE_MODEL` defaults to `fake`).
- `POST /api/assistant/chat` (`src/server/assistant/chat.ts`): verifies the ID token, admins only (members 403), streams SSE `text | action | navigate | done | error`.
- Named routes in `src/lib/routes.ts`; `ui.navigate` takes a route name + params, never a URL; unknown names fail safely (an action line, no navigation).
- Threads: `assistantThreads/{id}` + `messages/{id}`, written by `threads.ts` with firebase-admin directly (not db.ts, so no history/undo). Rules: owner admin reads, no client writes. Zod in `src/schema/assistant.ts`.
- Panel (`src/components/roadie/`), mounted in `Shell.tsx` for admins: left column on desktop (narrow strip, not closable), pill + bottom sheet on phones, live transcript from Firestore, vamping line (36 spec lines, one static line with reduced motion). Width and thread are saved by command `assistant.setPrefs` into `users.prefs.assistant`.

**Faked**
- `ROADIE_MODEL=fake` is the default under emulators and in all tests: a keyword script (greeting, off-topic, can't-do, "show me the shows" / "go to money" style navigation). No network.
- The Gemini path (`ROADIE_MODEL=gemini`, needs `GOOGLE_API_KEY`) is wired in `ai.ts` but never exercised.

**Gaps**
- No data tools yet (reads/writes through the command layer), no form filling, confirm cards, undo links, images, mic, high-fives, or "plainer Roadie" setting.
- Browser tools are fire-and-forget: the server treats `ui.navigate` as done. `assistant.toolResult` (round trip) comes later.
- Page context sends only route + record id, not open-form state.
- `assistant.setPrefs` goes through db.ts, so width/thread changes show up in the history list as user updates.
- Threads are never pruned and there is no thread list; "New" just starts another.


## Definition of done: saving (slice 8b)

Shared core is in; Shows (`shows/new`, `shows/[id]`, band notes) and the Venue page are converted. How to convert the rest: `docs/AUTOSAVE.md`.

- **Autosave** on existing records (`useAutosave`, `EntityForm autosave`): field-level patches through `<kind>.update`, 800 ms / blur, "Saving… / Saved / Offline · will save", toast with Undo for 10 s, conflict message instead of overwrite.
- **Drafts** for new records (`useDraft`, `EntityForm draft`): device (localStorage) then `users/{uid}/drafts/{draftId}` via `drafts.save` / `drafts.discard` / `drafts.list`; owner-only read in rules; 30-day expiry (ignored when read, deleted on save); Home "Unfinished" card. New records are still created by an explicit button.
- **History**: `rev` on every document (+1 per write; missing = 0); history rows carry `docRev` and `autosave`. Autosave patches by the same person from the app within 2 minutes fold into the previous entry **when that entry already covers the fields** (a different field starts a new entry). A folded save keeps the entry's runId (the doc and the API response report it), so the toast's Undo reverts the whole burst of typing back to the value before it. `history.undoRun` now skips fields edited again since (`skippedFields` / `changedSince` in the report). Commands accept `_meta: {clientMutationId, baseRev, autosave, clearDraft}`; responses are `{result, runId, revs}`.
- **Writes outside db.ts (all documented exceptions)**: `touchLastUsed` (mcpTokens telemetry), `restoreDump` (restore keeps ids and timestamps), `src/server/drafts.ts` (personal scratch), `src/server/mutations.ts` (idempotency bookkeeping), Roadie chat threads (`src/server/assistant/threads.ts`). Nothing else writes Firestore except through db.ts (grep of `src/server`, `mcp`, `scripts`).
- **Ops to do before production**: deploy `firestore.indexes.json` (history `entity.id` + `docRev desc` composite index; TTL policy on `mutations.expiresAt`). Backups skip drafts and mutations.
- **Booking + Admin converted** (autosave = existing record, draft = new record with an explicit Add button, action = stays a button):
  - `booking/venues/[id]`, `promoters/[id]`, `festivals/[id]`, `editions/[id]`, `contacts/[id]`: edit = autosave (`EntityForm autosave`, toggle says Done). Flag, Archive, link/unlink promoter or contact = actions.
  - `festivals/[id]` "Add a year": draft (`edition`, context `festival:<id>`), opens by itself when a draft exists.
  - `booking` add venue / promoter / festival / contact: drafts (context `new`), the form opens by itself on return from Home's Unfinished card.
  - `booking/pitches/[id]`: Pitching as, Who's on it, Who's handling it and Next step = autosave (`pitches.update`; a half-filled next step is held with "Not saved"). Comment and Log a call = drafts (`pitchComment`, `pitchCall`, per pitch) with Post / Log call buttons. Status moves, Email, Check replies, Remove, Booked it = actions.
  - `booking/templates`: existing template = autosave (Done button closes); new template = draft with Add template.
  - `admin/musicians`: existing rows autosave (Edit opens the fields; Set active/inactive saves at once with status and Undo; Archive = action); add form = draft.
  - `admin/users`: role and AI access save on change with per-row status and Undo (`users.update`); add form = draft; Remove = action.
  - `admin/artist`: artist name, configurations (name, billing name, lineup, gear) and sound gear autosave (no Save button; blank gear rows are kept on screen but not sent); a new configuration = draft (`configuration`) with Add configuration.
  - `admin/ai-keys`: unchanged. Create key and Revoke are actions; nothing else there is editable.
- **Songs, Money, Shows converted** (autosave = existing record, draft = new record or half-entered action with its button kept):
  - `songs/new`: draft (`song`, title/key/length; Drive picks are re-picked after a restore). `songs/[id]`: edit = autosave (`songs.update`, Done button; Archive, Add from Drive, sharing fixes, Remove file = actions).
  - `songs/rehearsals/[id]`: split. `new` = draft (`rehearsal`) with Save rehearsal; existing = autosave (`rehearsals.update`). Attach recording, Archive = actions.
  - `songs/setlists/[id]`: name and item list (add, remove, reorder) autosave through `setlists.update` (list changes patch at once) with status and Undo; Attach to show = action. `songs` new setlist name = draft (`setlist`, opens on the Setlists tab via `?seg=setlists`).
  - `money/expense`: draft (`expense`, context `new` or `show:<id>`) with Send. `money` ledger Record form: draft (`ledger`, `?tab=ledger`) with Record; the ledger is immutable, Correct stays explicit. Mark reimbursed / Mark paid = actions. `MyMoney` submits nothing (read-only).
  - `shows/[id]/after`: `shows.afterShow` is a one-shot action (marks played, syncs): answers are a draft (`afterShow`, per show), Save stays. `EnterMoney`: the `shows.settle` inputs are a draft (`settlement`, per show), Save money stays.
  - `ShowParts`: `DealPanel` autosaves (`showDeals.update`, Done button). Checklist, gear and docs: existing rows save at once (`shows.setChecklist` / `setGear` / `packGear` / `update docs`, status + Undo; `components/shows/saved.tsx`, because those commands take whole lists, not a patch); the "add" boxes are drafts (`checklistItem`, `gearItem`, `showDoc`, per show). Setlist select, Rebuild gear, Sync, Calendar = actions.
  - `Availability`: the ask form is a draft (`availabilityAsk`, per show/pitch) and Send stays; Mark, Remind, Close, Reopen = actions. Public `ask/...` page untouched.
- **Gaps (not done on purpose)**: history is still one top-level collection (not per-document subcollections); no offline write queue (a closed tab with an unsent autosave loses it; the draft's device copy survives); no typo guard on money; no `createdVia/updatedVia` rename; conflicts are field-level and only for `*.update` patches that send `baseRev`; MCP calls don't send `clientMutationId`; a coalesced entry's Undo reverts everything folded into it; rest of the app still has Save buttons (list in the handoff).
