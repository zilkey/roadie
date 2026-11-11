# Backup and restore

## What a backup is
`npm run backup -- --out backups` (or `tsx scripts/backup.ts`) writes `backups/YYYY-MM-DD/<collection>.json`, one file per top-level collection, with every document including sub-collections (`pitches/{id}/activity`, `comments`) and soft-deleted ones, plus `_manifest.json` with counts. Each row is `{path, data}`; Firestore timestamps are `{"__ts": {seconds, nanoseconds}}`. Auth accounts are not included (people sign in with Google again and `/api/session` re-sets the role from the `users` document).

## Nightly job (`.github/workflows/backup.yml`)
Runs at 09:17 UTC every day (and on demand from the Actions tab), dumps the real Firestore and commits the result to a **private** backup repo. It has never been run; set up once:
1. Create a private repo, for example `your-org/roadie-backups`.
2. In the Google Cloud project create a service account with role **Cloud Datastore Viewer** (read-only Firestore). Download a JSON key.
3. In the app repo (Settings > Secrets and variables > Actions):
   - secret `FIREBASE_SERVICE_ACCOUNT`: the whole JSON key
   - secret `BACKUP_REPO_TOKEN`: a fine-grained personal access token limited to the backup repo with Contents: read and write
   - variable `BACKUP_REPO`: `your-org/roadie-backups`
4. Edit `GCLOUD_PROJECT` in the workflow if the project id is not `roadie-prod-iab`.
5. Run "Nightly backup" once by hand and check the commit appears.

Each day adds a dated folder; git history gives you the rest. The service account key is written to the runner's temp dir and deleted at the end.

## Restore
```
npm run restore -- backups/2026-10-23 --dry-run     # validate only
npm run restore -- backups/2026-10-23               # into an EMPTY database
npm run restore -- backups/2026-10-23 --overwrite   # over existing documents (others are left alone)
```
Every document is validated with the Zod schemas (common fields, strict collection shape, id equals path); if any fails nothing is written and the problems are listed. What the server keeps outside `db.ts` has no schema and is restored as it was: Roadie's threads (`assistantThreads` with their messages and pending actions), `userPrefs`, `googleGrants`, `metaConnections`, `stagePlotTokens`, the `routeCache`, `geocodes` and `fuelPrices` caches, and `users/{uid}/private`. The list is `SERVER_KEPT` in `src/server/backup.ts`; a collection in neither that list nor the schemas fails the restore with "no schema for collection", so a new one has to be added on purpose. Restore refuses a non-empty database without `--overwrite`, and refuses real Firestore (no emulator host) without `--yes`. It writes documents exactly as they were (ids, timestamps, history), so it is the one writer that bypasses `db.ts` on purpose.
To try it locally: `npm run emulators`, `npm run seed`, `npm run backup`, wipe the emulator, `npm run restore -- backups/<date>`.

## Wipe
```
npm run wipe -- --dry-run                                   # emulator: what would go, deletes nothing
npm run wipe -- --yes                                       # emulator: deletes
GCLOUD_PROJECT=roadie-prod-iab GOOGLE_APPLICATION_CREDENTIALS=./key.json \
  tsx scripts/wipe.ts --yes --project=roadie-prod-iab       # real Firestore
```
`scripts/wipe.ts` empties a project: every Firestore document (sub-collections included) and every Auth user.
`reset()` in `scripts/seed.ts` only talks to the emulator's REST endpoint, which real Firestore does not have, so
this is the only way to empty a real project without doing it by hand in the console.

**It always backs up first**, and a backup error stops the run with nothing deleted. A dry run deletes nothing and
so writes no backup. The guard rails:

- **no flags at all behaves as `--dry-run`**, so a bare `tsx scripts/wipe.ts` can never delete;
- real Firestore needs `--yes` **and** `--project=<id>` matching `GCLOUD_PROJECT` exactly — typing the project id is
  the confirmation, and there is no interactive prompt (it would break non-interactive runs);
- with neither `GCLOUD_PROJECT` nor an emulator host it refuses, rather than guess at a target;
- the target is printed on the first line of every run, dry runs included.

Every guard throws before the first Firestore call, so a refused run contacts nothing.

The backup folder is `backups/2026-10-24T21-07-03/` — **local** date and time to the second, not `npm run backup`'s
plain UTC date. Both halves matter here. A production wipe happens at night, when the UTC date is already tomorrow
and a UTC-named folder would be filed under a day that has not started locally yet. And the time means two wipes in
one sitting (wipe, seed, "wrong data", wipe again) get two folders, where a date alone would have the second backup
overwrite the only copy of what the first one saved. Restore takes the folder either way:
`npm run restore -- backups/2026-10-24T21-07-03`.

It takes **everything**, `owner@example.com` included: a surviving `users/{uid}` doc would carry an `artists[]`
membership pointing at an artist id that no longer exists — a broken sign-in that looks like an app bug rather than
a leftover. The seed step puts back what should be there, with correct claims. `mutations` and `unsubmittedDrafts`
are cleared too although backups leave them out (a draft surviving the wipe would reopen a stale create form); the
report lists them separately so the two sets are not confused.

A wiped project with no artist is not a state to leave things in: back up, wipe, then re-seed in the same sitting.

## Running a script against real Firestore (the `--yes` guard)
Every script that writes (`wipe`, `restore`) takes the same three flags:

- `--dry-run` validates and counts, writes nothing. Always first.
- **no flag at all** is the emulator: the npm scripts set `FIRESTORE_EMULATOR_HOST`, so a bare `npm run <script>`
  can only ever touch `demo-band-tracker`.
- `--yes` is required when there is **no** emulator host set, i.e. real Firestore. Without it the script throws
  *"This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want."*

The guard is literally `!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")`.
Where an npm script hardcodes the emulator host (`seed`, `wipe`), **it can never hit production**; a production run
needs `GOOGLE_APPLICATION_CREDENTIALS=./key.json` and `--yes`.

## One-time importers and migrations (done)
The importers (booking, show-income, song-list, setlist-songs, rehearsal-history, setlists, gas, demos), the real-band seed,
the capo fields script and the migrations that moved old data (history under its records, the venue and band notes split,
artist slugs and roles, contacts onto one band each, money onto projects, gas and rehearsal locations, and the rest) have all run in production, and their
scripts and npm scripts were removed, with the survey formatter and the writer's dry-run option they used. They are in git history if you ever need one again.
What they left behind:

- History is a `history` subcollection under each record (`venues/{id}/history/000002`). Backup and restore carry it
  because they walk sub-collections (the entries are in their parent collection's file, not in `history.json`). A
  backup made before the change still has `history.json`; restoring it puts the old top-level collection back, and
  nothing moves it any more.
- A venue is two documents: the shared `venues/{id}` and each band's private `venueNotes/{artistId}__{venueId}`.
  Festivals, festival years, promoters and contacts keep each band's notes in `festivalNotes`, `editionNotes`,
  `promoterNotes` and `contactNotes` (`{artistId}__{id}`, see `src/schema/bandNotes.ts`). The shared schemas no longer
  accept the old fields, so a backup from before those migrations does not restore.
- The code that read the old shapes is gone too (the show's single checklist, gear list, minutes set length and "public"
  flag, a rating's crowd, object pitch dates, the "waiting" pitch status, a festival's region, the user-level AI flag,
  expenses with no project or a ledger category). Two things production still carries stay valid in the schemas and are
  read by nothing: a show deal's `income[]` lines (each has an income doc, matched by `income.sourceKey`) and
  `income.sourceKey` itself. One venue is still typed `other`, which reads as "Other".
