# Roadie build plan

Source of truth for WHAT to build: `docs/blueprint.html` (glossary, ER model, ground rules, schema, access table, user stories, wireframes). Read only the parts your slice needs (grep it). This file says HOW.

Reference for Firebase emulator / Playwright patterns: `/Users/jeff/workspace/woven` (read-only: `firebase.json`, `scripts/emulators.mjs`, `playwright.config.ts`, `tests/`). Never edit woven.

## Hard constraints
- Nothing can prompt a human. No global installs (`npm i -g`), no `sudo`, no writes outside this repo. No real network calls except `npm install` / `npx playwright install chromium`.
- No real Firebase project. Emulator project id is `demo-band-tracker` (the `demo-` prefix keeps the emulators fully offline). `.firebaserc` default = `demo-band-tracker`. The real name later is `band-tracker`.
- Firebase CLI is a devDependency (`firebase-tools`), run through npm scripts / `npx firebase`.
- Commit your own work locally when your tests pass: `git add <your paths>` then `git commit`. No remotes. Message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Don't leave background processes running when you finish.

## Stack
- Next.js (App Router, TypeScript, strict), Tailwind CSS. Look and feel from the blueprint's CSS tokens (colors, Bricolage Grotesque / Figtree fonts, rounded cards, pink accent). Light + dark.
- Firebase JS SDK in the browser for **reads only** (`onSnapshot`). `firebase-admin` on the server for **all writes**.
- Zod for every collection schema. `zod` objects are `.strict()`.
- Tests: `node --test` via `tsx` for server/command tests against emulators; Playwright (Chromium) for end-to-end.

## Ports (chosen to not clash with woven)
| What | Port |
| --- | --- |
| Next dev | 3100 |
| Firestore emulator | 8280 |
| Auth emulator | 9319 (9299 taken by woven) |
| Emulator UI | 4200 (hub 4600, logging 4700) |
| fake-gmail | 3201 |
| fake-drive | 3202 |
| fake-calendar | 3203 |
| fake-bandsintown | 3204 |
| fake-spotify | 3205 |
| MCP server (HTTP, served by the app at /mcp) | 3100 |

## Layout
```
src/app/...                 Next routes (phone + web responsive; bottom tabs < 768px, left sidebar >= 768px)
src/schema/<collection>.ts  Zod schemas + TS types, one file per collection; src/schema/index.ts exports all
src/schema/common.ts        common fields (id, schemaVersion, createdAt/updatedAt, createdBy/updatedBy, via, runId, deletedAt, sources)
src/lib/firebase-client.ts  client SDK init; connects to emulators when NEXT_PUBLIC_USE_EMULATORS=1
src/lib/money.ts            cents helpers
src/server/admin.ts         firebase-admin init (emulator env vars)
src/server/db.ts            the ONLY write path: create/update/softDelete/merge/restore, stamps common fields, writes `history` with diff + runId, enforces matchKey dedupe
src/server/commands/<area>.ts  command definitions
src/server/commands/registry.ts  all commands: { name, roles: ('admin'|'member'|'mcp')[], input: ZodSchema, run(ctx, input) }
src/server/integrations/<svc>.ts  interface + HTTP client pointing at env base URL (fake now, real Google later)
src/app/api/commands/[name]/route.ts  POST; verifies Firebase ID token (Bearer), checks role claim, validates input, runs command
src/app/api/session/route.ts  after sign-in: looks up users by email; if found sets custom claims {role, musicianId} and returns; else 403 "not invited"
fakes/fake-<svc>/server.ts  tiny HTTP servers; state in .fake-data/<svc>.json (gitignored); each has a GET / HTML page showing its state
fakes/run-all.ts            starts all fakes
mcp/server.ts               MCP server reusing the command registry
scripts/seed.ts             seeds emulator with realistic demo data
scripts/backup.ts           dumps all collections to JSON (used by .github/workflows/backup.yml)
firestore.rules             reads per access table; ALL client writes denied
tests/unit/*.test.ts        node:test against emulators
tests/e2e/*.spec.ts         Playwright
docs/STATUS.md              each slice appends: done / stubbed / known gaps
docs/FIREBASE-SETUP.md      each slice appends manual real-Firebase steps it implies (under "Collected items")
```

## Conventions
- **Commands**: client calls `runCommand(name, input)` (src/lib/commands.ts) which POSTs with the ID token. Each command does all writes for its action in one batch/transaction via `db.ts` (e.g. show + showDeal together). Errors are `{error: {code, message, issues?}}` with Zod issues, so MCP clients can self-correct.
- **ctx** = `{ uid, role, musicianId?, via: 'app'|'mcp'|'import', runId }`. App requests get a fresh runId per request; MCP sessions keep one runId per session.
- **Roles** live in custom claims (`role`, `musicianId`). Rules read `request.auth.token.role`. `users` doc mirrors it.
- **Money** is integer cents. Ledger is append-only; corrections need `reversesId`.
- **Soft delete**: set `deletedAt`; UI and queries hide it.
- **Dedupe**: venues/promoters/festivals/contacts compute `matchKey` in db.ts; a create that matches merges into the existing doc (`op: merge` in history).
- **Denormalized display fields** (venue name on show, festivalName on edition, target.name on pitch, song titles in setlists) are copied by commands and refreshed when the source is renamed.
- **Dev sign-in**: Auth emulator accepts unsigned Google credentials. When `NEXT_PUBLIC_USE_EMULATORS=1`, the sign-in page shows "Sign in as…" buttons for seeded people, using `signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({sub, email, email_verified:true, name})))`. Also keep a normal "Sign in with Google" button (popup) for real use. Playwright uses the dev buttons.
- **Seeded people**: admins Jeff (jeff@example.com), Ingrid (ingrid@example.com); members David, Eric, Emma (<name>@example.com); one sub with no login (Sam, drums). Artist "Ingrid Avison Band" with configurations Full band, Trio, Duo, Ingrid solo.
- Plain-language UI words come from the blueprint's "Words" section.
- Keep components small; no UI component library beyond Tailwind. Use `data-testid` on key elements for Playwright.

## Scripts (package.json)
- `dev:all` = emulators + fakes + next dev, for local use
- `emulators` = `firebase emulators:start --project demo-band-tracker --import .emulator-data --export-on-exit`
- `seed` = seeds running emulators
- `test` = `firebase emulators:exec --project demo-band-tracker "tsx --test tests/unit/**/*.test.ts"` (fakes started inside if needed)
- `e2e` = emulators:exec running fakes + seed + `playwright test` (Playwright `webServer` starts next on 3100)
- `typecheck`, `lint`

## Slices (built in this order, one agent each)
1. Foundation: scaffold, emulators, schemas (ALL collections), db.ts, command API, rules + rules tests, session/claims, dev sign-in, app shell with nav (Home/Shows/Booking/Songs/Money; members lack Booking and see "My money"), people admin (users, musicians, artist configurations), seed, Playwright smoke.
2. Fakes + integrations: fake-gmail, fake-drive, fake-calendar, fake-bandsintown, fake-spotify, their clients in src/server/integrations.
3. Booking: venues, promoters, festivals + editions, contacts, search, pitches (list/board, statuses, next step, assignee, comments, activity timeline), email templates + send via gmail integration.
4. Shows: booked it, shows + showDeals, availability asks (incl. no-login token links), checklist templates, gear, calendar events, Bandsintown listing sync, after-the-show rating, Home logic (see blueprint callout "How Home decides").
5. Music: songs, files (Drive search, attach, sharing check, copy to band folder), setlists (drag order, total vs set length), rehearsals.
6. Money + Reach: ledger, expenses, payouts, owed-per-person, reports; statSnapshots (daily Spotify pull, Spotify for Artists CSV import), stats chart.
7. MCP + safety net: MCP server (token auth via mcpTokens, tools = registry commands allowed for 'mcp', drafts-only email), history view, undo a run, AI key management UI, backup script + workflow.
8. Final: full e2e pass, fix breakage, finish docs.

## Learned in slice 1 (binding for later slices)
- Writes only via `db.create/update/merge/softDelete/restore` or `run(ctx, w => …)` (one atomic transaction) in `src/server/db.ts`.
- `<Name>Input` = writable schema shape; `collections` registry in `src/schema/index.ts`.
- New commands: append an array to `src/server/commands/registry.ts`; updates take `{id, patch}` via `patchInput()`; client uses `runCommand()`.
- Denormalized copies go in `src/server/denorm.ts`.
- Client reads: `useCollection` (hides soft-deleted; sort client-side).
- `history.diff` is `{before, after}` objects (Firestore forbids nested arrays).
- Next 16 needs `allowedDevOrigins` for 127.0.0.1. Auth emulator port is hardcoded in several files (see docs/STATUS.md).

## Every slice agent must
- Read this file, then grep only the blueprint parts it needs. Read existing code before adding to it; reuse helpers.
- Keep `npm run typecheck`, `npm test`, `npm run e2e` green (add unit tests for commands, at least one e2e spec per main flow).
- Append its section to docs/STATUS.md and manual real-Firebase/Google steps to docs/FIREBASE-SETUP.md.
- Commit locally, stop all processes it started, and reply in under 150 words: what works, test results, notes for later slices.
