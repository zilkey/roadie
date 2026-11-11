# Venue calendars (issue #60)

Each venue can have a `calendar` setting: where its own event calendar is and how to read it. Roadie reads it with plain
code, whenever someone presses Refresh on the venue's **Events** tab. Gemini is only used while setting a
calendar up (it proposes CSS selectors for a plain page); it never runs on a refresh.

## Data

| Where | What | Who reads | Who writes |
|---|---|---|---|
| `venues/{id}.calendar` | The setting (`src/schema/venueEvents.ts`, `VenueCalendar`) | every band user | `venues.setCalendar` (History) |
| `venueEvents/{venueId}__{hash}` | One show as the calendar lists it: date, times, title, acts, bill detail, image URL, ticket link, status, first/last seen | every band user | the refresh, directly (a copy of a public page; no History) |
| `venueEventSources/{venueId}` | The last refresh: when, how many, unreadable dates, error | every band user | the refresh, directly |
| `venueEventNotes/{artistId}__{eventId}` | The band's take (not a fit / interested / pitched) | that band's admins | `venueEvents.setTake` (History) |

A show that drops off the calendar is marked `gone`, not deleted; past shows are kept (they show who plays the room).
Images are referenced by the source's own URL, never copied.

## Code

- `src/server/events/fetch.ts`: the raw fetch, with web.ts's guards (https, public addresses, checked redirects), whole body.
- `src/server/events/readers/*`: one reader per source (Squarespace, The Events Calendar, iCal, JSON-LD, AEG, Plot,
  venue.network, Wix, Eventbrite). `selectors.ts` reads a plain page with saved CSS selectors; `presets.ts` holds the shared
  templates (a venue on one adds only its URL and, for a page listing several rooms, `filter.venueName`).
- `src/server/events/refresh.ts`: the shared post-step (dates in the venue's time zone, acts from the title in `bill.ts`,
  music only, the calendar's filter) and the upsert.
- `src/server/events/suggest.ts`: Gemini's selector proposals for setup.
- Commands (`src/server/commands/venueEvents.ts`): `venues.setCalendar`, `venueEvents.refresh`, `venueEvents.preview`,
  `venueEvents.suggestSelectors`, `venueEvents.setTake`. Roadie (the assistant) gets none of them.

## Refreshing

There is no scheduled job (the developer, 2026-11-11: no big nightly runs). A venue's shows are read when someone presses Refresh on
its Events tab. To fill or refresh every venue at once, run `refreshAll()` (`src/server/events/refresh.ts`) as a one-off
from a checkout against the target Firestore (the prod service-account key for production); Gemini, for new selector
setups, is the same Vertex model Roadie uses. It refreshes four venues at a time and shares a fetch between rooms on one page.

## Tests

`tests/unit/venue-events.test.ts`, `tests/unit/venue-readers-{a,b}.test.ts`, `tests/emulator/venue-events.test.ts`,
`tests/e2e/venue-events.spec.ts`. e2e reads calendars from `fixtures/calendars/` (`VENUE_EVENTS_FIXTURES`), never the network.
