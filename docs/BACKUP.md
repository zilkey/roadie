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
Every document is validated with the Zod schemas (common fields, strict collection shape, id equals path); if any fails nothing is written and the problems are listed. Restore refuses a non-empty database without `--overwrite`, and refuses real Firestore (no emulator host) without `--yes`. It writes documents exactly as they were (ids, timestamps, history), so it is the one writer that bypasses `db.ts` on purpose.
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

It takes **everything**, `jeff@zilkey.com` included: a surviving `users/{uid}` doc would carry an `artists[]`
membership pointing at an artist id that no longer exists — a broken sign-in that looks like an app bug rather than
a leftover. The seed step puts back what should be there, with correct claims. `mutations` and `unsubmittedDrafts`
are cleared too although backups leave them out (a draft surviving the wipe would reopen a stale create form); the
report lists them separately so the two sets are not confused.

A wiped project with no artist is not a state to leave things in: back up, wipe, then re-seed in the same sitting.

## Running a script against real Firestore (the `--yes` guard)
Every script that writes takes the same three flags, and the convention is worth stating once because tonight's
imports rely on it:

- `--dry-run` validates and counts, writes nothing. Always first.
- **no flag at all** is the emulator: the npm scripts set `FIRESTORE_EMULATOR_HOST`, so a bare `npm run <script>`
  can only ever touch `demo-band-tracker`.
- `--yes` is required when there is **no** emulator host set, i.e. real Firestore. Without it the script throws
  *"This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want."*

The guard is literally `!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")`, and all three
importers now have it (`scripts/import-booking-kit.ts`, `scripts/import-show-income.ts`, `scripts/import-gas.ts`);
`scripts/seed-real.ts` words its own version slightly differently because it also refuses without `GCLOUD_PROJECT`.
The consequence worth knowing: because the normal npm scripts hardcode the emulator host, **they can never hit
production** — which is why production runs use the separate `:prod` scripts below rather than a flag.

### The `:prod` scripts
```
GOOGLE_APPLICATION_CREDENTIALS=./key.json npm run import:booking:prod -- --dry-run
GOOGLE_APPLICATION_CREDENTIALS=./key.json npm run import:booking:prod -- --yes
```
Each `:prod` script is the plain `tsx` invocation with `GCLOUD_PROJECT=roadie-prod-iab` and **no** emulator hosts, so
the guard above engages by itself. The credentials path stays in the environment, never in `package.json`. Flags
pass through after `--`.

### The survey (read this before every real run)
A `--dry-run` prints a **survey**: what the import would do, as a list to read and sign off on *before* it runs for
real, not as a post-mortem after. Every importer prints the same five sections, decisions first:

- **What lands clean** — counts by collection and action (created / already there / merged / unchanged).
- **Needs a decision** — ambiguous matches, near-duplicate names that deduped into each other, guessed regions,
  anything the importer had to guess at. This is the list to actually read.
- **Won't land cleanly** — rows skipped, unmatched or reported instead of written, with line numbers, grouped by
  reason so a hundred rows of one problem read as one line with a count.
- **Would overwrite** — existing values the run would replace (on a re-run, or after a hand edit).
- **Deferred on purpose** — what this import knowingly doesn't carry, so nothing looks lost later.

The last line says either `N thing(s) to read before the real run.` or `Nothing unclean and nothing to decide: safe
to run.` — the second is the signal the production run is safe. `--report=<file.json>` writes the same thing as JSON.

The dry run is a real walk, not a row count: writes are held in the Writer's overlay instead of being flushed (see
`run`'s `dryRun` in `src/server/db.ts`), so dedupe merges, cross-references and "already there" counts come out the
same as the real run while Firestore is only ever read. Run the surveys on the **emulator against the real
snapshots** first: same data, same reports, zero risk.

```
npm run import:booking -- --dry-run --report=/tmp/survey-booking.json      # emulator, real snapshots
npm run import:show-income -- --dry-run --report=/tmp/survey-income.json
npm run import:gas -- --dry-run --report=/tmp/survey-gas.json
```

### Order for the band's real data
Backup first, always. Then, per import: **survey → read it → fix or accept each issue → `--yes` → run it a second
time and confirm it reports everything unchanged** (every importer uses fixed ids and claims idempotency; a doubled
income line is real money shown wrong).
```
npm run backup -- --out backups                  # before anything
tsx scripts/wipe.ts --dry-run                    # see what would go (npm run wipe is emulator-only)
tsx scripts/wipe.ts --yes --project=roadie-prod-iab   # empties Firestore and Auth
npm run seed-real:prod -- --yes                  # the artist and the five people
npm run import:booking:prod -- --dry-run         # the survey; then --yes, then --dry-run again
npm run import:booking:prod -- --yes             # venues, festivals, contacts, pitches, shows
npm run import:show-income:prod -- --dry-run     # survey, then --yes
npm run import:show-income:prod -- --yes         # money and ratings onto those shows
npm run import:gas:prod -- --dry-run             # survey: check it names Eric Example, by email
npm run import:gas:prod -- --yes                 # Eric Example's drives
```
Every `:prod` line takes `GOOGLE_APPLICATION_CREDENTIALS=./key.json` in front of it, as above.
The order is forced: income matches rows to shows that must already exist, and gas matches drives to show dates.

The gas import resolves its musician by **email** (`musicianEmail` in the snapshot), with the full name as a
fallback. The sheet says "Eric" and the roster says "Eric Example", so a name-only match found nobody and skipped
every row while still reporting success; it now fails the run instead. The gas survey prints which musician and
login every row resolved to, by name and email — check that line before the real run.

## Moving old history under its records (one time)
History used to be one top-level `history` collection. It is now a `history` subcollection under each record (`venues/{id}/history/000002`), which backup and restore already carry because they walk sub-collections (the entries are in their parent collection's file, not in `history.json`). Backups made before the change still contain `history.json`; restoring one puts the old collection back, and the migration then moves it.
```
npm run migrate:history -- --dry-run   # count only, writes nothing
npm run migrate:history                # emulator
npm run migrate:history -- --yes       # real Firestore (refused without --yes)
```
Each old entry becomes `{entity.kind}/{entity.id}/history/{docRev padded}` (entries from before `docRev` existed become `000000-{time}-{oldId}`; two entries claiming one rev are kept side by side). Safe to re-run: ids are derived from the entry, and every move is one batch that writes the new doc and deletes the old, so it finishes where a failed run stopped. Deploy the new rules, indexes and code first.

## Splitting venues into the shared room and the band's notes (one time)
A venue is now two documents: the shared `venues/{id}` (readable by every band user) and each band's private `venueNotes/{artistId}__{venueId}` (load-in notes, notes, contacts, promoters; only that artist's admins read it). Venues written before the split still carry those four fields; the code reads and updates them either way, and this migration moves them. Run it **before** deploying the widened `firestore.rules`.
```
npm run migrate:venue-notes -- --dry-run              # count only, writes nothing
npm run migrate:venue-notes                           # emulator
npm run migrate:venue-notes -- --artist=<slug> --yes  # real Firestore (refused without --yes; --artist only needed with more than one artist)
```
It writes `venueNotes` docs through `db.ts` under one History run (Admin -> History -> that run id -> Undo reverses the venue part), removes the four fields from the venues, and stamps `artistId` (the record's artist, else null) on every existing history entry, which the tightened history rule and the History page's two queries need. History entries that show a band's old private notes are stamped with that band, so other bands' admins cannot read them. Safe to run again. Order for production: backup; deploy the code and `firestore.indexes.json` (the History page's new `artistId` queries need those collection-group indexes, which build for a few minutes); `--dry-run`; `--yes`; then deploy `firestore.rules` last. The tolerated legacy fields in `src/schema/venues.ts` (`venueLegacyShape`) can be deleted after that.
