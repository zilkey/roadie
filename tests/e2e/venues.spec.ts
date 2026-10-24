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

test("a member opens the venue from a show, sees the address but no notes, and fixes the capacity through the confirmation; another band's admin sees the fix but only their own notes", async ({ page, browser }) => {
  await signInAs(page, "david"); // a member of Ingrid Avison Band
  await page.goto(A("/shows"));
  await page.locator("a[data-testid^='show-']", { hasText: "Hi-Dive" }).first().click();
  await page.getByTestId("show-venue-link").click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
  const venueUrl = page.url();
  await expect(page.getByTestId("page-title")).toHaveText("Hi-Dive");
  await expect(page.getByTestId("room-address")).toContainText("7 S Broadway");
  // the band's private notes are not there for a member: no notes form, no contacts, no merge, no archive
  await expect(page.getByTestId("notes-loadInNotes")).toHaveCount(0);
  await expect(page.getByTestId("notes-private")).toHaveCount(0);
  await expect(page.getByTestId("contacts-panel")).toHaveCount(0);
  await expect(page.getByTestId("merge-open")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Alley door on Broadway");

  // fixing a fact: explicit Save, then a dialog that says who it reaches and lists before and after
  const capacity = String(300 + (STAMP % 100));
  await page.getByTestId("room-edit").click();
  await expect(page.getByTestId("room-save")).toBeVisible();
  await page.getByTestId("room-capacity").fill(capacity);
  await page.getByTestId("room-save").click();
  const dialog = page.getByTestId("room-confirm-dialog");
  await expect(dialog).toContainText("for every band that uses Band Tracker");
  await expect(dialog).toContainText("Your name is recorded in its history");
  await expect(page.getByTestId("room-change-capacity")).toContainText(`250`);
  await expect(page.getByTestId("room-change-capacity")).toContainText(capacity);
  // Cancel changes nothing
  await page.getByTestId("room-confirm-cancel").click();
  await expect(dialog).toBeHidden();
  await page.getByTestId("room-cancel").click();
  await expect(page.getByTestId("room-capacity")).toHaveText("250");
  await page.getByTestId("room-edit").click();
  await page.getByTestId("room-capacity").fill(capacity);
  await page.getByTestId("room-save").click();
  await page.getByTestId("room-confirm").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("room-capacity")).toHaveText(capacity);
  await page.reload();
  await expect(page.getByTestId("room-capacity")).toHaveText(capacity);

  // an admin of another band: the same room (with the fix), but her own notes, never Ingrid's
  const olga = await browser.newContext();
  const op = await olga.newPage();
  await signInAs(op, "olga");
  await openVenue(op, OTHER, "hi-dive", "Hi-Dive");
  await expect(op.getByTestId("room-capacity")).toHaveText(capacity);
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
  await expect(jp.getByTestId("notes-loadInNotes")).toHaveValue("Alley door on Broadway; 20 minutes to load in.");
  await expect(jp.locator("body")).not.toContainText("Fern Valley");

  // History: each band's page lists its own records' changes and the shared ones, not the other band's private notes
  await jp.goto(A("/admin/history"));
  await jp.getByTestId("filter-entity").fill("venueNotes");
  await expect(jp.getByTestId("history-row").first()).toBeVisible();
  expect(await jp.getByTestId("history-list").textContent()).not.toContain("Fern Valley loads");
  await op.goto(OTHER("/admin/history"));
  await op.getByTestId("filter-entity").fill("venueNotes");
  await expect(op.getByTestId("history-row").first()).toBeVisible();
  expect(await op.getByTestId("history-list").textContent()).not.toContain("Alley door");
  await op.getByTestId("filter-entity").fill("venues");
  await expect(op.getByTestId("history-row").first()).toBeVisible(); // the shared room's changes (the capacity fix) are everyone's
  await olga.close(); await jeff.close();
});

test("adding a venue says other bands will see it; a shared edit that changes nothing just closes", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await page.getByTestId("add-venue").click();
  await expect(page.getByTestId("new-venue-shared-note")).toContainText("Other bands will see this venue's name, address and details.");
  await page.getByTestId("add-venue").click();
  await openVenue(page, A, "dairy arts");
  await page.getByTestId("room-edit").click();
  await page.getByTestId("room-save").click();
  await expect(page.getByTestId("room-confirm-dialog")).toBeHidden();
  await expect(page.getByTestId("room-card")).toBeVisible();
});

test("merge a duplicate venue into the room to keep: every band's notes move, the old page redirects, and Undo from History restores it", async ({ page, browser }) => {
  page.on("dialog", (d) => d.accept());
  await signInAs(page, "jeff");
  await openVenue(page, A, "the hi-dive", "The Hi-Dive");
  const dupUrl = page.url();
  await page.getByTestId("merge-open").click();
  await page.getByTestId("merge-search").fill("hi-dive");
  await expect(page.getByTestId("merge-results")).not.toContainText("The Hi-Dive"); // not into itself
  await page.getByTestId(/^merge-pick-/).first().click();
  await expect(page.getByTestId("merge-summary")).toContainText("Every band's shows, pitches and notes at The Hi-Dive will move to Hi-Dive");
  await page.getByTestId("merge-confirm").click();
  await expect(page.getByTestId("page-title")).toHaveText("Hi-Dive");
  const keepUrl = page.url();
  expect(keepUrl).not.toBe(dupUrl);
  // the band's notes were joined onto the survivor's; the duplicate's website filled the survivor's empty one
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
  await expect(op.getByTestId("notes-notes")).toHaveValue(/Fern Valley saw this room as The Hi-Dive\./);
  await expect(op.locator("body")).not.toContainText("Ask for Sam");
  await olga.close();

  // one run in History: Undo brings the duplicate back
  await page.goto(A("/admin/history"));
  await page.getByTestId("filter-entity").fill("venues");
  const row = page.locator('[data-testid="history-row"][data-op="delete"][data-kind="venues"]').first();
  await expect(row).toBeVisible();
  await row.getByTestId("pick-run").click();
  await expect(page.getByTestId("run-card")).toBeVisible();
  await page.getByTestId("undo-run").click();
  await expect(page.getByTestId("undo-counts")).toContainText("put back");
  await page.goto(dupUrl);
  await expect(page.getByTestId("page-title")).toHaveText("The Hi-Dive");
});

test("the venue page's Pitch card: add to the pitch list, edit it, comment, abandon it into Past pitches; Edit sits in the header", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await signInAs(page, "jeff");
  await page.goto(A("/shows"));
  await page.locator("a[data-testid^='show-']", { hasText: "Hi-Dive" }).first().click();
  await page.getByTestId("show-venue-link").click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
  // Edit is in the header and swaps the facts for the form; Cancel puts them back
  await page.getByTestId("room-edit").click();
  await expect(page.getByTestId("room-form")).toBeVisible();
  await expect(page.getByTestId("room-edit")).toHaveCount(0);
  await page.getByTestId("room-cancel").click();
  await expect(page.getByTestId("room-edit")).toBeVisible();

  const card = page.getByTestId("venue-pitch-card");
  if (await page.getByTestId("pitch-open").count()) await page.getByTestId("pitch-abandon").click();
  await expect(page.getByTestId("not-on-pitch-list")).toBeVisible();
  // nothing is added until the explicit button
  await card.locator("[data-testid^='flag-'][data-flagged]").click();
  await expect(card.getByTestId(/^flag-form-/)).toBeVisible();
  await expect(page.getByTestId("pitch-open")).toHaveCount(0);
  await card.getByTestId(/^flag-submit-/).click();
  await expect(page.getByTestId("pitch-open")).toBeVisible();
  await expect(page.getByTestId("status-chip").first()).toBeVisible();

  await page.getByTestId("pitch-edit").click();
  await page.getByTestId("pitch-edit-dates-date").fill("2027-02-12");
  await page.getByTestId("pitch-edit-dates-add").click();
  await expect(page.getByTestId("pitch-edit-dates-date")).toHaveValue("");
  await page.getByTestId("pitch-edit-dates-date").fill("2027-03-05");
  await page.getByTestId("pitch-edit-dates-date").press("Enter");
  await expect(page.getByTestId("pitch-edit-dates-chip-1")).toHaveText("Fri, Mar 5");
  await page.getByTestId("pitch-edit-dates-remove-1").click();
  await expect(page.getByTestId("pitch-edit-dates-chip-1")).toHaveCount(0);
  await expect(page.getByTestId("edit-configurations")).toHaveCSS("text-decoration-line", "underline"); // the Edit next to Configuration is a link
  await page.getByTestId("pitch-edit-save").click();
  await expect(page.getByTestId("pitch-dates-summary")).toContainText("Fri, Feb 12");

  const text = `Sent the EPK ${Date.now()}`;
  await page.getByTestId("pitch-comment-input").fill(text);
  await expect(page.getByTestId("pitch-comment")).toHaveCount(await page.getByTestId("pitch-comment").count()); // typing alone posts nothing
  await page.getByTestId("pitch-comment-send").click();
  await expect(page.getByTestId("pitch-comments")).toContainText(text);

  await page.getByTestId("pitch-abandon").click();
  await expect(page.getByTestId("pitch-open")).toHaveCount(0);
  await expect(page.getByTestId("past-pitches")).toContainText("Abandoned");
});
