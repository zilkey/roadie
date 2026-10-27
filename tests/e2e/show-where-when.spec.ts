import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

/** A fresh show at Hi-Dive with no times (its own date, so other specs are not touched). */
async function newShow(page: Page, date: string) {
  await page.goto(A("/shows/new"));
  await page.getByTestId("show-venue").selectOption({ label: "Hi-Dive · Denver" });
  await page.getByTestId("show-date").fill(date);
  await page.getByTestId("deal-guarantee").fill("100");
  await page.getByTestId("show-save").click();
  await expect(page.getByTestId("show-page")).toBeVisible();
}

test("an admin fills in where and when from the empty card", async ({ page }) => {
  await signInAs(page, "jeff");
  await newShow(page, "2027-05-07");
  const card = page.getByTestId("where-when");

  // Empty: venue link, maps link, placeholders, footer
  await expect(card.getByTestId("where-venue")).toHaveText("Hi-Dive");
  await expect(card.getByTestId("where-maps")).toHaveAttribute("href", /google\.com\/maps\/search\/\?api=1&query=/);
  await expect(card.getByTestId("where-maps")).toContainText("Open in Google Maps");
  await expect(card.getByTestId("where-no-times")).toContainText("No times yet.");
  await expect(card.getByTestId("where-no-contact")).toContainText("No day-of contact.");
  await expect(card.getByTestId("where-foot")).toContainText("Not on the band calendar");

  // Add times swaps the box for the grid with Load in already open; Tab moves to the next time, each saves as you leave it
  await card.getByTestId("where-add-times").click();
  await expect(card.getByTestId("where-no-times")).toHaveCount(0);
  await expect(card.getByTestId("where-times-hint")).toContainText("Tab moves to the next time.");
  await expect(card.getByTestId("where-loadIn-input")).toBeFocused();
  await card.getByTestId("where-loadIn-input").fill("17:00");
  await page.keyboard.press("Tab");
  await expect(card.getByTestId("where-loadIn")).toContainText("5:00 pm");
  await expect(card.getByTestId("where-soundcheck")).toBeFocused();
  await page.keyboard.press("Enter");
  await card.getByTestId("where-soundcheck-input").fill("17:45");
  await card.getByTestId("where-soundcheck-input").press("Enter");
  await expect(card.getByTestId("where-soundcheck")).toContainText("5:45 pm");
  await expect(card.getByTestId("where-soundcheck-saved")).toBeVisible();

  // Set: a value, no Save
  await card.getByTestId("where-set").click();
  await card.getByTestId("where-set-input").fill("18:30");
  await card.getByTestId("where-set-input").press("Enter");
  await expect(card.getByTestId("where-set")).toContainText("6:30 pm");

  // Set length: an error instead of saving when it can't be read
  await card.getByTestId("where-length").click();
  await card.getByTestId("where-length-input").fill("a while");
  await card.getByTestId("where-length-input").press("Enter");
  await expect(card.getByTestId("where-length-error")).toHaveText("Couldn't read that. Try 2h, 2:30 or 90m.");
  await expect(card.getByTestId("where-length-input")).toBeVisible();
  await card.getByTestId("where-length-input").fill("2h");
  await card.getByTestId("where-length-input").press("Enter");
  await expect(card.getByTestId("where-length")).toHaveText("2h");
  await expect(card.getByTestId("where-set")).toContainText("6:30 pm – 8:30 pm");
  await expect(card.getByTestId("where-doors")).toHaveText("Add…"); // doors not set

  // Day-of contact from the popover: "Someone else…" becomes a day-of contact of the venue
  await card.getByTestId("where-add-contact").click();
  const menu = card.getByTestId("dayof-menu");
  await expect(menu).toBeVisible();
  await menu.getByTestId("dayof-opt-other").check();
  await expect(menu).toContainText("They’re added to Hi-Dive’s contacts as a day-of contact.");
  await menu.getByTestId("dayof-other-name").fill("Taproom Tom");
  await menu.getByTestId("dayof-other-phone").fill("(303) 555-0117");
  await expect(menu.getByTestId("dayof-save")).toHaveText("Add and use");
  await menu.getByTestId("dayof-save").click();
  await expect(menu).toHaveCount(0);
  await expect(card.getByTestId("where-dayof")).toContainText("Taproom Tom · (303) 555-0117");
  await expect(card.getByTestId("where-public")).toHaveCount(0);

  // The saved contact now heads the venue's day-of contacts; Cancel and Escape change nothing
  await card.getByTestId("where-dayof").click();
  await expect(menu).toContainText("Day-of contacts at Hi-Dive");
  await expect(menu.getByRole("radio", { name: /Taproom Tom/ })).toBeChecked();
  await menu.getByTestId("dayof-opt-none").check();
  await expect(menu.getByTestId("dayof-save")).toHaveText("Clear contact");
  await menu.getByTestId("dayof-cancel").click();
  await expect(menu).toHaveCount(0);
  await card.getByTestId("where-dayof").click();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(card.getByTestId("where-dayof")).toContainText("Taproom Tom");

  // Reload: the times and the contact were written
  await page.reload();
  await expect(card.getByTestId("where-loadIn")).toContainText("5:00 pm");
  await expect(card.getByTestId("where-set")).toContainText("6:30 pm – 8:30 pm");
  await expect(card.getByTestId("where-dayof")).toContainText("Taproom Tom");

  // Add to calendar shows exactly what goes out before anything is sent
  await card.getByTestId("where-calendar-open").click();
  const dlg = page.getByTestId("where-calendar-dialog");
  await expect(dlg.getByTestId("cal-preview-calendar")).toHaveText("Ingrid Avison Band");
  await expect(dlg.getByTestId("cal-preview-title")).toContainText("at Hi-Dive");
  await expect(dlg.getByTestId("cal-preview-when")).toHaveText(/May 7, 2027 · 5:00 pm – /);
  await expect(dlg.getByTestId("cal-preview-where")).toContainText("Hi-Dive");
  await expect(dlg.getByTestId("cal-preview-invitees")).toHaveText("Nobody"); // no one is playing yet
  await expect(dlg.getByTestId("cal-preview-notes")).toContainText("Load in 5:00 pm");
  await expect(dlg.getByTestId("cal-preview-notes")).toContainText("Day-of contact: Taproom Tom");
  await dlg.getByTestId("cal-send").click();
  await expect(card.getByTestId("where-calendar")).toContainText("On the band calendar");
  await expect(card.getByTestId("where-calendar-note")).toContainText("Sent to the band calendar");

  // Opening it again says nothing changed; Update is there, and so is Remove
  await card.getByTestId("where-calendar-open").click();
  await expect(dlg.getByTestId("cal-preview-unchanged")).toBeVisible();
  await expect(dlg.getByTestId("cal-send")).toHaveText("Update event");
  await dlg.getByTestId("cal-remove").click();
  await expect(card.getByTestId("where-calendar")).toContainText("Not on the band calendar");

  // None clears the contact; Add contact opens the same popover to pick them again
  await card.getByTestId("where-dayof").click();
  await menu.getByTestId("dayof-opt-none").check();
  await menu.getByTestId("dayof-save").click();
  await expect(card.getByTestId("where-no-contact")).toContainText("No day-of contact.");
  await card.getByTestId("where-add-contact").click();
  await menu.getByRole("radio", { name: /Taproom Tom/ }).check();
  await expect(menu.getByTestId("dayof-save")).toHaveText("Use Taproom");
  await menu.getByTestId("dayof-save").click();
  await expect(card.getByTestId("where-dayof")).toContainText("Taproom Tom · (303) 555-0117");
});

test("the pencil changes the venue and date; it autosaves and Done closes it", async ({ page }) => {
  await signInAs(page, "jeff");
  await newShow(page, "2027-05-21");
  const card = page.getByTestId("where-when");

  await card.getByTestId("where-when-edit").click();
  await expect(card).toHaveAttribute("data-editing", "1");
  await expect(card.getByTestId("where-when-cancel")).toHaveCount(0);
  await expect(card.getByTestId("where-venue-hint")).toContainText("from the venue record");
  // The times and the day-of contact stay under the form (a new Hi-Dive show may already carry the venue's day-of contact)
  await expect(card.getByTestId("where-no-times")).toBeVisible();
  await expect(card.getByTestId(/^where-(no-contact|dayof-row)$/)).toBeVisible();

  // An invalid combination says why and sends nothing
  await card.getByTestId("where-venue-select").selectOption("");
  await expect(card.getByTestId("error")).toContainText("Choose a venue, or the festival if the venue is TBD.");

  await card.getByTestId("where-venue-select").selectOption({ label: "Washington's · Fort Collins" });
  await expect(card.getByTestId("error")).toHaveCount(0);
  await card.getByTestId("where-date").fill("2027-05-22");
  await expect(card.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  await card.getByTestId("where-when-done").click();
  await expect(card).not.toHaveAttribute("data-editing", "1");
  await expect(card.getByTestId("where-venue")).toHaveText("Washington's");

  await page.reload();
  await expect(card.getByTestId("where-venue")).toHaveText("Washington's");
  await expect(page.getByTestId("page-title")).toContainText("May 22");
});

test("a member sees where and when as plain text", async ({ page }) => {
  await signInAs(page, "david");
  await page.goto(A("/shows"));
  const id = await page.getByTestId("shows-row").filter({ hasText: "Hi-Dive" }).first().getAttribute("data-id");
  await page.goto(A(`/shows/${id}`));
  const card = page.getByTestId("where-when");
  await expect(card.getByTestId("where-venue")).toBeVisible();
  await expect(card.getByTestId("where-when-edit")).toHaveCount(0);
  await expect(card.locator("button.val")).toHaveCount(0);
  await expect(card.getByTestId("where-dayof")).toBeVisible(); // the seeded show has one: text and a tel: link, no button
});
