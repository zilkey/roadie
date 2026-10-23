/**
 * Where the e2e run's own servers live. Tests never share ports, data or a Next build with `npm run dev:all`
 * (emulators 8280/9319, Next 3100, fakes 3201-3205), so a test run can't touch dev data. Keep in sync with
 * firebase.test.json and the `test` / `e2e` scripts in package.json.
 */
export const APP = "http://127.0.0.1:3110";
export const FIRESTORE = "127.0.0.1:8290";
export const AUTH = "127.0.0.1:9329";
/** Fakes run at their dev port + 10, with state in .fake-data-test. */
export const FAKE_PORT_OFFSET = 10;
export const GMAIL = "http://127.0.0.1:3211";
export const DRIVE = "http://127.0.0.1:3212";
export const CAL = "http://127.0.0.1:3213";
export const BIT = "http://127.0.0.1:3214";
export const SPOTIFY = "http://127.0.0.1:3215";
