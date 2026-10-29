---
name: local-backup
description: Back up production Firestore (roadie-prod-iab) to backups/<date> and load a backup into the local emulator so the app at localhost:3100 runs on real data, including the Auth-emulator step that stops "Account is not active". Use when asked to "back up prod", "restore prod locally", "load prod into the emulator", "refresh local data from prod", or when a local command fails with "Account is not active" after a restore.
---

# Local backup and restore

Two jobs, often done together: take a backup of prod, and load a backup into the local emulator.
Backups live in `backups/` (gitignored). The scripts are `scripts/backup.ts`, `scripts/restore.ts` and
`scripts/align-auth.ts`; `docs/BACKUP.md` has the long version.

Restore **never** targets real Firestore from this skill. `npm run restore` refuses without an emulator host unless
`--yes` is passed; never pass `--yes`.

## 1. Back up prod

Needs Application Default Credentials. If the backup fails with `invalid_rapt` or a credential error, ask Jeff to
run `gcloud auth application-default login` and stop; do not lift tokens from the Firebase CLI's config.

```sh
GCLOUD_PROJECT=roadie-prod-iab npm run backup -- --out backups
```

Writes `backups/YYYY-MM-DD/<collection>.json` plus `_manifest.json` (UTC date; a second run the same day
overwrites that folder, so pass `--date <label>` to keep both). Check `_manifest.json` says
`"project": "roadie-prod-iab"` and print the counts.

## 2. Load a backup into the emulator

The emulator must be running (`npm run dev:all`, or `npm run emulators`; Firestore on 8280, Auth on 9319).

```sh
npm run restore -- backups/<folder> --dry-run      # validate; fix or stop if any document fails
npm run wipe -- --yes                               # empties the emulator; it backs the emulator up first
npm run restore -- backups/<folder>
npm run align-auth
```

- `--dry-run` validates every document against the Zod schemas; nothing is written if one fails. A schema that
  moved on since the backup shows up here as validation errors, which means the backup needs migrating, not forcing.
- Wipe rather than `--overwrite`: overwrite leaves documents the backup does not have (seed data, local drafts).
- `align-auth` is the step people forget. Backups carry no Auth accounts; the Auth emulator's account for an
  email has its own uid, but `authenticate` in `src/server/commands/dispatch.ts` looks `users` up by the token's
  uid. Without this step pages render (session matches by email) and every command fails with
  **"Account is not active"**. The script deletes each local account and recreates it with the users doc id as uid,
  then syncs claims. It refuses to run without an Auth emulator host.

Then tell Jeff to **sign out and back in**: the browser's ID token still carries the old uid until he does.

## 3. Back up the emulator

`npm run backup -- --out backups --date local-<label>` with the emulator env, e.g.

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8280 GCLOUD_PROJECT=demo-band-tracker npm run backup -- --out backups --date local-before-<thing>
```

`npm run wipe` does this on its own before deleting (folder named with local date and time to the second).

## Rules

- Never run `npm run wipe` or `scripts/wipe.ts` with `GCLOUD_PROJECT=roadie-prod-iab`.
- Never pass `--yes` to `npm run restore`.
- Don't run the test suites after a restore (see the no-test-runs rule); a type check is fine.
- Prod data on the emulator is real band data: don't paste documents into chat beyond what the question needs.
