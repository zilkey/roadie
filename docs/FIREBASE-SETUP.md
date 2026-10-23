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
