// End-to-end tests. `npm run e2e` (scripts/e2e.ts) splits the specs into shards; for each it starts emulators, seeds
// them, then runs this with E2E_SHARD and TEST_PORT_OFFSET set. Everything here is that shard's own: Next building
// into .next-test-<n>, fakes with state in .fake-data-test-<n>, all on the shard's ports (tests/e2e/env.ts).
// Inside a shard the specs still run one at a time, in file order, on one seeded database.
// A running `npm run dev:all` is never reused or touched.
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { APP, AUTH, BIT, CAL, DRIVE, EIA, FAKE_PORT_OFFSET, FIRESTORE, GMAIL, META, ORS, SPOTIFY } from "./tests/e2e/env";

/** "-2" for shard 2; empty when Playwright is run by hand without scripts/e2e.ts. */
const SHARD = process.env.E2E_SHARD ? `-${process.env.E2E_SHARD}` : "";

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: `test-results${SHARD}`,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  // Shards run side by side with everything else on the machine, and a loaded machine makes the odd test miss a
  // save or a click. One retry there; a test that needed it is listed as flaky at the end. By hand: no retry.
  retries: SHARD ? 1 : 0,
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
      env: { FAKE_PORT_OFFSET: String(FAKE_PORT_OFFSET), FAKE_DATA_DIR: `.fake-data-test${SHARD}` },
    },
    {
      command: `npx next dev -p ${new URL(APP).port}`,
      url: `${APP}/signin`,
      reuseExistingServer: false,
      timeout: 120_000,
      // Process env beats .env.development, so these win over the dev values there.
      env: {
        NEXT_DIST_DIR: `.next-test${SHARD}`,
        NEXT_PUBLIC_USE_EMULATORS: "1",
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-band-tracker",
        NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT: FIRESTORE.split(":")[1],
        NEXT_PUBLIC_AUTH_EMULATOR_PORT: AUTH.split(":")[1],
        GCLOUD_PROJECT: "demo-band-tracker",
        FIRESTORE_EMULATOR_HOST: FIRESTORE,
        FIREBASE_AUTH_EMULATOR_HOST: AUTH,
        GMAIL_BASE_URL: GMAIL, DRIVE_BASE_URL: DRIVE, CALENDAR_BASE_URL: CAL, BANDSINTOWN_BASE_URL: BIT, SPOTIFY_BASE_URL: SPOTIFY,
        ORS_BASE_URL: ORS, EIA_BASE_URL: EIA,
        // Instagram & Facebook against fakes/fake-meta: a made-up app, its dialog and Graph.
        META_APP_ID: "fake-meta-app", META_CONFIG_ID: "fake-meta-config", META_APP_SECRET: "fake-meta-secret", META_TOKEN_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        META_GRAPH_URL: META, META_IG_URL: `${META}/ig`, META_DIALOG_URL: `${META}/dialog/oauth`,
        APP_URL: APP,
        // Venue calendars (#60) are read from made-up files, never the network: see fixtureFetch in src/server/events/fetch.ts.
        VENUE_EVENTS_FIXTURES: path.join(process.cwd(), "fixtures", "calendars"),
        // Booking's Venue calendars tab pages by 2 here, so the three fixture shows span two pages.
        NEXT_PUBLIC_VENUE_CALENDARS_PAGE: "2",
        // The Acts tab (#77) pages by 2 here too, so "All acts" needs "Load more" for the fixture's acts.
        NEXT_PUBLIC_ACTS_PAGE: "2",
        // Real Google set up in .env.development.local must not reach e2e: an empty value beats the file.
        GOOGLE_OAUTH_CLIENT_ID: "",
      },
    },
  ],
});
