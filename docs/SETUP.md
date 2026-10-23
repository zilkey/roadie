# Setting up Roadie

How to get the app running on your machine, then live on a real Firebase project called **`roadie-production`**. Do the parts in order. Each step is either something you do (☐) or something to ask Claude Code to do (🤖).

The code still calls itself `band-tracker` / `demo-band-tracker`. Part 3 is the rename, and it waits until the project exists.

---

## Part 1 · Run it on your machine

You already have everything this needs: Node 26, Java 21 and the Firebase CLI 15.34 (installed in the repo, run as `npx firebase`). There's no Firebase account or network involved; everything runs against emulators and local fakes.

```sh
cd ~/workspace/band-tracker
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

---

## Part 2 · Create `roadie-production`

### 2.1 Put the code on GitHub

App Hosting deploys from GitHub, and the repo has no remote yet.

☐ Create a **private** GitHub repo (e.g. `roadie`). Don't add a README or license.
☐ Push:

```sh
git remote add origin git@github.com:<you>/roadie.git
git push -u origin main
```

### 2.2 Create the project

```sh
npx firebase login
npx firebase projects:create roadie-production --display-name "Roadie"
```

☐ **Project IDs are global.** If `roadie-production` is taken, the command fails. Pick another ID (e.g. `roadie-production-iab`) and use it everywhere this doc says `roadie-production`.

### 2.3 Billing

☐ Console → `roadie-production` → bottom-left **Upgrade** → **Blaze**. App Hosting, Vertex AI and the server's Admin SDK need it. One band's use stays inside the free quotas.
☐ Set a budget alert: Google Cloud console → Billing → Budgets & alerts → $10/month, alerts at 50/90/100%.

### 2.4 Firestore

☐ Console → **Firestore Database** → Create database → **Production mode** → location **`nam5` (United States)**. The location can't be changed later.

### 2.5 Sign-in

☐ Console → **Authentication** → Get started → Sign-in method → **Google** → Enable, and set the support email to yours.
☐ Authentication → Settings → **User account linking**: keep "Link accounts that use the same email". People are invited by email, and their first Google sign-in has to land on that same account.

### 2.6 Web app config

```sh
npx firebase apps:create WEB roadie-web --project roadie-production
npx firebase apps:sdkconfig WEB --project roadie-production
```

☐ Keep the printed `apiKey`, `authDomain`, `projectId` and `appId`; Part 3 needs them. They aren't secret; they end up in the browser.

### 2.7 Turn on the AI APIs (for Roadie)

☐ Google Cloud console → APIs & Services → Library → enable **Vertex AI API**.

---

## Part 3 · Rename (🤖 ask Claude Code)

Once Part 2 is done, tell Claude Code: *"The project is created as `roadie-production`; here is the web config: …. Do the rename."* That change will:

- add `"prod": "roadie-production"` to `.firebaserc`. `default` stays `demo-band-tracker` so tests never touch the real project.
- create `apphosting.yaml` with your web config and `GCLOUD_PROJECT=roadie-production`. Leave `NEXT_PUBLIC_USE_EMULATORS` and the `*_EMULATOR_HOST` variables out of it so production never shows the dev sign-in buttons.
- set `GCLOUD_PROJECT: roadie-production` in `.github/workflows/backup.yml`.
- update `scripts/bootstrap-admin.ts`, `docs/FIREBASE-SETUP.md`, `docs/BACKUP.md`, `docs/MCP.md` and the README from `band-tracker` to `roadie-production`.
- rename the npm package, the app title and the emulator ID (`demo-band-tracker` → `demo-roadie`) everywhere they appear, then re-run the full test suite.
- point Roadie at Vertex AI rather than an API key in production, which is what the spec asks for. That way it runs on the same Google bill and needs no key.

Then commit and push.

---

## Part 4 · Deploy

### 4.1 Rules and indexes

```sh
npx firebase deploy --only firestore --project roadie-production
```

### 4.2 App Hosting backend

```sh
npx firebase apphosting:backends:create --project roadie-production
```

☐ Answer the prompts: region `us-central1`, connect GitHub, choose the `roadie` repo, root directory `/`, live branch `main`, backend name `roadie`. It deploys on every push to `main`.
☐ Console → App Hosting → `roadie`: note the URL (`https://roadie--roadie-production.us-central1.hosted.app` or similar).
☐ Authentication → Settings → **Authorized domains** → add that hostname (and any custom domain).
☐ Ask Claude Code to put that URL in `apphosting.yaml` as `APP_URL`; it's the base of the "can you play?" links. Push.

### 4.3 Permissions for the server

☐ Google Cloud console → IAM → find the App Hosting service account (`firebase-app-hosting-compute@roadie-production.iam.gserviceaccount.com`) → make sure it has **Cloud Datastore User**, **Firebase Authentication Admin** and **Vertex AI User**.

### 4.4 The first admin

The app is invite-only, so the first admin is created from your machine.

☐ Console → Project settings → Service accounts → **Generate new private key**. Save it outside the repo, e.g. `~/keys/roadie-production.json`.
☐ In a fresh terminal where no `*_EMULATOR_HOST` variables are set:

```sh
GCLOUD_PROJECT=roadie-production GOOGLE_APPLICATION_CREDENTIALS=~/keys/roadie-production.json \
  npx tsx scripts/bootstrap-admin.ts <your-google-email> "<Your Name>"
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

Gmail, Drive, Calendar, Bandsintown and Spotify are still faked, so those features will error in production until their real clients are written. The steps, the code each one needs, MCP hosting and the nightly backup are all in `docs/FIREBASE-SETUP.md` sections 5–7 and 10–11. Do them when you want each feature live.
