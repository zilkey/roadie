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

  // Add times opens the edit form
  await card.getByTestId("where-add-times").click();
  await expect(card).toHaveAttribute("data-editing", "1");
  await card.getByTestId("where-loadIn").fill("17:00");
  await card.getByTestId("where-soundcheck").fill("17:45");
  await card.getByTestId("where-showStart").fill("18:30");
  await card.getByTestId("where-same-as-start").click();
  await expect(card.getByTestId("where-set")).toHaveValue("18:30");

  // Set length: said back, and an error instead of saving when it can't be read
  await card.getByTestId("where-length").fill("2:30");
  await expect(card.getByTestId("where-length-says")).toHaveText("2 hours 30 minutes · ends at 9:00 PM");
  await card.getByTestId("where-length").fill("a while");
  await expect(card.getByTestId("where-length-error")).toBeVisible();
  await card.getByTestId("where-when-save").click();
  await expect(card).toHaveAttribute("data-editing", "1");
  await expect(card.getByTestId("error")).toContainText("set length");
  await card.getByTestId("where-length").fill("2h");
  await expect(card.getByTestId("where-length-says")).toHaveText("2 hours · ends at 8:30 PM");

  // Day-of contact created here is saved to the venue's contacts as a day-of contact (publishing is on the Promotion card, not here)
  await expect(card.getByTestId("where-dayof-select").locator("option[value=other]")).toHaveText("Create new…");
  await card.getByTestId("where-dayof-select").selectOption("other");
  await card.getByTestId("where-other-name").fill("Taproom Tom");
  await card.getByTestId("where-other-phone").fill("(303) 555-0117");
  await expect(card.getByTestId("where-public-check")).toHaveCount(0);
  await card.getByTestId("where-when-save").click();
  await expect(card).not.toHaveAttribute("data-editing", "1");

  // View
  const times = card.getByTestId("where-times");
  await expect(times).toContainText("5:00 pm");
  await expect(times).toContainText("5:45 pm");
  await expect(times).toContainText("6:30 pm – 8:30 pm");
  await expect(times).toContainText("2h");
  await expect(times).toContainText("—"); // doors not set
  await expect(card.getByTestId("where-dayof")).toContainText("Taproom Tom");
  await expect(card.getByTestId("where-dayof").locator("a")).toHaveAttribute("href", "tel:3035550117");
  await expect(card.getByTestId("where-public")).toHaveCount(0);
  await expect(card.getByTestId("where-no-times")).toHaveCount(0);

  // The saved contact now heads the venue's day-of contacts
  await card.getByTestId("where-when-edit").click();
  await expect(card.getByTestId("where-dayof-select").locator('optgroup[label="Day-of contacts"] option', { hasText: "Taproom Tom" })).toHaveCount(1);
  await card.getByTestId("where-dayof-select").selectOption("");
  await card.getByTestId("where-when-cancel").click();
  await expect(card.getByTestId("where-dayof")).toContainText("Taproom Tom"); // Cancel changed nothing

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
});
