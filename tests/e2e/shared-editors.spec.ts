import { test, expect, type Page } from "@playwright/test";
import { A, FIRESTORE } from "./env";

// Approved editors for shared records (tenancy phase 1). The seed approves everyone in Nora Quill Band and makes Rudy a platform
// admin; Fern Valley Trio's Olga is not approved: on a shared venue she sees "Ask to edit" instead of the pencil, her own notes stay
// editable, and her request shows up on Rudy's Admin › Platform page.

const DOCS = `http://${FIRESTORE}/v1/projects/demo-band-tracker/databases/(default)/documents`;
const OWNER = { authorization: "Bearer owner" };
const OTHER = (p: string) => `/artists/fern-valley-trio${p}`;

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

/** The seeded venue's id, read straight from the emulator. */
async function venueId(page: Page, name: string) {
  const res = await page.request.get(`${DOCS}/venues?pageSize=300`, { headers: OWNER });
  const docs = ((await res.json()) as { documents: { name: string; fields: { name?: { stringValue?: string } } }[] }).documents;
  const d = docs.find((x) => x.fields.name?.stringValue === name);
  if (!d) throw new Error(`no seeded venue ${name}`);
  return d.name.split("/").pop()!;
}

test("someone not approved sees Ask to edit on a shared venue, keeps their notes, and a platform admin sees the request", async ({ page, browser }) => {
  const id = await venueId(page, "Deep End");
  await signInAs(page, "olga");
  await page.goto(OTHER(`/booking/venues/${id}`));
  await expect(page.getByTestId("venue-page")).toBeVisible();
  const room = page.getByTestId("room-card");
  await expect(room.getByTestId("room-edit")).toHaveCount(0);
  await expect(page.getByTestId("venue-menu-merge")).toHaveCount(0);
  // her band's own notes on the room are still hers to change
  await expect(page.getByTestId("notes-private")).toContainText("Fern Valley loads in the side door.");
  await room.getByTestId("ask-to-edit").click();
  await expect(room.getByTestId("ask-to-edit-asked")).toBeVisible();

  const other = await browser.newContext();
  const rudy = await other.newPage();
  await signInAs(rudy, "rudy");
  await rudy.goto(A("/admin/platform"));
  await expect(rudy.getByTestId("platform-requests")).toContainText("Olga Park");
  await expect(rudy.getByTestId("platform-editors")).toContainText("Rudy");
  // Rudy can still change the room
  await rudy.goto(A(`/booking/venues/${id}`));
  await expect(rudy.getByTestId("room-card").getByTestId("room-edit")).toBeVisible();
  await other.close();
});
