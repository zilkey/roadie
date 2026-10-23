# Band Tracker

A small web app (phone and desktop) for one working band, the Ingrid Avison Band in Colorado. It replaces the spreadsheets, group texts and Drive folders a band lives in:

- **Booking** (admins): venues, promoters, festivals, contacts, a Pitch List with statuses, next steps, email templates sent through Gmail.
- **Shows**: "Booked it" turns a pitch into a show with deal, checklist, gear, Google Calendar event, Bandsintown listing, "who's free" asks (members answer in the app, subs by a no-login link), and an after-the-show rating.
- **Home**: decides what you need right now (today's show, who-can-play questions, last night's money, to-dos).
- **Songs**: songs, Drive files with a sharing check, setlists with total time, rehearsals.
- **Money**: append-only ledger, expenses, owed-per-person, settle a show, "My money" for members. **Stats**: Spotify numbers and charts.
- **Safety net**: every write is recorded in History and a whole run can be undone; an MCP server lets Claude work on the data (it can draft, never send, email); nightly backup.

All times and "today" are America/Denver (`src/lib/timezone.ts`).

Everything external (Gmail, Drive, Calendar, Bandsintown, Spotify) is **faked locally** for now. See `docs/STATUS.md` for what is real and what is not, and `docs/FIREBASE-SETUP.md` to take it to a real Firebase project.

## Stack

Next.js 16 (App Router, TypeScript strict, Tailwind 4), Firebase (Firestore + Auth). The browser reads Firestore with the client SDK (read only); **all writes go through `firebase-admin` on the server** via a command registry. Zod validates every document and command input. Tests use `node --test` against the emulators, and Playwright.

## Run it locally

Needs Node 20+ and a Java runtime (for the Firestore emulator). No Firebase account or network is needed.

```
npm ci
npm run dev:all     # emulators + the five fakes + Next, in one terminal (Ctrl-C stops all)
npm run seed        # in a second terminal, once the emulators are up: demo data
```

For the band's real booking data instead of the demo: `npm run seed -- --reset --people` (people, artist, templates only), then `npm run import:booking`. That reads the Venue Book, Festival Run 2027 and Support Slots snapshots in `.booking-kit/` (gitignored: real contacts). It's safe to re-run, and Admin → History can undo it as one run.

| What | URL |
| --- | --- |
| The app | http://127.0.0.1:3100 |
| Emulator UI (Firestore, Auth) | http://127.0.0.1:4200 |
| fake Gmail | http://127.0.0.1:3201 |
| fake Drive | http://127.0.0.1:3202 |
| fake Calendar | http://127.0.0.1:3203 |
| fake Bandsintown | http://127.0.0.1:3204 |
| fake Spotify | http://127.0.0.1:3205 |
| MCP server (`npm run mcp`, not in dev:all) | http://127.0.0.1:3300/mcp |

Each fake's page shows its current state (sent mail, events, files...). fake Gmail has a "Simulate reply" button. State lives in `.fake-data/` (reset any fake with `POST /__reset`). Emulator data is kept in `.emulator-data/` between runs. Both are gitignored.

**Signing in.** With the emulators on, the sign-in page shows "Sign in as..." buttons for the seeded people: Jeff and Ingrid (admins), David, Eric and Emma (members), plus a "stranger" who is not invited and gets turned away. The real "Sign in with Google" button is there too but only works against a real project.

Other scripts: `npm run stats:pull` (daily Spotify pull against the fake), `npm run backup` / `npm run restore` (see `docs/BACKUP.md`), `npm run mcp` (see `docs/MCP.md`), `npx tsx scripts/screenshots.ts` (regenerates `docs/screenshots/`, needs dev:all + seed).

## Tests

```
npm run typecheck   # tsc --noEmit
npm run lint        # same (next lint no longer exists in Next 16)
npm test            # unit + Firestore rules tests, under the emulators (starts them itself)
npm run e2e         # Playwright (Chromium): starts emulators, seeds, starts fakes and Next, runs the specs
```

`npm test` and `npm run e2e` start their own emulators and fakes; stop `dev:all` first if a port clash appears. First time only: `npx playwright install chromium`.

## Layout

```
src/app/                 Next routes: (app)/ signed-in screens, signin, ask/ (public no-login availability page), api/
src/components/          UI by area: booking, shows, music, money, Shell (bottom tabs on phone, sidebar on desktop)
src/lib/                 pure helpers shared by browser and server (money, booking, shows, stats, timezone, music)
src/schema/              Zod schema per collection; index.ts has the collection registry
src/server/db.ts         the only write path: stamps common fields, writes history, dedupes, atomic runs
src/server/commands/     command definitions by area; registry.ts lists them all (roles: admin, member, mcp)
src/server/integrations/ Gmail, Drive, Calendar, Bandsintown, Spotify client interfaces (HTTP, pointed at the fakes)
src/server/undo.ts       undo a run from history
fakes/                   the five fake services, state in .fake-data/
mcp/                     MCP server reusing the command registry
scripts/                 seed, dev-all, stats-pull, backup, restore, bootstrap-admin, screenshots
tests/unit, tests/e2e    node:test and Playwright
firestore.rules          reads per access table; all client writes denied
docs/                    STATUS.md, FIREBASE-SETUP.md, MCP.md, BACKUP.md, blueprint.html (the spec), screenshots/
PLAN.md                  the build plan and conventions the slices followed
```
