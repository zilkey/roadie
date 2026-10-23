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
