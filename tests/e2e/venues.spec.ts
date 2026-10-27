import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
const OTHER = (path: string) => `/artists/fern-valley-trio${path}`;
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

  // an admin of another band: the same room (with the fix), but her own notes, never Ingrid's
  const olga = await browser.newContext();
  const op = await olga.newPage();
  await signInAs(op, "olga");
  await openVenue(op, OTHER, "hi-dive", "Hi-Dive");
  await expect(op.getByTestId("room-capacity")).toHaveText(capacity);
  await expect(op.getByTestId("notes-private")).toContainText("Fern Valley loads in the side door.");
  await expect(op.getByTestId("notes-edit")).toHaveCount(0); // notes edit in place, no flip
  await expect(op.getByTestId("venue-loadin")).toContainText("Fern Valley loads in the side door.");
  await expect(op.getByTestId("venue-notes")).toContainText(/Ask for Rae/);
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
  await expect(jp.getByTestId("venue-loadin")).toContainText("Alley door on Broadway; 20 minutes to load in.");
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
  await expect(page.getByTestId("venue-notes")).toContainText(/Possible duplicate of Hi-Dive\./);
  await expect(page.getByTestId("venue-notes")).toContainText(/Ask for Sam/);
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
  await expect(op.getByTestId("venue-notes")).toContainText(/Fern Valley saw this room as The Hi-Dive\./);
  await expect(op.locator("body")).not.toContainText("Ask for Sam");
  await olga.close();
});


test("venue contacts: Booking and Day-of chips toggle on tap, no Edit on the card", async ({ page }) => {
  await signInAs(page, "jeff");
  await openVenue(page, A, "fox theatre", "Fox Theatre");
  await expect(page.getByTestId("contacts-edit")).toHaveCount(0);
  const marcus = page.getByTestId("contacts-panel").getByTestId("contact-Marcus Webb");
  const booking = marcus.getByTestId("contact-role-booking"), dayOf = marcus.getByTestId("contact-role-dayOf");
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
  await signInAs(page, "jeff");
  await openVenue(page, A, "cervantes", "Cervantes' Other Side");
  const panel = page.getByTestId("contacts-panel");
  const dialog = page.getByTestId("contact-add-dialog");
  await expect(panel).toContainText("No one yet.");

  // Already in Contacts: find Priya by where she works, pick her, Add to venue (Booking is ticked by default)
  await page.getByTestId("contact-add").click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("To Cervantes' Other Side");
  await expect(page.getByTestId("contact-add-exist")).toBeChecked();
  await page.getByTestId("contact-find").fill("umsfest");
  await page.getByTestId(/^contact-hit-/).filter({ hasText: "Priya Shah" }).click();
  await expect(page.getByTestId("contact-add-booking")).toBeChecked();
  await expect(page.getByTestId("contact-add-dayOf")).not.toBeChecked();
  await expect(page.getByTestId("contact-add-submit")).toHaveText("Add to venue");
  await page.getByTestId("contact-add-submit").click();
  await expect(dialog).toBeHidden();
  const priya = panel.getByTestId("contact-Priya Shah");
  await expect(priya.getByTestId("contact-role-booking")).toHaveAttribute("aria-pressed", "true");

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
  await page.getByTestId("contact-form-emails").fill(`dayof${STAMP}@cervantes.example`);
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
  await priya.getByTestId("contact-remove-Priya Shah").click();
  await added.getByTestId(`contact-remove-${name}`).click();
  await expect(panel).toContainText("No one yet.");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-contacts").click();
  await page.getByTestId("booking-search").fill(name);
  await expect(page.getByTestId(/^row-contact-/).filter({ hasText: name })).toHaveCount(1);
});

test("a venue page opens with a slim pitch card: the active pitch with View pitch, or Not on the Pitch List with what came before", async ({ page }) => {
  await signInAs(page, "jeff");
  await openVenue(page, A, "Lost Lake Lounge"); // Fox Theatre gets booked by the shows spec; this pitch stays open
  const card = page.getByTestId("venue-pitch-card");
  await expect(card).toContainText("On the Pitch List");
  await expect(card.getByTestId("status-chip")).toBeVisible();
  await expect(card).toContainText("Trio");
  await expect(card).toContainText("Haylee"); // the next step: Follow up with Haylee
  await expect(page.getByTestId("pitch-abandon")).toHaveCount(0); // the work happens on the pitch page
  await card.getByTestId("view-pitch").click();
  await expect(page.getByTestId("pitch-page")).toBeVisible();
  await expect(page.getByTestId("pitch-abandon")).toBeVisible();

  await openVenue(page, A, "Hi-Dive", "Hi-Dive");
  const none = page.getByTestId("venue-pitch-card");
  await expect(none.getByTestId("not-on-pitch-list")).toContainText("Not on the Pitch List");
  await expect(none.getByTestId("past-pitches")).toContainText("Pitched before");
  await expect(none.getByTestId("past-pitches")).toContainText("Became a show");
  await expect(none.getByTestId(/^flag-/).first()).toContainText("Add to Pitch List");
});
