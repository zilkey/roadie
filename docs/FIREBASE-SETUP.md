# Taking Band Tracker to a real Firebase project (`roadie-prod-iab`)

One ordered checklist. Everything below is manual; nothing has been run against a real project. Where the app needs code that does not exist yet, the step says **CODE NEEDED**. Replace `YOU` with the first admin's Google email.

## 1. Create the project

- [ ] Create a Firebase project with id **`roadie-prod-iab`** (console.firebase.google.com). Skip Analytics.
- [ ] Upgrade to the Blaze plan (billing). App Hosting and the Admin SDK server need it; usage for one band stays in the free quotas.
- [ ] Install the CLI locally (`npx firebase login`) and set the alias: `npx firebase use --add roadie-prod-iab` (alias `prod`; leave `default` as `demo-band-tracker` so tests stay offline).

## 2. Firestore, rules and indexes

- [ ] Console > Firestore Database > Create database, **production mode**, a US region (e.g. `us-central1` or `nam5`; it cannot be changed later).
- [ ] Deploy rules and indexes: `npx firebase deploy --only firestore --project roadie-prod-iab`.
- [ ] After the first real use, watch for "query requires an index" errors in the browser console. The member ledger query (`payeeUserId ==`, `kind in [...]`, `deletedAt ==`) may want one; click the link in the error, then copy the result into `firestore.indexes.json` and redeploy.

## 3. Authentication (Google sign-in)

- [ ] Console > Authentication > Get started > Sign-in method > enable **Google**; set the public support email.
- [ ] Authentication > Settings > User account linking: keep **"Link accounts that use the same email"** (one account per email). `users.add` pre-creates the Auth user by email and the first Google sign-in must reuse that uid.
- [ ] Authentication > Settings > Authorized domains: add the production domain (the App Hosting `*.web.app` / `*.hosted.app` domain and any custom domain). `localhost` is there by default.
- [ ] Project settings > Your apps > add a **Web app**; copy its config for step 4.

## 4. App Hosting

- [ ] Console > App Hosting > Get started: connect the GitHub repo, live branch `main`, root directory `/`, create the backend (e.g. `roadie-prod-iab`, same region as Firestore).
- [x] `apphosting.yaml` exists at the repo root (see it for the current values). The shape, for reference:

```yaml
runConfig:
  minInstances: 0
  maxInstances: 2
env:
  - variable: NEXT_PUBLIC_FIREBASE_API_KEY
    value: <web app apiKey>
    availability: [BUILD, RUNTIME]
  - variable: NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
    value: roadie-prod-iab.firebaseapp.com
    availability: [BUILD, RUNTIME]
  - variable: NEXT_PUBLIC_FIREBASE_PROJECT_ID
    value: roadie-prod-iab
    availability: [BUILD, RUNTIME]
  - variable: NEXT_PUBLIC_FIREBASE_APP_ID
    value: <web app appId>
    availability: [BUILD, RUNTIME]
  - variable: GCLOUD_PROJECT
    value: roadie-prod-iab
  - variable: APP_URL            # base of the "can you play?" links in emails
    value: https://<your production domain>
  # Do NOT set NEXT_PUBLIC_USE_EMULATORS (it shows the dev sign-in buttons) or any *_EMULATOR_HOST.
  # Until the real clients exist (step 6) leave the *_BASE_URL variables unset; the defaults point at 127.0.0.1 fakes,
  # so email, Drive, Calendar, Bandsintown and Spotify features will error in production.
  # Secrets (step 5/7) go here once the clients read them:
  # - variable: GOOGLE_OAUTH_CLIENT_SECRET
  #   secret: google-oauth-client-secret
```

- [ ] Secrets: `npx firebase apphosting:secrets:set <name> --project roadie-prod-iab`, then reference them in `apphosting.yaml`, and `apphosting:secrets:grantaccess`.
- [ ] The backend's service account needs the **Cloud Datastore User** and **Firebase Authentication Admin** roles (IAM) so `firebase-admin` can write Firestore and set custom claims. (Default App Hosting service accounts often have Datastore access; verify `setCustomUserClaims` works in the smoke test.)
- [ ] Push to `main` and confirm the rollout succeeds. `.env.development` is only read by `next dev`, so it does not leak into production.

## 5. Google Cloud OAuth (Gmail, Drive, Calendar)

The Google clients are not written (step 6). This step prepares what they will need. One Google Cloud project (the Firebase project's) hosts it.

- [ ] APIs & Services > Library: enable **Gmail API**, **Google Drive API**, **Google Calendar API**.
- [ ] OAuth consent screen: **Internal** if the band's accounts are in one Workspace org; otherwise **External**, publishing status Testing, and add every admin's Google address as a **test user** (refresh tokens for Testing apps expire after 7 days; move to In production, and accept the "unverified app" warning or go through verification, to avoid that).
- [ ] Add scopes: `https://www.googleapis.com/auth/gmail.send`, `gmail.compose` (drafts), `gmail.readonly` (reply checking), `https://www.googleapis.com/auth/drive` (needs full Drive: search files the band does not own, read permissions, copy, share; `drive.file` is not enough), `https://www.googleapis.com/auth/calendar.events`.
- [ ] Credentials > Create **OAuth client ID** (Web application). Authorized redirect URI: `https://<production domain>/api/google/callback`. Store client id and secret as App Hosting secrets.
- [ ] **How each admin connects (CODE NEEDED):** mail is sent as the signed-in admin, so each admin who sends mail or owns the Drive/Calendar grant must connect once: a "Connect Google" button on an admin page that runs the OAuth code flow (`access_type=offline`, `prompt=consent`), and a server route `/api/google/callback` that stores the refresh token (encrypted, per user, server-only; never in a client-readable collection). Neither the button, the route nor the token store exists yet.
- [ ] Set the band's Drive folder id on the artist (Admin > Artist > `driveFolderId`) or `DRIVE_BAND_FOLDER_ID`.

## 6. Real integration implementations (CODE NEEDED, all of them)

Each file below defines an interface plus an HTTP client for the fake. Write a second implementation of the same interface using the real API and choose it by env (e.g. `GMAIL_BASE_URL` unset and `GOOGLE_*` present means real). Keep the fakes for tests.

- [ ] `src/server/integrations/gmail.ts`: `users.messages.send`, `users.drafts.create`, `users.threads.list/get` (replies are detected by polling the thread). The fake-only `simulateReply` stays optional.
- [ ] `src/server/integrations/drive.ts`: `files.list` (`q="name contains '...' and trashed=false"`, fields incl. `owners, parents, permissions`), `permissions.list/create`, `files.copy` into the band folder. Group/domain/"anyone with link" sharing needs handling in `src/server/music.ts` `missingFor`. Receipt search runs as the connected admin's Drive account.
- [ ] `src/server/integrations/calendar.ts`: `events.insert/patch/delete/list` with `sendUpdates=all`. The payload already carries `timeZone: "America/Denver"` and local start/end strings (built in `src/server/showSync.ts`); attendees are musician emails.
- [ ] `src/server/integrations/bandsintown.ts`: see step 7 (needs approval; the public API is read-only).
- [ ] `src/server/integrations/spotify.ts`: Web API client-credentials flow, `GET /v1/artists/{id}` (followers, popularity) and top tracks (market US). No history endpoint exists.
- [ ] `src/server/integrations/index.ts`: the factory (`gmailClient()`, ...) that picks fake vs real.
- [ ] Optional hardening: log the sent email before/with the send so a log failure can't lose it (`pitches.sendEmail` in `src/server/commands/booking.ts`).

## 7. Bandsintown and Spotify credentials

- [ ] **Bandsintown:** writing events needs Bandsintown for Artists / a partner `app_id` and approved artist access (ask Bandsintown support). Until then keep listings off (shows default to not public) or use the fake in non-production only. Store the `app_id` as an App Hosting secret.
- [ ] **Spotify:** create an app at developer.spotify.com/dashboard; copy client id and secret into App Hosting secrets (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, names are yours to wire in `spotify.ts`). Put the Spotify artist id on the artist record.
- [ ] **Spotify for Artists** has no API: export the audience CSV by hand and upload it on `/stats`. Its column headers were guessed; check them against a real export and adjust `HEADS` in `src/lib/stats.ts`.

## 8. Bootstrap the first admin

The app is invite-only; the first admin has to be created outside the app. `scripts/bootstrap-admin.ts` does it: creates the artist if there is none yet (third argument: its name; its URL name, `/artists/{slug}`, comes from that), then the Auth user and the `users/{uid}` doc (admin of that artist, `artists: [{artistId, role: "admin"}]`) via the normal `users.add` command, and the `{artists: {artistId: "admin"}}` custom claim. Safe to repeat.

Existing data from before artists had URLs (artists without `slug`, users with a single `role`): run `npm run migrate:artists -- --dry-run`, then `-- --yes` (see `scripts/migrate-artists.ts`).

- [ ] Create a service-account key: Project settings > Service accounts > Generate new private key (keep it out of the repo; `*.json` keys must never be committed).
- [ ] Run (from the repo root, with `npm ci` done):

```
GCLOUD_PROJECT=roadie-prod-iab GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
  npx tsx scripts/bootstrap-admin.ts YOU@gmail.com "Your Name" "Ingrid Avison Band"
```

- [ ] Make sure no `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` is set in that shell (otherwise it writes to the emulator).
- [ ] Sign in to the app with that Google account. Then invite everyone else and add musicians at **Settings > People**. Delete the key afterwards.

## 9. Replace `demo-band-tracker`

The id `demo-band-tracker` is correct for local work and tests and should stay in most places. Change only what runs in production:

- [ ] `apphosting.yaml` (step 4): real values for `NEXT_PUBLIC_FIREBASE_*` and `GCLOUD_PROJECT`.
- [ ] `.firebaserc`: add `"prod": "roadie-prod-iab"` next to `default` (keep `default` demo so `npm test`/`e2e` stay offline); deploy with `--project roadie-prod-iab`.
- [ ] `src/server/admin.ts`: the fallback project id `demo-band-tracker` (only used when no env is set; production sets `GCLOUD_PROJECT`).
- [ ] `src/lib/firebase-client.ts`: fallbacks `demo-key`, `demo-band-tracker.firebaseapp.com`, `demo-band-tracker`, `demo-app` (production sets `NEXT_PUBLIC_FIREBASE_*`; consider throwing instead when missing in production).
- [ ] `mcp/env.ts`: defaults to the demo emulator only when no real `GCLOUD_PROJECT` / credentials are set; nothing to change, but check the MCP host sets `GCLOUD_PROJECT=roadie-prod-iab`.
- [ ] `.github/workflows/backup.yml`: already `GCLOUD_PROJECT: roadie-prod-iab`.
- [ ] Leave as is (local/test only): `.env.development`, `package.json` scripts (`emulators`, `seed`, `test`, `e2e`, `stats:pull`), `playwright.config.ts`, `scripts/dev-all.ts`, `scripts/seed.ts`, `tests/unit/helpers.ts`, `tests/unit/rules.test.ts`, `PLAN.md`. Never run `npm run seed` against the real project.

## 10. Scheduled jobs

- [ ] **Daily Spotify pull (CODE NEEDED for the schedule):** `scripts/stats-pull.ts` exists but is hard-wired to the emulator in `npm run stats:pull`, and no schedule exists. Either add a GitHub Actions cron (like `backup.yml`) that runs it with `GCLOUD_PROJECT=roadie-prod-iab`, the service-account secret and the Spotify secrets, or a Cloud Scheduler job calling a small authenticated route that runs the `stats.pull` command. Charts only start filling from the first run.
- [ ] **Backup workflow** (`.github/workflows/backup.yml`, never run): create a private repo for backups; create a service account with **Cloud Datastore Viewer** and a JSON key; add Actions secrets `FIREBASE_SERVICE_ACCOUNT` (the key JSON) and `BACKUP_REPO_TOKEN` (fine-grained PAT, Contents read/write on the backup repo only) and variable `BACKUP_REPO` (`owner/repo`). Run "Nightly backup" once by hand and check the commit. Details and restore in `docs/BACKUP.md`.

## 11. MCP hosting and tokens

- [ ] MCP: the app serves it at `APP_URL/mcp`, nothing separate to host. Set the `MCP_SESSION_SECRET` secret and uncomment it in `apphosting.yaml` (commands in `docs/MCP.md`). It uses the real integration env from step 6 or its Gmail/Drive/Calendar tools will fail.
- [ ] In the app: Admin > Users > tick AI access for the person, then Admin > AI keys > create a key (shown once, only its hash is stored; revoke there).
- [ ] Connect Claude Code as in `docs/MCP.md` (`claude mcp add --transport http roadie-prod-iab https://<host>/mcp --header "Authorization: Bearer btk_..."`).

## 12. Smoke test after deploy

- [ ] Open the production URL, sign in with Google as the bootstrapped admin: you land on Home, no "Sign in as" dev buttons.
- [ ] Admin > Users: invite a second Google account as member; sign in with it in a private window: lands on Home, no Booking tab, "My money" present. A non-invited Google account gets the "not invited" page.
- [ ] As admin add a venue, flag it, move the pitch; Admin > History shows the run; Undo this run reverts it.
- [ ] Create a show ("Booked it"). With step 6 done: the Calendar event appears with `America/Denver` times and attendees get invites; send a test pitch email to yourself; attach a Drive file and run the sharing check.
- [ ] Ask who's free from a show: the emailed link opens `/ask/...` with no login and the answer shows in the app.
- [ ] Money: add an expense as the member, reimburse it as admin, check My money.
- [ ] Browser console: no Firestore permission errors or missing-index errors on Home, Shows, Money.
- [ ] Run `npm run backup -- --out backups` against the real project once (with credentials), or trigger the backup workflow.
