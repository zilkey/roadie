# Firebase setup for band-tracker

Manual steps to move from the local emulators (demo-band-tracker) to a real Firebase project.

## Collected items

### Slice 1 (Foundation)
- Create the Firebase project `band-tracker`; enable Firestore (production mode) and Authentication with the **Google** provider. Add the web app and put its config in `.env.production` as `NEXT_PUBLIC_FIREBASE_*` (apiKey, authDomain, projectId, appId). Do NOT set `NEXT_PUBLIC_USE_EMULATORS` there (it hides the dev sign-in buttons).
- Auth setting "One account per email address" must stay ON (default). `users.add` pre-creates the Auth user by email, and the first Google sign-in must reuse that uid, because `users/{uid}` doc ids and rule checks (`payeeUserId == request.auth.uid`) depend on it. Verify with one real invite.
- Add the production domain to Authentication > Settings > Authorized domains.
- Server credentials: run Next on a host with a service account (`GOOGLE_APPLICATION_CREDENTIALS` or ADC) for `firebase-admin`; set `GCLOUD_PROJECT=band-tracker`. Unset the `*_EMULATOR_HOST` vars in production (they live in `.env.development` only).
- Deploy `firestore.rules` and `firestore.indexes.json` (`npx firebase deploy --only firestore --project band-tracker`).
- Create the first admin by hand: add an Auth user + `users/{uid}` doc (role admin) + custom claim `{role:'admin'}` via a one-off script, or run `users.add` through a dev machine pointed at the real project. After that, admins invite everyone from `/admin/users`.

## Slice 2: Fakes + integrations (real APIs to swap in)
Each client in `src/server/integrations/<svc>.ts` reads `<SVC>_BASE_URL` (GMAIL, DRIVE, CALENDAR, BANDSINTOWN, SPOTIFY) and defaults to the fake. To go real, write a second implementation of the same interface and choose it by env. One Google Cloud project (the Firebase project's) can host the OAuth client.
- **Google OAuth consent screen + client**: enable the Gmail, Drive and Calendar APIs. Consent screen "Internal" if the band is a Workspace org, otherwise "External" in Testing with the band's addresses as test users (sensitive scopes need app verification for public use). Server stores each admin's refresh token (encrypted) for the account that sends mail / owns the Drive grant.
- **Gmail**: `https://www.googleapis.com/auth/gmail.send` (send), `gmail.compose` (create drafts), `gmail.readonly` (list threads/messages for the pitch timeline; replies are detected by polling `users.threads.get`). Gmail has no "simulate reply"; the fake-only `simulateReply` is optional on the interface.
- **Drive**: `https://www.googleapis.com/auth/drive` (search across files the band does not own, `permissions.list`/`create`, `files.copy` into the band folder). `drive.file` alone is not enough because it only sees files the app created. Use `files.list` with `q="name contains '...' and trashed=false"` and `fields=files(id,name,mimeType,owners,parents,permissions)`. Set the band folder id as the artist's `driveFolderId`.
- **Calendar**: `https://www.googleapis.com/auth/calendar.events`; `events.insert/patch/delete/list` with `sendUpdates=all` so attendees get invites.
- **Bandsintown**: the public API is read-only. Writing events needs Bandsintown for Artists / a partner `app_id` and artist access approval (request via Bandsintown support). Until approved, keep the fake or export a CSV.
- **Spotify**: Web API, client-credentials flow (client id + secret, no user scopes): `GET /v1/artists/{id}` for `followers.total` and `popularity`, `GET /v1/artists/{id}/top-tracks?market=US`. There is no history endpoint, so a daily job stores statSnapshots; "plays" in the fake's top tracks has no real equivalent (use Spotify for Artists CSV).

### Slice 3 (Booking)
- Gmail: replace the fake client with real Gmail API calls (`gmail.send`, `gmail.readonly` for `pitches.checkReplies`). The send account is the signed-in admin's email, so each admin who sends needs their own OAuth grant.
- No new Firestore indexes: booking queries are single-field (`target.id`, `venue.id`, `festivalId`, `contactIds` array-contains).

### Slice 4 (Shows)
- Set `APP_URL` (e.g. `https://band-tracker.web.app`) on the server: it is the base of the availability answer links in emails (`/ask/{id}/{musicianId}/{token}`). The default is `http://127.0.0.1:3100`.
- `/ask/*` and `/api/availability/*` are public by design (no login; the token is the credential, stored only as a SHA-256 hash). Nothing in Firebase needs to be opened for them: the server reads/writes with the admin SDK.
- Calendar (real client): events need `timeZone` (America/Denver) alongside the local `start`/`end` strings, and `attendees` from musician emails with `sendUpdates=all`. Subs without an email are skipped.
- Bandsintown (real client): same approval caveat as slice 2. Until approved, listings stay in the fake or show `state: "error"` with the message; `shows.sync` retries.
- No new Firestore indexes: queries are single-field (`pitchId ==`, `venue.id ==`, `askedMusicianIds array-contains`).

### Slice 5 (Music)
- Set the real band folder id on the artist (`driveFolderId`, Admin > Artist) or `DRIVE_BAND_FOLDER_ID`; "in band folder" and "Copy to band folder" depend on it.
- The real Drive client needs `drive` scope (read permissions, copy, create permissions) so the sharing check can list permissions and the fixes can copy/share. Group or domain-wide sharing would need extra handling in `src/server/music.ts` `missingFor`.
- Inline playback for real files: store the `https://drive.google.com/file/d/ID/view` link as `url`; the app embeds Drive's `/preview` player.

### Slice 6 (Money + Reach)
- Deploy the updated `firestore.rules` (members read their own ledger rows: payouts, reimbursements, corrections with `payeeUserId == uid`). Member queries use `payeeUserId ==`, `kind in [...]`, `deletedAt ==` together; no composite index file changes were needed on the emulator, but Firestore in production may ask for an index for that combination: create it from the link in the console error.
- Daily Spotify pull: schedule `scripts/stats-pull.ts` (or call `stats.pull`) once a day, e.g. Cloud Scheduler / GitHub Actions cron, with real `SPOTIFY_BASE_URL` credentials (client-credentials). Spotify for Artists has no API: export the audience CSV by hand and import it on /stats.
- Receipts are Drive links; the real Drive client must let members search (`receipts.search` runs as the app's Drive account).

### Slice 7 (MCP + safety net)
- MCP server: runs wherever the Node app can reach Firestore (`npm run mcp`, port 3300). For the real project give it a service account (`GOOGLE_APPLICATION_CREDENTIALS`) and `GCLOUD_PROJECT=band-tracker`. Put it behind HTTPS (Cloud Run, or a tunnel) before exposing it beyond localhost; the bearer token is the only credential. See `docs/MCP.md`.
- Deploy the updated `firestore.rules` is not needed (history and mcpTokens were already admin-read). History queries use equality filters only (`runId`, `actor.via`, `entity.kind`, `deletedAt`), so no composite indexes; `history.myRuns` uses `actor.uid ==`.
- Backup: create the private backup repo, a read-only service account, and the GitHub secrets listed in `docs/BACKUP.md`.
