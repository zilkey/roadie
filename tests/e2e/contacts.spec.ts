import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

test("Contacts starts in More for an admin and opens the list", async ({ page }) => {
  await signInAs(page, "rudy");
  await expect(page.getByTestId("tab-contacts")).toHaveCount(0); // not in the main bar
  await page.getByTestId("more-toggle").click();
  await page.getByTestId("more-contacts").click();
  await expect(page).toHaveURL(/\/contacts$/);
  await expect(page.getByTestId("contacts-list")).toBeVisible();
  await expect(page.getByTestId("tab-booking")).toBeVisible();
  await expect(page.getByTestId("booking-seg-contacts")).toHaveCount(0); // no Contacts tab on Booking any more
});

test("the old Booking contact URLs redirect to the new pages", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/booking/contacts"));
  await expect(page).toHaveURL(/\/artists\/[^/]+\/contacts$/);
  await expect(page.getByTestId("contacts-list")).toBeVisible();
});

test("search and a filter chip narrow the list; a name opens the contact", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/contacts"));
  await expect(page.getByTestId(/^row-contact-/).first()).toBeVisible();
  const all = await page.getByTestId(/^row-contact-/).count();
  expect(all).toBeGreaterThanOrEqual(4);
  await page.getByTestId("contacts-search").fill("wren");
  await expect(page.getByTestId(/^row-contact-/)).toHaveCount(1);
  await expect(page.getByTestId(/^row-contact-/)).toContainText("Wren Ortiz");
  await page.getByTestId("contacts-search").fill("pine hollow"); // a linked place's name
  await expect(page.getByTestId(/^row-contact-/).filter({ hasText: "Rosa Jackson" })).toHaveCount(1);
  await page.getByTestId("contacts-search-clear").click();
  await expect(page.getByTestId(/^row-contact-/)).toHaveCount(all);
  await page.getByTestId("contacts-filter-festival").click();
  await expect(page.getByTestId("contacts-filter-festival")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId(/^row-contact-/).filter({ hasText: "Anika Shah" })).toHaveCount(1);
  expect(await page.getByTestId(/^row-contact-/).count()).toBeLessThan(all);
  await page.getByTestId("contacts-filter-email").click(); // filters combine
  await expect(page.getByTestId(/^row-contact-/).filter({ hasText: "Anika Shah" })).toHaveCount(1);
  await page.getByTestId("contacts-filter-clear").click();
  await expect(page.getByTestId(/^row-contact-/)).toHaveCount(all);
  await page.getByTestId("contacts-filter-manager").click(); // Desmond is a "Booking manager"
  await expect(page.getByTestId(/^row-contact-/).filter({ hasText: "Desmond Webb" })).toHaveCount(1);
  await expect(page.getByTestId(/^row-contact-/).filter({ hasText: "Rosa Jackson" })).toHaveCount(0);
  await page.getByTestId("contacts-filter-clear").click();
  await page.getByTestId("contacts-search").fill("desmond");
  await page.getByTestId(/^contact-full-/).click();
  await expect(page.getByTestId("contact-page")).toBeVisible();
});

test("Add contact makes nothing until Add is pressed; Cancel clears the draft so the form stays shut on reload", async ({ page }) => {
  await signInAs(page, "rudy");
  const name = `Draft Person ${Date.now()}`;
  await page.goto(A("/contacts"));
  await page.getByTestId("add-contact").click();
  await page.getByTestId("new-contact-name").fill(name);
  await expect(page.getByTestId("draft-status")).toHaveText("Draft saved");
  await page.reload(); // an unfinished draft opens its form again...
  await expect(page.getByTestId("new-contact-name")).toHaveValue(name);
  await page.getByTestId("new-contact").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("new-contact")).toHaveCount(0);
  await page.reload(); // ...but Cancel threw it away
  await expect(page.getByTestId("contacts-list")).toBeVisible();
  await expect(page.getByTestId("new-contact")).toHaveCount(0);
  await page.getByTestId("contacts-search").fill(name);
  await expect(page.getByTestId("no-results")).toBeVisible(); // nothing was created
  // Add creates the contact and opens its page
  await page.getByTestId("add-contact").click();
  await page.getByTestId("new-contact-name").fill(name);
  await page.getByTestId("new-contact-submit").click();
  await expect(page.getByTestId("contact-page")).toBeVisible();
  await expect(page.getByTestId("page-title")).toHaveText(name);
  await expect(page.getByTestId("contact-shows")).toContainText("None.");
  await expect(page.getByTestId("contact-money")).toContainText("None.");
});

test("a contact's page lists the shows they are on the deal for", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/contacts"));
  await page.getByTestId("contacts-search").fill("wren");
  await page.getByTestId(/^contact-full-/).click();
  const shows = page.getByTestId("contact-shows");
  await expect(shows).toContainText("Creamery Arts Center");
  await expect(shows).toContainText("On the deal");
  await shows.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/shows\//);
});
