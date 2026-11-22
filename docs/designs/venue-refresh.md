# Nightly venue-calendar refresh (2026-11-21)

Jeff, 2026-11-21: "I'm also ready for a cron job that refreshes all venues ... I want these events to be up to date,
de-duped etc." This replaces the 2026-11-11 call (no scheduled refresh; bands press Refresh).

## What was wrong
- 59 of 60 calendars were last read 2026-11-11: nothing refreshes them unless someone presses Refresh on one venue.
- The 2026-11-11 attempt refreshed every venue in one request and ran the 512 MB App Hosting instance out of memory.
- Duplicates on prod (2026-11-21, 891 upcoming shows): the same show listed twice at one venue with different source ids,
  e.g. Ophelia's "Reprise" and "Reprise (TWO-DAY TICKETS)", Drifters' dance party listed twice.

## How it works
- **GitHub Actions** workflow `.github/workflows/venue-calendars.yml` POSTs `https://app.myroadie.online/api/cron/venue-calendars`
  every 15 minutes from 08:00 to 13:45 UTC (`*/15 8-13 * * *`: 1:00-6:45 Denver in winter, 2:00-7:45 in summer): 24 calls a
  night. Run it by hand from the Actions tab any time. (Cloud Scheduler was the first plan: its API isn't enabled on
  roadie-prod-iab and the service account can't enable it; GitHub needs nothing set up.)
- **Auth**: the workflow asks GitHub for an OIDC token with the URL as audience. The route checks the JWT's RS256 signature
  against GitHub's published keys and its claims: issuer, audience, repository `CRON_GITHUB_REPO` (apphosting.yaml), ref
  `refs/heads/main`, this workflow file, expiry. No shared secret anywhere. Anything else gets 401.
- **One slice per call**: the 6 venues with a readable calendar (not manual, not merged) whose last run
  (`venueEventSources.lastRunAt`) is oldest and more than 20 hours ago, never-run ones first, refreshed 2 at a time with the
  existing `refreshVenue` (a fresh page cache per page, then dropped). 24 calls x 6 = 144 venue reads a night, room for
  every calendar (about 70 now, after the 2026-11-21 sweep) plus retries. A call with nothing stale returns at once.
- A failing calendar is recorded on its health (`lastError`, as today) and waits for the next night; it doesn't block the slice.
- The run is a system job: no artist is charged web lookups (as before). Each call logs one line (venues, added, gone, errors)
  to Cloud Logging, and returns the same as JSON.

## De-duping
At upsert (`src/server/events/refresh.ts`), drafts from one calendar that are the same show collapse into one:
same date, same start time (or one of them has none), and the same headliner once ticket notes are stripped ("(TWO-DAY
TICKETS)", "[VIP tickets]"). Different start times stay apart (Dairy's 4pm and 7pm, RIOT's early and late show). The kept
row is the one already stored (so a band's Not a fit / pitch link stays), else the first listed. The dropped copy, already
stored from an earlier run, is marked gone like any show that left the calendar, so it leaves every list.

Not handled: the same show on two venues' calendars (a shared downtown page that lists "Open Mic @ Bricks" under Grossen
Bart). Only open mics did this on 2026-11-21, and they are Not a fit.

## Tests
- emulator: the slice picks never-run then oldest, skips fresh, manual and merged venues, and caps at 6; duplicate drafts
  collapse, keep the stored id, and the stored copy goes gone; early and late shows stay apart.
- unit: the route refuses a missing or forged token, another key or alg, and the wrong issuer, audience, repo, branch,
  workflow or expiry.
