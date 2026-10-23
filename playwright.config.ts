// End-to-end tests. `npm run e2e` starts the Firebase emulators, seeds them, then runs this.
// The web server is `next dev` on 3100 pointed at the emulators (see .env.development).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // All five fakes in one process (3201-3205); state in .fake-data.
      command: "npx tsx fakes/run-all.ts",
      url: "http://127.0.0.1:3205/health",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
    command: "npx next dev -p 3100",
    url: "http://127.0.0.1:3100/signin",
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_USE_EMULATORS: "1",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-band-tracker",
      GCLOUD_PROJECT: "demo-band-tracker",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8280",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9319",
    },
    },
  ],
});
