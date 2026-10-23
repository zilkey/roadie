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
