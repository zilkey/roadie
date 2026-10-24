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
