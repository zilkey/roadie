# Status

Each slice appends its section below.

## Slice 1: Foundation

**Done**
- Next 16 (App Router, TS strict, Tailwind 4) at repo root; blueprint tokens/look in `src/app/globals.css`. Phone bottom tabs / web sidebar (`src/components/Shell.tsx`, testids `tab-*` sidebar, `mtab-*` phone).
- Zod schemas for every collection in `src/schema/*` (strict). `<Name>` = full doc, `<Name>Input` = writable fields; `collections` registry, `normalizeDoc`, `kindOf` in `src/schema/index.ts`.
- `src/server/db.ts` is the only write path (`db.create/update/merge/softDelete/restore`, or `run(ctx, w => ...)` for one atomic unit). Stamps common fields, writes `history` (diff + runId), dedupes on `matchKey` (merge), denorm hooks in `src/server/denorm.ts`. Ledger/statSnapshots/history immutable; activity append-only.
- Command registry (`src/server/commands/registry.ts`), `POST /api/commands/[name]`, `src/lib/commands.ts` `runCommand`. Errors: `{error:{code,message,issues?}}`.
- `/api/session` (invite by email -> custom claims), sign-in page with dev "Sign in as..." buttons, not-invited page, role guards (`AdminOnly`).
- People admin: `/admin/users`, `/admin/musicians`, `/admin/artist` (configurations, gear + who brings it, soundGear). Commands: users.add/update/remove, musicians.create/update/remove, artists.create/update.
- `firestore.rules` (reads per access table, all client writes denied) + rules tests.
- `scripts/seed.ts` (people, artist, venues, promoters, festivals+editions, contacts, 9 pitches in all statuses, 2 upcoming shows + 1 played unsettled, songs, setlist, rehearsal, files, availability, expense, stat snapshots).
- Tests: 26 unit/rules tests (`npm test`), 6 Playwright smoke tests (`npm run e2e`), `npm run typecheck`.

**Deviations / gotchas**
- Auth emulator is on **9319**, not 9299 (9299/9399 are taken by woven's Data Connect emulator on this machine). Change in `firebase.json`, `.env.development`, `src/lib/firebase-client.ts`, `package.json` seed script, `playwright.config.ts`, `tests/unit/helpers.ts`, `scripts/seed.ts` if you need another.
- `history.diff` is `{field: {before, after}}` (blueprint says `[before, after]`; Firestore forbids nested arrays).
- Soft-deleted docs store `deletedAt: null` when live so `where('deletedAt','==',null)` works; client hooks (`useCollection`) always filter this and sort client-side (no composite indexes).
- Next 16 needs `allowedDevOrigins` for 127.0.0.1 or hydration silently fails (set in next.config.ts).
- Users doc id == Auth uid: `users.add` creates the Auth user ahead of time by email; Google sign-in with the same email reuses it (verified in emulator).
- `npm run lint` just runs tsc (`next lint` is gone in Next 16).

**Stubbed**
- Home, Shows, Booking, Songs, Money pages are placeholders. `mcp` role appears in command `roles` but no MCP auth path yet (slice 7). Fakes/integrations not started. Only people commands exist.

**Known gaps**
- No UI to rename/delete configurations' ids (ids come from the name at first save). `users.add` side effects (Auth user, claims) happen outside the Firestore transaction.
- Role/claim changes take effect after the user's token refreshes (we revoke refresh tokens on role change).

## Slice 2: Fakes + integrations

**Done**
- `fakes/fake-{gmail,drive,calendar,bandsintown,spotify}/server.ts` on ports 3201-3205 (framework in `fakes/lib.ts`): state in `.fake-data/<svc>.json`, `GET /` HTML page, `GET /health`, `POST /__reset`. `npm run fakes` / `tsx fakes/run-all.ts` starts all; `npm run dev:all` (`scripts/dev-all.ts`) runs emulators + fakes + next; Playwright `webServer` starts the fakes for `npm run e2e`. `FAKE_DATA_DIR` overrides the state dir.
- fake-gmail: send, drafts, messages/threads, `POST /threads/:id/reply` (button "Simulate reply" on its page, testid `simulate-reply`). fake-drive: seeded band folder (`fake-band-folder`), per-song demo/charts in two keys/lyrics, rehearsal recordings, some not shared with everyone or outside the band folder; ids `fake-drive-demo-1` / `fake-drive-chart-1` match scripts/seed.ts. Search `GET /files?q=`, copy, share, permissions. fake-calendar / fake-bandsintown: event CRUD + list. fake-spotify: 60 days of followers/popularity with deterministic daily drift (extends each day), top tracks.
- Clients + interfaces in `src/server/integrations/` (`gmailClient()`, `driveClient()`, ...; `IntegrationError` on non-2xx). Env: `*_BASE_URL`.
- `tests/unit/integrations.test.ts` starts the fakes in-process on random ports with a temp data dir (so `npm test` needs no external fakes and cannot clash with `dev:all`).

**Stubbed / gaps**
- No app features use the clients yet. Fake Drive has no auth or per-user visibility (every caller sees everything). Calendar attendee responses can't be simulated yet (PATCH attendees with a responseStatus object works). Real implementations not written; see FIREBASE-SETUP.md.

## Slice 3: Booking

**Done**
- Booking tab (`/booking`, admin only): one search box (names, cities, people via contacts), segments All / Pitch List (grouped by status) / Venues / Festivals & series (with their years) / Promoters / Contacts, "Applications open this month" card, add forms. Detail + edit pages: `/booking/venues|promoters|festivals|editions|contacts/[id]` (venue page: people with one-tap Copy email, booked-by promoters, pitches, shows here), `/booking/pitches/[id]`, `/booking/templates`.
- Flag button (`FlagButton`, one tap) on venue, promoter, edition rows and pages; filled = already on the list, tap opens the pitch. `pitches.flag` creates a `toPitch` pitch assigned to the caller, or returns the existing active one.
- Pitch page: status flow buttons (logged as `status` activity), pitched-as dropdown (or Not sure) filling personnel from the configuration (still editable), assignee, next step + due, comments, calls, activity timeline, email panel (template, recipient checkboxes, editable filled preview, unfilled-field warning, optional "Move to Pitched"), "Check for replies".
- Commands (`src/server/commands/booking.ts`): venues/promoters/festivals/editions/contacts create|update|remove, contacts.attach|detach, pitches.flag|update|move|comment|log|remove|sendEmail|checkReplies, emailTemplates create|update|remove. Creates dedupe through matchKey (`{id, merged}`); contact emails/phones are normalized in the command input. Venue<->promoter links stay in sync both ways. Renames refresh pitch/show/edition names (hooks already in denorm.ts, now covered by tests).
- Home (admin): `BookingHome` shows to-dos from next steps (overdue/today highlighted), application deadlines (next 120 days, flagged or not), Pitch List counts. Members still see the stub. Slice 4 should put its show cards above `<BookingHome />` in `src/app/(app)/home/page.tsx`.
- Shared pure logic in `src/lib/booking.ts` (template fill, search, date helpers). `useDoc` added to firestore-hooks. Seed gets a "Follow up" template.
- Tests: `tests/unit/booking.test.ts` (starts fakes in-process, sets GMAIL_BASE_URL), `tests/e2e/booking.spec.ts` (flag + move + comment, dedupe, send email visible in fake Gmail + reply pull, member blocked).

**Stubbed / gaps**
- "Booked it" is just the `booked` status; turning it into a show and "Ask who's free" are slice 4.
- Sending email: Gmail is called before the Firestore log in a separate step, so a log failure after a successful send would not be recorded. `account` is the sending admin's login email (real OAuth later). `threadId` reply-in-thread is supported by the command but has no UI.
- Template fields: `artist.video` falls back to the artist's website/Spotify link. Missing fields stay as `{{field}}` and block Send until edited.
- No undo UI for archived places; contacts are archived (and unlinked) rather than hard-deleted.

## Slice 4: Shows

**Done**
- **Booked it**: pitch page has "Booked it" -> `/shows/new?pitch=ID` (also `/shows/new` with no pitch). Prefilled from the pitch (venue, billed as, personnel, date from an open ask or edition start, sound from the venue). `shows.create` writes show + showDeal (same id) + links `pitch.showIds` + sets the pitch to booked (with a timeline entry) + links an open ask for the same date, in one transaction.
- **Billed as / personnel / sound / needs**: `billedAs` dropdown fills personnel and gear (both editable; `shows.update` with `billedAs` refills personnel unless personnel is given). Sound defaults from the venue. Needs: poster, backline, merch.
- **Checklist**: built from `checklistTemplates` (`when` matched on sound + needs, `daysBefore` sets `due`). Seed has 11 templates (`DEFAULT_CHECKLIST_TEMPLATES` in `src/lib/shows.ts`). Admin can check off, rename, give an owner and due date, add and remove (`shows.setChecklist`). Changing needs/sound adds missing template items (never removes). Changing the date shifts open items' due dates.
- **Gear**: config gear + artist `soundGear` for the chosen provider. Admin edits label/owner, adds, removes, rebuilds (`shows.setGear`, `shows.update {rebuildGear}`, keeps packed marks). Packed via `shows.packGear`: admins any item, members only their own. Home shows "You're bringing".
- **Shows tab**: `/shows` upcoming + past; `/shows/[id]` has times, address, billed as, personnel, sound, gear, setlist link, checklist, docs, band notes, listings (Bandsintown state + syncedAt, Calendar state); admins also get edit, cancel, archive, "Who's free", and the private deal panel. Members get the same page read-only with no showDeals read (the component is not mounted for them and rules deny it).
- **Google Calendar** (`src/server/showSync.ts`): `shows.create` (addToCalendar, default on) creates one event with every playing musician's email as attendee; changes to date/times/venue/people/status/notes update it; cancel/archive delete it. `shows.calendar {on}` toggles it. Events are never created behind your back on an edit.
- **Bandsintown**: a show that is `public` and `confirmed` is created/updated on date, time, venue or ticket change; holds, private, canceled and archived shows are removed. `listings.bandsintown {eventId, state, syncedAt, error}` is written by the server; failures set `state: "error"` and the command still succeeds (`shows.sync` retries). Played shows are left as they are.
- **Availability**: `availability.ask|remind|mark|answer|close|reopen`. Ask from a pitch or show (UI: `AskWhoIsFree`, `WhosFree` in `src/components/shows/Availability.tsx`), each person emailed through gmail with `APP_URL/ask/{id}/{musicianId}/{token}`; only `sha256(token)` is stored in `linkTokens`. People without an email get their link displayed once for texting. Reminder only goes to people who haven't answered and issues a fresh link (old link stops working). Members answer on Home; subs use `/ask/...` (public page, `GET/POST /api/availability/[id]/[musicianId]/[token]`, `src/server/availability.ts`, constant-time hash compare, same error for wrong token and unknown ask). Closed asks refuse answers.
- **After the show**: `/shows/[id]/after` ("How'd it go?"): show and venue stars, crowd, paid attendance, notes (`shows.afterShow`, marks the show played). The "Enter money" step is a disabled placeholder; `showDeals.settled` stays false (slice 6 flips it).
- **Home** (`src/components/shows/HomeShows.tsx`, pure logic `planHome` in `src/lib/shows.ts`): today's shows first (one card each: times, gear with packed boxes, setlist, open checklist, admin-only contact tonight); then open "Can you play?" cards (admins who are musicians too); then a show played in the last 3 days (admins: only while `settled` is false, "Enter money"; members: "Add expenses from last night"); with no show today it shows the next show (checklist progress), then `BookingHome` (admins) or "You're bringing" + "Coming up" (members). On a show day the next-show/BookingHome block steps aside, matching the wireframe.
- Commands: shows.create|update|cancel|remove|sync|setChecklist|setGear|packGear|calendar|afterShow, showDeals.update, checklistTemplates.create|update|remove, availability.* (all in the registry, roles include `mcp` where sensible).
- Tests: `tests/unit/shows.test.ts` (14 tests: pure logic, Booked it + rollback, checklist/gear rules, Calendar and Bandsintown calls against the fakes incl. error + retry, after-the-show, token answer path, remind/mark/close), `tests/e2e/shows.spec.ts` (6 specs: Booked it, ask + sub answers by link, member Home with a today show, public show in fake Bandsintown, after the show, last-night card).

**Gotchas / deviations**
- A "played" show is any `played` show, or a `confirmed` one whose date has passed; nothing flips the status automatically (rating it does).
- Calendar/Bandsintown times are local clock strings (`YYYY-MM-DDTHH:MM:00`), no timezone yet; add `timeZone` when real APIs arrive.
- Public default is off (nothing is listed on Bandsintown unless "Public show" is ticked).
- `useCollection` got a `skip` option (used so members never subscribe to admin-only collections). Members' availability queries must include `array-contains musicianId` or rules deny them.
- The setlist link is `/songs?setlist=ID`; slice 5 should make that route real (or change `SetlistPanel` and the Home card).
- Seed shows were written directly, so they have no calendar event or Bandsintown listing; use "Sync Bandsintown now" / "Add to everyone's calendar" on them.
- Fake state (`.fake-data`) outlives e2e runs, so the specs compare ids/reset the Bandsintown fake instead of assuming empty.

**Known gaps**
- Show docs are plain title + link (no Drive picker until slice 5). No UI to edit checklist templates (commands exist). Sub-musicians without email are not on calendar events. Member can't see other people's availability answers.

## Slice 5: Music

**Done**
- **Songs tab** (`/songs`, members read, admins write): segments Playing / Learning / Ideas / Retired / Setlists / Rehearsals, a filter box (title, writers), key + length per row, a note icon when a recording is attached. `/songs/new` (Add a song), `/songs/[id]` (files grouped by kind, "Chart in <key>", last rehearsed with days ago, admin edit/archive). Audio/video plays inline when the URL allows (`playerFor` in `src/lib/music.ts`: direct media URL -> audio/video tag, `drive.google.com/file/d/ID/...` -> Drive's `/preview` embed); otherwise "Open in Drive" in a new tab. Fake Drive links are not playable, so e2e checks the link path.
- **Attach Drive files**: `DrivePicker` (`src/components/music/DrivePicker.tsx`) follows the song title, searches Drive (audio, video, Docs, Word only), shows mimeType icons, "Band folder / Outside band folder", who can't open each file, kind + key pickers (guessed from the name), multi-select. "Copy to band folder" / "Share with band" work on the picked files before saving (`drive.fix`), and on attached files from the song page (`files.copyToBand`, `files.shareWithBand`). "Run sharing check" (`files.check`) re-reads Drive for every song file and rewrites `sharing`, `inBandFolder`, `checkedAt`.
- "Members who must be able to open a file" = active musicians with an email. A file is in the band folder if any ancestor is the artist's `driveFolderId` (fallback `DRIVE_BAND_FOLDER_ID`, then `fake-band-folder`). "Copy" puts a copy in the band folder, shares it with the band, and repoints the files doc at the copy (the original is untouched).
- **Setlists** (`/songs/setlists/[id]`): songs and breaks, drag-and-drop plus up/down buttons, remove, rename. The server fills title/length/key from the song and computes `totalSec` (db normalize). Shown against the attached show's `setLength` (red "N over" or "Fits"). Attach to a show with `setlists.attach` (sets `show.setlistId` and `setlist.showId`, clears the previous links); the show page's setlist select now uses it. Song renames/length/key changes flow into setlists and rehearsals through the existing `denorm.ts` hook (tested). `/songs?setlist=ID` redirects to `/songs/setlists/ID`.
- **Rehearsals** (`/songs/rehearsals/[id]`, `new`): date, place, who came, songs run with notes, notes, recordings from Drive (kind `rehearsal`). Members see a read-only view.
- Commands (all in `src/server/commands/music.ts`): drive.search, drive.fix, files.attach|update|remove|check|shareWithBand|copyToBand, songs.create (optionally with files)|update|remove, setlists.create|update|attach|remove, rehearsals.create|update|remove. Admin (+mcp except the removes); no member write commands.
- Tests: `tests/unit/music.test.ts` (9: helpers, search, attach, check/share/copy against fake-drive, setlists + denorm + attach, rehearsals), `tests/e2e/music.spec.ts` (5: add song + Drive search, fix a sharing gap, setlist with total time + reorder by drag and buttons, member views a song, log a rehearsal). All 65 unit and 21 e2e tests pass.

**Gotchas / deviations**
- The fake Drive has no per-user view, so "can the member open it" is computed from the file's permission emails (owner counts). Real Drive groups/domain sharing/"anyone with the link" are not modelled.
- Search skips PDFs on purpose (spec: audio, video, Docs, Word), although fake-drive has PDF charts.
- Sharing details on song pages (who can't open it, fix buttons) are shown to admins only.
- No composite song "length from Drive" fill-in (that is an MCP/AI story for slice 7).
- e2e resets fake-drive (`POST /__reset`) before each music spec because fix actions mutate it.

**Known gaps**
- Setlist `items` have no per-item note editor in the UI (field exists). Songs can appear twice in a setlist. No "retired" filter chip on the Home card. Show `docs` still have no Drive picker.

## Slice 6: Money + Reach

**Done**
- **Money tab (admin)** `/money`: Overview (in/out/left, SVG month bars, "Owed to people" per person with Mark reimbursed / Mark paid), By show and By category (SVG bars), Ledger (list + "Record" form for income, spending or a payout to a person: photo shoots, video, room rental...; "Correct..." per entry). Charts are hand-drawn SVG in `src/components/money/charts.tsx`. Pure math in `src/lib/money.ts` (`totals`, `byMonth/byShow/byCategory`, `owedLines`, `splitEvenly`; a reversed entry and its correction cancel out of reports).
- **Enter money** (`/shows/[id]/after`, `EnterMoney`): income lines (door, guarantee prefilled from the deal, merch, tips, Venmo), payouts proposed evenly for `show.personnel` (editable, untick, or mark "owed"). `shows.settle` writes income + payout ledger entries and `showDeals.settled = true` in one transaction (payouts cannot exceed income; settling twice is refused). Home's unsettled card disappears.
- **Owed payouts**: unpaid payouts live in new optional `showDeals.owedPayouts`; `payouts.pay` records the payment as a ledger payout. Owed = unreimbursed expenses + `owedPayouts` minus paid.
- **Ledger rules** (`addLedgerEntry` in `src/server/commands/money.ts`, the one creation path): entries are immutable (`db.update/softDelete/merge` refuse; no update/remove command exists). Corrections: `kind: correction` needs `reversesId`, same amount, not a correction itself, one per entry (`ledger.correct` builds one from the original). `reversesId` is refused on other kinds. Reimbursements need `expenseId` and are refused twice unless the first was corrected.
- **Expenses**: `expenses.add` (member: own only; admin may pass userId), `expenses.reimburse` (reimbursement entry with `expenseId`, payee = submitter), `receipts.search` (members + admins, Drive search). Pages: `/money/expense?show=ID` (amount, category, what, optional show, receipt link or Drive search). Home's "Add expenses from last night" links there with the show preselected.
- **My money** (members): own expenses with Paid back / Not yet, payments to them (payouts + reimbursements, "reversed" marked).
- **Rules**: members read ledger rows only with `payeeUserId == uid` and kind in payout, reimbursement, correction (extended from payout-only so "paid back" and reversals are visible). Rules tests updated. Expenses were already own-only.
- **Stats** `/stats` (admin, linked from Money): current numbers, SVG line charts (followers, popularity, monthly listeners, streams), "Pull now", CSV upload/paste. `stats.pull` (id `spotifyApi_{date}`, skips a day already stored), `stats.importCsv` (ids `spotifyForArtists_{date}`; bare months map to the month's last day; nothing written if any line is bad), `stats.current` (`statsCurrent` in `src/lib/stats.ts`). `npm run stats:pull` runs the daily pull against the emulator (`scripts/stats-pull.ts`; cron later). Sample: `fixtures/spotify-for-artists-sample.csv`.
- **Email templates**: `{{stats.monthlyListeners}}` and `{{stats.followers}}` (pitch page reads snapshots; listed in TEMPLATE_FIELDS).
- Tests: `tests/unit/money.test.ts` (9: ledger math, immutability, correction rules, settle + atomic rollback, expenses/reimbursement, receipts search, CSV parsing, pull/import/current/template fields, role checks), `tests/e2e/money.spec.ts` (6). 75 unit and 27 e2e pass.

**Gotchas / deviations**
- "Approved" expenses: there is no approval step in the schema, so every expense counts as approved.
- Db `merge` now also refuses immutable/append-only collections (it was a gap).
- Stats snapshots are immutable, so a second pull the same day or a re-imported month is skipped, not updated. The fake Spotify returns no history on a real API, so charts start when the daily job starts.
- The Spotify CSV format is a guess (date/month + listeners + streams [+ followers] headers, flexible names); adjust `HEADS` in `src/lib/stats.ts` against a real export.
- Money page shows all time, no year filter.

**Known gaps**
- No UI to enter a payout to someone for a show after it is settled except Record form; no per-person payout history for admins beyond the ledger list. Receipt is a link only (no upload). Show page does not display the settled money.
