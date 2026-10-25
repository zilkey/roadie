import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
}
const OTHER = (path: string) => `/artists/fern-valley-trio${path}`;
const STAMP = Date.now();

/** Booking -> search -> the venue's full record, as an admin of `base`. */
async function openVenue(page: Page, base: (p: string) => string, search: string, exact?: string) {
  await page.goto(base("/booking"));
  await page.getByTestId("booking-search").fill(search);
  const row = page.getByTestId(/^row-venue-/).filter({ hasText: exact ?? search }).first();
  await row.getByTestId(/^venue-full-/).click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
}

test("a member opens the venue from a show, sees the address but no notes, and fixes the capacity (autosaved, with a shared-for-everyone warning); another band's admin sees the fix but only their own notes", async ({ page, browser }) => {
  await signInAs(page, "david"); // a member of Ingrid Avison Band
  await page.goto(A("/shows"));
  await page.getByTestId("shows-row").filter({ hasText: "Hi-Dive" }).filter({ hasText: "Nov 14" }).first().locator("td.date a").click();
  await page.getByTestId("where-venue").click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
  const venueUrl = page.url();
  await expect(page.getByTestId("page-title")).toHaveText("Hi-Dive");
  await expect(page.getByTestId("room-address")).toContainText("7 S Broadway");
  // the band's private notes are not there for a member: no notes form, no contacts, no merge, no archive
  await expect(page.getByTestId("notes-loadInNotes")).toHaveCount(0);
  await expect(page.getByTestId("notes-private")).toHaveCount(0);
  await expect(page.getByTestId("contacts-panel")).toHaveCount(0);
  await expect(page.getByTestId("venue-actions")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Alley door on Broadway");

  // fixing a fact: Edit opens the shared card in place with a warning that every band sees it; it autosaves, Done closes it
  const capacity = String(300 + (STAMP % 100));
  await expect(page.getByTestId("room-capacity")).toHaveText("250");
  await page.getByTestId("room-edit").click();
  await expect(page.getByTestId("room-card")).toContainText("Every band on Roadie sees these details.");
  await expect(page.getByTestId("room-edit")).toHaveCount(0);
  await page.getByTestId("room-capacity").fill(capacity);
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.getByTestId("room-save").click(); // Done
  await expect(page.getByTestId("room-form")).toHaveCount(0);
  await expect(page.getByTestId("room-capacity")).toHaveText(capacity);
  await page.reload();
  await expect(page.getByTestId("room-capacity")).toHaveText(capacity);

  // an admin of another band: the same room (with the fix), but her own notes, never Ingrid's
  const olga = await browser.newContext();
  const op = await olga.newPage();
  await signInAs(op, "olga");
  await openVenue(op, OTHER, "hi-dive", "Hi-Dive");
  await expect(op.getByTestId("room-capacity")).toHaveText(capacity);
  await expect(op.getByTestId("notes-private")).toContainText("Fern Valley loads in the side door.");
  await op.getByTestId("notes-edit").click();
  await expect(op.getByTestId("notes-loadInNotes")).toHaveValue("Fern Valley loads in the side door.");
  await expect(op.getByTestId("notes-notes")).toHaveValue(/Ask for Rae/);
  await expect(op.locator("body")).not.toContainText("Alley door on Broadway");
  await expect(op.locator("body")).not.toContainText("Ask for Sam");
  // she can open the same room by the first band's venue id: she still only reads her own notes there
  expect(op.url().split("/").pop()).toBe(venueUrl.split("/").pop());

  // Jeff (admin of the first band) sees his notes, not hers
  const jeff = await browser.newContext();
  const jp = await jeff.newPage();
  await signInAs(jp, "jeff");
  await jp.goto(venueUrl);
  await expect(jp.getByTestId("room-capacity")).toHaveText(capacity);
  await jp.getByTestId("notes-edit").click();
  await expect(jp.getByTestId("notes-loadInNotes")).toHaveValue("Alley door on Broadway; 20 minutes to load in.");
  await expect(jp.locator("body")).not.toContainText("Fern Valley");

  await olga.close(); await jeff.close();
});

test("merge a duplicate venue into the room to keep: every band's notes move, the old page redirects", async ({ page, browser }) => {
  page.on("dialog", (d) => d.accept());
  await signInAs(page, "jeff");
  await openVenue(page, A, "the hi-dive", "The Hi-Dive");
  const dupUrl = page.url();
  await page.getByTestId("venue-actions").click();
  await page.getByTestId("venue-menu-merge").click();
  await page.getByTestId("merge-search").fill("hi-dive");
  await expect(page.getByTestId("merge-results")).not.toContainText("The Hi-Dive"); // not into itself
  await page.getByTestId(/^merge-pick-/).first().click();
  await expect(page.getByTestId("merge-summary")).toContainText("Every band's shows, pitches and notes at The Hi-Dive will move to Hi-Dive");
  await page.getByTestId("merge-confirm").click();
  await expect(page.getByTestId("page-title")).toHaveText("Hi-Dive");
  const keepUrl = page.url();
  expect(keepUrl).not.toBe(dupUrl);
  // the band's notes were joined onto the survivor's; the duplicate's website filled the survivor's empty one
  await page.getByTestId("notes-edit").click();
  await expect(page.getByTestId("notes-notes")).toHaveValue(/Possible duplicate of Hi-Dive\./);
  await expect(page.getByTestId("notes-notes")).toHaveValue(/Ask for Sam/);
  await expect(page.getByTestId("room-website")).toContainText("hi-dive.example");
  // the merged venue's old address redirects to the survivor
  await page.goto(dupUrl);
  await expect(page).toHaveURL(keepUrl);
  await page.goto(A("/booking"));
  await page.getByTestId("booking-search").fill("the hi-dive");
  await expect(page.getByTestId(/^row-venue-/)).toHaveCount(0);

  // the other band's notes moved too (and stayed hers)
  const olga = await browser.newContext();
  const op = await olga.newPage();
  await signInAs(op, "olga");
  await op.goto(keepUrl.replace("/artists/ingrid-avison-band", "/artists/fern-valley-trio"));
  await op.getByTestId("notes-edit").click();
  await expect(op.getByTestId("notes-notes")).toHaveValue(/Fern Valley saw this room as The Hi-Dive\./);
  await expect(op.locator("body")).not.toContainText("Ask for Sam");
  await olga.close();
});

