import type { Page } from "@playwright/test";
/**
 * Where the e2e run's own servers live. Tests never share ports, data or a Next build with `npm run dev:all`
 * (emulators 8280/9319, Next 3100, fakes 3201-3207), so a test run can't touch dev data. Keep in sync with
 * firebase.test.json and the `test` / `e2e` scripts in package.json.
 * Every port is its dev port + TEST_PORT_OFFSET (10 by default). A worktree claims its own offset with
 * `npm run worktree:ports claim`, which also writes the matching firebase.worktree.json.
 */
const OFFSET = Number(process.env.TEST_PORT_OFFSET ?? 10);
const at = (devPort: number) => `127.0.0.1:${devPort + OFFSET}`;
export const APP = `http://${at(3100)}`;
export const FIRESTORE = at(8280);
export const AUTH = at(9319);
/** Fakes run at their dev port + the offset, with state in .fake-data-test. */
export const FAKE_PORT_OFFSET = OFFSET;
export const GMAIL = `http://${at(3201)}`;
export const DRIVE = `http://${at(3202)}`;
export const CAL = `http://${at(3203)}`;
export const BIT = `http://${at(3204)}`;
export const SPOTIFY = `http://${at(3205)}`;
export const ORS = `http://${at(3206)}`;
export const EIA = `http://${at(3207)}`;
/** The seeded artist's URL name (scripts/seed.ts): every band page is under /artists/{slug}. */
export const ARTIST_SLUG = "ingrid-avison-band";
/** A band page of the seeded artist: A("/shows/1") -> "/artists/ingrid-avison-band/shows/1". */
export const A = (path: string) => `/artists/${ARTIST_SLUG}${path}`;

/**
 * Opens a main section by its nav key ("shows", "money", ...): the top-bar tab when it fits, else its row in More.
 * At the 1280px test viewport the admin bar fits Shows, Booking, Songs and Money. The helper falls back to More for sections that are hidden or overflow.
 */
export async function openTab(page: Page, key: string) {
  // The bar settles a beat after sign-in (Releases joins it once the releases load and can push Money into More), so More is opened first
  // and the click goes to wherever the section is by then: its tab in the bar (which closes More) or its row in the menu.
  const toggle = page.getByTestId("more-toggle");
  await toggle.waitFor();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.getByTestId(`tab-${key}`).or(page.getByTestId(`more-${key}`)).first().click();
}
