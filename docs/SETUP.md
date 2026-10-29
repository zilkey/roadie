# Setting up Roadie

How to get the app running on your machine, then live on a real Firebase project called **`roadie-prod-iab`**. Do the parts in order. Each step is either something you do (☐) or something to ask Claude Code to do (🤖).

The production config points at `roadie-prod-iab` (Part 3 is done). Local work and tests still use the offline emulator project `demo-band-tracker`.

---

## Part 1 · Run it on your machine

You already have everything this needs: Node 26, Java 21 and the Firebase CLI 15.34 (installed in the repo, run as `npx firebase`). There's no Firebase account or network involved; everything runs against emulators and local fakes.

```sh
cd ~/workspace/roadie
npm ci
npx playwright install chromium     # first time only, for the e2e tests
npm run dev:all                     # emulators + fakes + Next, one terminal; Ctrl-C stops all
```

In a second terminal, once the emulators are up:

```sh
npm run seed
```

Open http://127.0.0.1:3100 and use a "Sign in as…" button (Jeff or Ingrid are admins). The emulator UI is at http://127.0.0.1:4200.

Check that everything passes:

```sh
npm run typecheck
npm test          # starts its own emulators; stop dev:all first
npm run e2e
```

### Try Roadie's AI locally

```sh
npm run genkit:ui
```

This opens the Genkit Developer UI, where you can run the `assistant.chat` flow and see every model call and tool step. By default it uses the canned test model (`ROADIE_MODEL=fake`). To try real Gemini, get a key at https://aistudio.google.com/apikey and run:

```sh
ROADIE_MODEL=gemini GEMINI_API_KEY=<your key> npm run genkit:ui
```

`ROADIE_GEMINI_MODEL` picks the model (default `gemini-flash-latest`). Start the emulators first (`npm run emulators`).

To run the whole app the way production does (Vertex AI in `roadie-prod-iab`, same default model `gemini-3.5-flash`, same `global` location) against your local emulators and fakes:

```sh
gcloud auth application-default login   # once; your account needs the Vertex AI User role on roadie-prod-iab
npm run dev:vertex
```

`ROADIE_VERTEX_PROJECT` sends only the model calls to the real project; `GCLOUD_PROJECT` stays `demo-band-tracker`, so all data stays in the emulators. Calls are billed to the production project.

### Checking Roadie against the real model

The unit tests drive Roadie with a canned model, which proves the plumbing, not the model. `scripts/roadie-eval.ts` runs
real conversations ("Add SoFar as a venue in Fort Collins and Denver…", "log $12 for gas", "who still needs the new stage
plot?") through the real model and the real web, with a throwaway band in your local emulators, and checks what it did:
which tools it called, how many confirm cards it made, whether it asked instead of acting, whether it said "I can't".
Run it after any change to the prompt, the tools or the model. It starts its own emulators and uses the service-account
key in `.secrets`, so nothing needs to be up and nobody logs in:

```sh
npm run eval:roadie                                  # every scenario
ROADIE_EVAL="sofar-three atrium" npm run eval:roadie  # some
```

It prints each turn's tool calls and reply, then a pass/fail list. Billed to the production project like `dev:vertex`.

The cheap half of that is `npm run check:roadie:vertex`: one tiny call that hands the real model every tool Roadie offers
an admin, as the flow sends them, and fails if the endpoint refuses the schemas (2026-10-29: every Roadie message in prod
died with "required fields ['route'] are not defined" because one enum field had no `type`; the canned model can't see
that). Run it before any push of `main`, since App Hosting deploys every push. It uses the service-account key in
`.secrets` so nobody has to log in, which needs that account to hold the Vertex AI User role once:

```sh
gcloud projects add-iam-policy-binding roadie-prod-iab \
  --member=serviceAccount:firebase-adminsdk-fbsvc@roadie-prod-iab.iam.gserviceaccount.com --role=roles/aiplatform.user
```

`npm run check:roadie` is the same call through the Gemini API key in `.secrets` (its validation is stricter, which is
useful, but that key's prepaid credit was empty on 2026-10-29).

---

## Part 2 · Create `roadie-prod-iab`

### 2.1 Put the code on GitHub

☑ Done: `https://github.com/zilkey/roadie`, **public by design** (open source). App Hosting deploys from it.

Because it's public, nothing secret is ever committed: no service-account keys, OAuth secrets or API keys. Those go in App Hosting secrets (`npx firebase apphosting:secrets:set <name> --project roadie-prod-iab`). The web config in `apphosting.yaml` is fine to publish; it only identifies the project.

GitHub secret scanning flags the `NEXT_PUBLIC_FIREBASE_API_KEY` in `apphosting.yaml` as a "Google API Key". It is the Firebase browser key, which every visitor's browser receives anyway; resolve the alert as a false positive. What keeps it harmless is its API restriction, auto-created by Firebase: `gcloud services api-keys list --project roadie-prod-iab` must show it limited to Firebase services (Identity Toolkit, Firestore, etc.) and never `generativelanguage.googleapis.com` or `aiplatform.googleapis.com`. The Gemini key for local `ROADIE_MODEL=gemini` runs is a separate key and stays out of the repo.

### 2.2 Create the project

```sh
npx firebase login
npx firebase projects:create roadie-prod-iab --display-name "Roadie"
```

☐ Done: the project ID is **`roadie-prod-iab`** (display name "Roadie"). `roadie-production` was already taken by someone else.

### 2.3 Billing

☐ Console → `roadie-prod-iab` → bottom-left **Upgrade** → **Blaze**. App Hosting, Vertex AI and the server's Admin SDK need it. One band's use stays inside the free quotas.
☐ Set a budget alert: Google Cloud console → Billing → Budgets & alerts → $10/month, alerts at 50/90/100%.

### 2.4 Firestore

☐ Console → **Firestore Database** → Create database → **Production mode** → location **`nam5` (United States)**. The location can't be changed later.

### 2.5 Sign-in

☐ Console → **Authentication** → Get started → Sign-in method → **Google** → Enable, and set the support email to yours.
☐ Authentication → Settings → **User account linking**: keep "Link accounts that use the same email". People are invited by email, and their first Google sign-in has to land on that same account.

### 2.6 Web app config

```sh
npx firebase apps:create WEB roadie-web --project roadie-prod-iab
npx firebase apps:sdkconfig WEB --project roadie-prod-iab
```

☐ Keep the printed `apiKey`, `authDomain`, `projectId` and `appId`; Part 3 needs them. They aren't secret; they end up in the browser.

### 2.7 Turn on the AI APIs (for Roadie)

☐ Google Cloud console → APIs & Services → Library → enable **Vertex AI API**.

---

## Part 3 · Rename

☑ Done (🤖). What changed:

- `.firebaserc` has `"prod": "roadie-prod-iab"`. `default` stays `demo-band-tracker`, so tests never touch the real project.
- `apphosting.yaml` holds the web config, `GCLOUD_PROJECT=roadie-prod-iab` and `ROADIE_MODEL=vertex`. `APP_URL` is the backend URL.
- `.github/workflows/backup.yml`, `scripts/bootstrap-admin.ts`, `docs/FIREBASE-SETUP.md`, `docs/BACKUP.md` and `docs/MCP.md` say `roadie-prod-iab`.
- Roadie uses Vertex AI in production (the backend's service account, same Google bill, no key; default model `gemini-3.5-flash` in the `global` location; Gemini 2.5 shut down in October 2026). A `GEMINI_API_KEY` still works for trying it locally.

Not renamed yet: the npm package and the emulator project id.

---

## Part 4 · Deploy

### 4.1 Rules and indexes

```sh
npx firebase deploy --only firestore --project roadie-prod-iab
```

This deploys rules, indexes and TTL policies together. Then check Console → Firestore → TTL to confirm the policies are active (see `docs/BACKLOG.md`, "Before or at go-live").

### 4.2 App Hosting backend

```sh
npx firebase apphosting:backends:create --project roadie-prod-iab
```

☐ Answer the prompts: region `us-central1`, connect GitHub, choose the `roadie` repo, root directory `/`, live branch `main`, backend name `roadie`. It deploys on every push to `main`.
☐ Console → App Hosting → `roadie`: note the URL (`https://roadie--roadie-prod-iab.us-central1.hosted.app` or similar).
☐ Authentication → Settings → **Authorized domains** → add that hostname (and any custom domain).
☐ Ask Claude Code to put that URL in `apphosting.yaml` as `APP_URL`; it's the base of the "can you play?" links. Push.

### 4.3 Permissions for the server

☐ Google Cloud console → IAM → find the App Hosting service account (`firebase-app-hosting-compute@roadie-prod-iab.iam.gserviceaccount.com`) → make sure it has **Cloud Datastore User**, **Firebase Authentication Admin** and **Vertex AI User**.

### 4.4 The first admin

The app is invite-only, so the first admin is created from your machine.

☐ Console → Project settings → Service accounts → **Generate new private key**. Move it into `.secrets/` in the repo (gitignored, along with any `*firebase-adminsdk*.json`; the repo is public, so never anywhere else in it).
☐ Run (the `env -u` drops any emulator variables so it can't write to the emulator by mistake):

```sh
env -u FIRESTORE_EMULATOR_HOST -u FIREBASE_AUTH_EMULATOR_HOST \
  GCLOUD_PROJECT=roadie-prod-iab \
  GOOGLE_APPLICATION_CREDENTIALS=.secrets/roadie-prod-iab-firebase-adminsdk-fbsvc-ec7be59afd.json \
  npx tsx scripts/bootstrap-admin.ts <your-google-email> "<Your Name>" ["<Artist name>"]
```

☐ Delete the key file and revoke it on the same Service accounts page.
☐ Open the App Hosting URL and sign in with Google as that account. Invite everyone else at **Admin → Users**.

### 4.5 Smoke test

☐ You land on Home and there are no "Sign in as" buttons.
☐ Invite a second Google account as a member and sign in with it in a private window. It has no Booking tab and does have "My money". An account you didn't invite gets "not invited".
☐ Add a venue, edit a field (it saves by itself), then check Admin → History and undo it.
☐ Start a new show, close the tab, open it on your phone: the draft is there.
☐ Open Roadie (left panel) and say hi.
☐ Check the browser console on Home, Shows and Money for permission or missing-index errors. If you see "query requires an index", click its link, then ask Claude Code to copy the result into `firestore.indexes.json`.

---

## Part 5 · Later (the app runs without these)

Gmail, Drive and Calendar have real clients: they turn on once the Google OAuth client and its secrets are set (`docs/FIREBASE-SETUP.md` section 5) and each admin connects on Settings > Google. Bandsintown and Spotify are still faked, so those features error in production until their real clients are written (sections 6–7). MCP hosting and the nightly backup are in sections 10–11. Do them when you want each feature live.
