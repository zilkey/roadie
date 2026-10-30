// End-to-end tests. `npm run e2e` starts the test emulators (firebase.test.json), seeds them, then runs this.
// Everything here is the test run's own: Next on 3110 building into .next-test, fakes on 3211-3217 with state in
// .fake-data-test, emulators on 8290 and 9329. A running `npm run dev:all` is never reused or touched.
import { defineConfig, devices } from "@playwright/test";
import { APP, AUTH, BIT, CAL, DRIVE, EIA, FAKE_PORT_OFFSET, FIRESTORE, GMAIL, ORS, SPOTIFY } from "./tests/e2e/env";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: APP,
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // All five fakes in one process.
      command: "npx tsx fakes/run-all.ts",
      url: `${SPOTIFY}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { FAKE_PORT_OFFSET: String(FAKE_PORT_OFFSET), FAKE_DATA_DIR: ".fake-data-test" },
    },
    {
      command: `npx next dev -p ${new URL(APP).port}`,
      url: `${APP}/signin`,
      reuseExistingServer: false,
      timeout: 120_000,
      // Process env beats .env.development, so these win over the dev values there.
      env: {
        NEXT_DIST_DIR: ".next-test",
        NEXT_PUBLIC_USE_EMULATORS: "1",
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-band-tracker",
        NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT: FIRESTORE.split(":")[1],
        NEXT_PUBLIC_AUTH_EMULATOR_PORT: AUTH.split(":")[1],
        GCLOUD_PROJECT: "demo-band-tracker",
        FIRESTORE_EMULATOR_HOST: FIRESTORE,
        FIREBASE_AUTH_EMULATOR_HOST: AUTH,
        GMAIL_BASE_URL: GMAIL, DRIVE_BASE_URL: DRIVE, CALENDAR_BASE_URL: CAL, BANDSINTOWN_BASE_URL: BIT, SPOTIFY_BASE_URL: SPOTIFY,
        ORS_BASE_URL: ORS, EIA_BASE_URL: EIA,
        APP_URL: APP,
        // Real Google set up in .env.development.local must not reach e2e: an empty value beats the file.
        GOOGLE_OAUTH_CLIENT_ID: "",
      },
    },
  ],
});
