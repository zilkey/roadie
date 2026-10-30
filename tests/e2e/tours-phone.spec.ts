import { test, expect, type Browser } from "@playwright/test";
import { A } from "./env";

async function as(browser: Browser, key: string, phone = false) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 } } : {});
  const page = await ctx.newPage();
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
  return { page, close: () => ctx.close() };
}

// Its own tour and its own venue (no pitch), so the file runs in any order.
let tourUrl = "";
const venueName = `Phone Venue ${Date.now()}`;
const D1 = "2027-06-07", D2 = "2027-06-08";

test.describe.serial("tours on a phone", () => {
  test("setup: an unpitched venue and a tour", async ({ browser }) => {
    const { page, close } = await as(browser, "jeff");
    await page.goto(A("/booking"));
    await page.getByTestId("booking-add-actions").click();
    await page.getByTestId("add-venue").click();
    await page.getByTestId("new-venue-name").fill(venueName);
    await page.getByTestId("new-venue-city").fill("Boulder");
    await page.getByTestId("new-venue-submit").click();
    await expect(page.getByTestId("venue-page")).toBeVisible();

    await page.goto(A("/tours/new"));
    await page.getByTestId("tour-name-input").fill("Phone Run");
    await page.getByTestId("tour-start").fill(D1);
    await page.getByTestId("tour-end").fill("2027-06-09");
    await page.getByTestId("tour-act").selectOption({ label: "Duo" });
    await page.getByTestId("create-tour").click();
    await expect(page).toHaveURL(/\/tours\/(?!new)[^/?]+$/);
    tourUrl = new URL(page.url()).pathname;
    await close();
  });

  test("at phone width: Plan, Info and Money tabs, no Sheet tab, no tray", async ({ browser }) => {
    const { page, close } = await as(browser, "jeff", true);
    await page.goto(tourUrl);
    await expect(page.getByTestId("tour-plan")).toBeVisible();
    await expect(page.getByTestId("tour-tab-plan")).toBeVisible();
    await expect(page.getByTestId("tour-tab-info")).toBeVisible();
    await expect(page.getByTestId("tour-tab-money")).toBeVisible();
    await expect(page.getByTestId("tour-tab-sheet")).toBeHidden();
    await expect(page.getByTestId("tour-tray")).toBeHidden();
    await expect(page.getByTestId(`plan-day-add-${D1}`)).toBeVisible();
    await expect(page.getByTestId(`plan-plus-${D1}-0-actions`)).toBeHidden();
    await close();
  });

  test("a day's + opens the sheet; Venues adds a not-pitched venue for that date", async ({ browser }) => {
    const { page, close } = await as(browser, "jeff", true);
    await page.goto(tourUrl);
    await page.getByTestId(`plan-day-add-${D2}`).click();
    const sheet = page.getByTestId("add-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading")).toHaveText(/Add to .*Jun 8/);
    await expect(sheet.getByTestId("add-sheet-tab-venues")).toBeChecked();
    // The day has no town: every venue with no pitch yet, searchable.
    await sheet.getByTestId("add-sheet-search").fill(venueName);
    const row = sheet.getByTestId("add-sheet-venues").locator("li").filter({ hasText: venueName });
    await expect(row).toContainText("Boulder");
    await row.getByRole("button", { name: "Add" }).click();
    await expect(row).toHaveCount(0); // it has a pitch now
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId(`plan-day-${D2}`).locator('[data-kind="option"]')).toContainText(venueName);
    await close();
  });

  test("Travel → Note opens the note modal and lands on the day", async ({ browser }) => {
    const { page, close } = await as(browser, "jeff", true);
    await page.goto(tourUrl);
    await page.getByTestId(`plan-day-add-${D1}`).click();
    await page.getByTestId("add-sheet-tab-travel").click();
    await page.getByTestId("add-sheet-travel-note").click();
    await expect(page.getByTestId("add-sheet")).toBeHidden();
    await page.getByTestId("entry-text").fill("Phone note");
    await page.getByTestId("entry-add").click();
    await expect(page.getByTestId(`plan-day-${D1}`).getByTestId("plan-entry")).toHaveText([/Phone note/]);
    await close();
  });

  test("cleanup: cancel the tour", async ({ browser }) => {
    const { page, close } = await as(browser, "jeff");
    page.on("dialog", (d) => void d.accept());
    await page.goto(tourUrl);
    await page.getByTestId("tour-actions").click();
    await page.getByTestId("tour-menu-cancel").click();
    await expect(page).toHaveURL(/\/tours$/);
    await close();
  });
});
