import type { Page } from "@playwright/test";
/**
 * Where the e2e run's own servers live. Tests never share ports, data or a Next build with `npm run dev:all`
 * (emulators 8280/9319, Next 3100, fakes 3201-3208), so a test run can't touch dev data. Keep in sync with
 * firebase.test.json and the `test:emulator` script in package.json.
 * `npm run e2e` (scripts/e2e.ts) runs the specs in shards; shard n uses these ports + 1000 x n, with its own emulators, fakes and Next build.
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
export const META = `http://${at(3208)}`;
/** The seeded artist's URL name (scripts/seed.ts): every band page is under /artists/{slug}. */
export const ARTIST_SLUG = "nora-quill-band";
/** A band page of the seeded artist: A("/shows/1") -> "/artists/nora-quill-band/shows/1". */
export const A = (path: string) => `/artists/${ARTIST_SLUG}${path}`;

/** Artist data is nested under artists/{id}/… in e2e (tenancy phase 10; scripts/e2e.ts) unless ROADIE_NESTED_PATHS=0. */
export const NESTED = process.env.ROADIE_NESTED_PATHS !== "0";
type Getter = { get(url: string, opts: { headers: Record<string, string> }): Promise<{ json(): Promise<unknown> }> };
/**
 * For specs that read or write the emulator over REST: a function from a seeded band record's logical path ("shows/x",
 * "showDeals/x") to its REST path, under `artists/{id}/` when nested. `slug` defaults to the seeded band.
 */
export async function bandRecords(request: Getter, slug = ARTIST_SLUG): Promise<(path: string) => string> {
  const res = await request.get(`http://${FIRESTORE}/v1/projects/demo-band-tracker/databases/(default)/documents/artists?pageSize=300`, { headers: { authorization: "Bearer owner" } });
  const docs = ((await res.json()) as { documents: { name: string; fields: { slug?: { stringValue?: string } } }[] }).documents;
  const id = docs.find((d) => d.fields.slug?.stringValue === slug)!.name.split("/").pop()!;
  return (path) => (NESTED ? `artists/${id}/${path}` : path);
}

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
