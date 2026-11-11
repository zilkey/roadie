import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
const STAMP = Date.now();

/** Booking -> search -> the venue's full record, as an admin of `base`. */
async function openVenue(page: Page, base: (p: string) => string, search: string, exact?: string) {
  await page.goto(base("/booking"));
  await page.getByTestId("booking-seg-venues").click();
  await page.getByTestId("booking-search").fill(search);
  const row = page.getByTestId(/^row-venue-/).filter({ hasText: exact ?? search }).first();
  // a venue with an active pitch opens the pitch from its name; "Venue page" on the pitch page is the place
  await row.getByTestId(/^venue-full-/).click();
  await expect(page.getByTestId(/^(venue|pitch)-page$/)).toBeVisible();
  if (await page.getByTestId("pitch-page").count()) await page.getByTestId("target-link").click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
}

test("a member opens the venue from a show, sees the address but no notes, and fixes the capacity (autosaved, with a shared-for-everyone warning)", async ({ page }) => {
  await signInAs(page, "hugo"); // a member of Nora Quill Band
  await page.goto(A("/shows"));
  await page.getByTestId("shows-row").filter({ hasText: "Deep End" }).filter({ hasText: "Nov 14" }).first().locator("td.date a").click();
  await page.getByTestId("where-venue").click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
  await expect(page.getByTestId("page-title")).toHaveText("Deep End");
  await expect(page.getByTestId("room-address")).toContainText("7 S Broadway");
  // the band's private notes are not there for a member: no notes form, no contacts, no merge, no archive
  await expect(page.getByTestId("venue-loadin")).toHaveCount(0);
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
});

test("merge a duplicate venue into the room to keep: the old page redirects", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await signInAs(page, "rudy");
  await openVenue(page, A, "the deep end", "The Deep End");
  const dupUrl = page.url();
  await page.getByTestId("venue-actions").click();
  await page.getByTestId("venue-menu-merge").click();
  await page.getByTestId("merge-search").fill("deep end");
  await expect(page.getByTestId("merge-results")).not.toContainText("The Deep End"); // not into itself
  await page.getByTestId(/^merge-pick-/).first().click();
  await expect(page.getByTestId("merge-summary")).toContainText("Every band's shows, pitches and notes at The Deep End will move to Deep End");
  await page.getByTestId("merge-confirm").click();
  await expect(page.getByTestId("page-title")).toHaveText("Deep End");
  const keepUrl = page.url();
  expect(keepUrl).not.toBe(dupUrl);
  // the merged venue's old address redirects to the survivor
  await page.goto(dupUrl);
  await expect(page).toHaveURL(keepUrl);
  await page.goto(A("/booking"));
  await page.getByTestId("booking-search").fill("the deep-end");
  await expect(page.getByTestId(/^row-venue-/)).toHaveCount(0);
});

test("venue contacts: Booking and Day-of chips toggle on tap, no Edit on the card", async ({ page }) => {
  await signInAs(page, "rudy");
  await openVenue(page, A, "heron theatre", "Heron Theatre");
  await expect(page.getByTestId("contacts-edit")).toHaveCount(0);
  const desmond = page.getByTestId("contacts-panel").getByTestId("contact-Desmond Webb");
  const booking = desmond.getByTestId("contact-role-booking"), dayOf = desmond.getByTestId("contact-role-dayOf");
  await expect(booking).toHaveAttribute("aria-pressed", "false");
  await expect(dayOf).toHaveAttribute("aria-pressed", "false");
  await booking.click();
  await expect(booking).toHaveAttribute("aria-pressed", "true");
  await dayOf.click();
  await expect(dayOf).toHaveAttribute("aria-pressed", "true");
  await dayOf.click();
  await expect(dayOf).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(booking).toHaveAttribute("aria-pressed", "true");
  await expect(dayOf).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("contacts-foot")).toHaveText("Tap a role to turn it on or off. × takes the person off this venue; they stay in Contacts.");
});

test("venue contacts: the plus adds someone already in Contacts or a new person (kept as a draft until Add contact); × takes them off the venue only", async ({ page }) => {
  await signInAs(page, "rudy");
  await openVenue(page, A, "marisol", "Marisol' Other Side");
  const panel = page.getByTestId("contacts-panel");
  const dialog = page.getByTestId("contact-add-dialog");
  await expect(panel).toContainText("No one yet.");

  // Already in Contacts: find Anika by where she works, pick her, Add to venue (Booking is ticked by default)
  await page.getByTestId("contact-add").click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("To Marisol' Other Side");
  await expect(page.getByTestId("contact-add-exist")).toBeChecked();
  await page.getByTestId("contact-find").fill("rmffest");
  await page.getByTestId(/^contact-hit-/).filter({ hasText: "Anika Shah" }).click();
  await expect(page.getByTestId("contact-add-booking")).toBeChecked();
  await expect(page.getByTestId("contact-add-dayOf")).not.toBeChecked();
  await expect(page.getByTestId("contact-add-submit")).toHaveText("Add to venue");
  await page.getByTestId("contact-add-submit").click();
  await expect(dialog).toBeHidden();
  const anika = panel.getByTestId("contact-Anika Shah");
  await expect(anika.getByTestId("contact-role-booking")).toHaveAttribute("aria-pressed", "true");

  // New person: half-finished, Cancel closes and the draft stays; the next visit opens the dialog on it
  const name = `Day Of ${STAMP}`;
  await page.getByTestId("contact-add").click();
  await page.getByTestId("contact-add-new").check();
  await page.getByTestId("contact-form-name").fill(name);
  await expect(page.getByTestId("draft-status")).toHaveText("Draft saved");
  await page.getByTestId("contact-add-cancel").click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("contact-add-new")).toBeChecked();
  await expect(page.getByTestId("contact-form-name")).toHaveValue(name);
  await page.getByTestId("contact-form-emails").fill(`dayof${STAMP}@marisol.example`);
  await page.getByTestId("contact-add-booking").uncheck();
  await page.getByTestId("contact-add-dayOf").check();
  await expect(page.getByTestId("contact-add-submit")).toHaveText("Add contact");
  await page.getByTestId("contact-add-submit").click();
  await expect(dialog).toBeHidden();
  const added = panel.getByTestId(`contact-${name}`);
  await expect(added.getByTestId("contact-role-dayOf")).toHaveAttribute("aria-pressed", "true");
  await expect(added.getByTestId("contact-role-booking")).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(dialog).toBeHidden(); // the draft went with the create
  await expect(added).toBeVisible();

  // × unlinks: the rows go, both people stay in Contacts
  await anika.getByTestId("contact-remove-Anika Shah").click();
  await added.getByTestId(`contact-remove-${name}`).click();
  await expect(panel).toContainText("No one yet.");
  await page.goto(A("/contacts"));
  await page.getByTestId("contacts-search").fill(name);
  await expect(page.getByTestId(/^row-contact-/).filter({ hasText: name })).toHaveCount(1);
});

test("a venue page opens with a slim pitch card: the active pitch with View pitch, or Not on the Pitch List with what came before", async ({ page }) => {
  await signInAs(page, "rudy");
  await openVenue(page, A, "Pine Hollow Lounge"); // Heron Theatre gets booked by the shows spec; this pitch stays open
  const card = page.getByTestId("venue-pitch-card");
  await expect(card).toContainText("On the Pitch List");
  await expect(card.getByTestId("status-chip")).toBeVisible();
  await expect(card).toContainText("Trio");
  await expect(card).toContainText("Rosa"); // the next step: Follow up with Rosa
  await expect(page.getByTestId("pitch-abandon")).toHaveCount(0); // the work happens on the pitch page
  await card.getByTestId("view-pitch").click();
  await expect(page.getByTestId("pitch-page")).toBeVisible();
  await expect(page.getByTestId("pitch-abandon")).toBeVisible();

  await openVenue(page, A, "Deep End", "Deep End");
  const none = page.getByTestId("venue-pitch-card");
  await expect(none.getByTestId("not-on-pitch-list")).toContainText("Not on the Pitch List");
  await expect(none.getByTestId("past-pitches")).toContainText("Pitched before");
  await expect(none.getByTestId("past-pitches")).toContainText("Became a show");
  await expect(none.getByTestId(/^flag-/).first()).toContainText("Add to Pitch List");
});
