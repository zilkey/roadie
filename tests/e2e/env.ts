import type { Page } from "@playwright/test";
/**
 * Where the e2e run's own servers live. Tests never share ports, data or a Next build with `npm run dev:all`
 * (emulators 8280/9319, Next 3100, fakes 3201-3207), so a test run can't touch dev data. Keep in sync with
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
export const ORS = "http://127.0.0.1:3216";
export const EIA = "http://127.0.0.1:3217";
/** The seeded artist's URL name (scripts/seed.ts): every band page is under /artists/{slug}. */
export const ARTIST_SLUG = "ingrid-avison-band";
/** A band page of the seeded artist: A("/shows/1") -> "/artists/ingrid-avison-band/shows/1". */
export const A = (path: string) => `/artists/${ARTIST_SLUG}${path}`;

/**
 * Opens a main section by its nav key ("shows", "money", ...): the top-bar tab when it fits, else its row in More.
 * At the 1280px test viewport the admin bar fits Shows, Booking, Songs and Money. The helper falls back to More for sections that are hidden or overflow.
 */
export async function openTab(page: Page, key: string) {
  const tab = page.getByTestId(`tab-${key}`);
  if (await tab.isVisible()) { await tab.click(); return; }
  await page.getByTestId("more-toggle").click();
  await page.getByTestId(`more-${key}`).click();
}
