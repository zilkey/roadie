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
