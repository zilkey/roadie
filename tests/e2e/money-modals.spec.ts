import { test, expect, type Page } from "@playwright/test";
import { openTab } from "./env";

// Assumes (built by other workstreams): the Money page has buttons money-out-open and money-in-open, and cards we-owe,
// recent and owed-to-us; owed income rows have a "Received" button.
async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

const GAS = `gas ${Date.now()}`;
const PLAY = `playing ${Date.now()}`;
const VENUE = `Lost Lake ${Date.now()}`;

test("admin logs 'we owe Eric $42 for gas' as a pay-back; it shows under We owe", async ({ page }) => {
  await signInAs(page, "jeff");
  await openTab(page, "money");
  await page.getByTestId("money-out-open").click();
  const modal = page.getByTestId("money-out-modal");
  await expect(modal).toBeVisible();
  await modal.getByTestId("mo-owe").check();
  await modal.getByTestId("mo-kind-pay-back").click();
  await modal.getByTestId("mo-who").selectOption({ label: "Eric" });
  await modal.getByTestId("mo-amount").fill("42");
  await modal.getByTestId("mo-what").fill(GAS);
  await expect(modal.getByTestId("mo-sentence")).toContainText(`We owe Eric $42.00 for ${GAS}`);
  await modal.getByTestId("mo-save").click();
  await expect(modal).toBeHidden();
  const owe = page.getByTestId("we-owe");
  await expect(owe).toContainText("Eric");
  await expect(owe).toContainText("$42.00");
});

test("admin logs 'we paid David $100 for playing' by Venmo; it shows in Recently", async ({ page }) => {
  await signInAs(page, "jeff");
  await openTab(page, "money");
  await page.getByTestId("money-out-open").click();
  const modal = page.getByTestId("money-out-modal");
  await modal.getByTestId("mo-paid").check();
  await modal.getByTestId("mo-kind-pay").click();
  await modal.getByTestId("mo-who").selectOption({ label: "David" });
  await modal.getByTestId("mo-amount").fill("100");
  await modal.getByTestId("mo-what").fill(PLAY);
  await expect(modal.getByTestId("mo-save")).toBeDisabled(); // How is required
  await modal.getByTestId("mo-method").selectOption("venmo");
  await expect(modal.getByTestId("mo-saves")).toContainText("Venmo");
  await modal.getByTestId("mo-save").click();
  await expect(modal).toBeHidden();
  const recent = page.getByTestId("recent");
  await expect(recent).toContainText("David");
  await expect(recent).toContainText("$100.00");
});

test("Cancel discards: the modal reopens empty", async ({ page }) => {
  await signInAs(page, "jeff");
  await openTab(page, "money");
  await page.getByTestId("money-out-open").click();
  await page.getByTestId("mo-amount").fill("5");
  await page.getByTestId("mo-cancel").click();
  await expect(page.getByTestId("money-out-modal")).toBeHidden();
  await page.getByTestId("money-out-open").click();
  await expect(page.getByTestId("mo-amount")).toHaveValue("");
});

test("admin logs income owed to us, then marks it received", async ({ page }) => {
  await signInAs(page, "jeff");
  await openTab(page, "money");
  await page.getByTestId("money-in-open").click();
  const modal = page.getByTestId("money-in-modal");
  await expect(modal).toBeVisible();
  await modal.getByTestId("mi-owed").check();
  await modal.getByTestId("mi-cat-guarantee").click();
  await modal.getByTestId("mi-from").fill(VENUE);
  await modal.getByTestId("mi-amount").fill("400");
  await expect(modal.getByTestId("mi-sentence")).toContainText(`${VENUE} owes us $400.00 (guarantee)`);
  await modal.getByTestId("mi-save").click();
  await expect(modal).toBeHidden();
  const owed = page.getByTestId("owed-to-us");
  const row = owed.locator('[data-testid^="owed-income-"]', { hasText: VENUE });
  await expect(row).toContainText("$400.00");
  await row.locator('[data-testid^="owed-received-"]').click();
  await expect(owed).not.toContainText(VENUE);
});
