import { test, expect, type Page } from "@playwright/test";
import { openTab } from "./env";

// The Money page has buttons money-out-open and money-in-open, and cards we-owe, recent and owed-to-us; owed income rows
// have a "Received" button. Money out: We owe / We paid, a kind, To (a typeahead over band people, players, contacts and
// typed names), and for We paid who paid (an admin: the band has no account) and when.
async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

const BILL = `Backline rental ${Date.now()}`;
const VENDOR = `Rent-a-Rig ${Date.now()}`;
const PLAY = `playing ${Date.now()}`;
const VENUE = `Lost Lake ${Date.now()}`;

test("admin logs a bill we owe a vendor; it shows under We owe; Mark paid asks who paid and settles it", async ({ page }) => {
  await signInAs(page, "jeff");
  await openTab(page, "money");
  await page.getByTestId("money-out-open").click();
  const modal = page.getByTestId("money-out-modal");
  await expect(modal).toBeVisible();
  await modal.getByTestId("mo-owe").check();
  await modal.getByTestId("mo-kind-expense").click();
  await modal.getByTestId("mo-cat-gear").click();
  // a vendor nobody has named before: keep what was typed
  await modal.getByTestId("mo-who-input").fill(VENDOR);
  await modal.getByTestId("mo-who-other").click();
  await expect(modal.getByTestId("mo-who-input")).toHaveValue(VENDOR);
  await modal.getByTestId("mo-amount").fill("42");
  await modal.getByTestId("mo-what").fill(BILL);
  await expect(modal.getByTestId("mo-sentence")).toContainText(`We owe ${VENDOR} $42.00 for ${BILL}`);
  await expect(modal.getByTestId("mo-payer")).toHaveCount(0); // nobody has paid it
  await modal.getByTestId("mo-save").click();
  await expect(modal).toBeHidden();
  const owe = page.getByTestId("we-owe");
  const group = owe.locator('[data-testid^="we-owe-name:"]', { hasText: VENDOR });
  await expect(group).toContainText("$42.00");
  await expect(group).toContainText(BILL);

  await group.locator('[data-testid^="mark-paid-bill-"]').click();
  const dialog = page.getByTestId("money-out-modal");
  await expect(dialog.getByTestId("mark-paid-form")).toBeVisible();
  await expect(dialog.getByTestId("mp-payer")).toHaveValue(/./); // the signed-in admin, unless changed
  await dialog.getByTestId("mp-payer").selectOption({ label: "Ingrid" });
  await expect(dialog.getByTestId("mp-sentence")).toContainText(`Ingrid paid ${VENDOR} $42.00`);
  await dialog.getByTestId("mp-save").click();
  await expect(dialog).toBeHidden();
  await expect(owe).not.toContainText(VENDOR);
  const row = page.getByTestId("recent").locator("tr", { hasText: BILL });
  await expect(row).toContainText("paid by Ingrid");
  await expect(row).toContainText("Paid");
});

test("admin logs 'we paid David $100 for playing' by Venmo from Jeff's account; it shows in Recently with the payer", async ({ page }) => {
  await signInAs(page, "jeff");
  await openTab(page, "money");
  await page.getByTestId("money-out-open").click();
  const modal = page.getByTestId("money-out-modal");
  await modal.getByTestId("mo-paid").check();
  await modal.getByTestId("mo-kind-pay").click();
  await modal.getByTestId("mo-who-input").fill("Dav");
  await modal.getByTestId("mo-who-list").getByRole("option", { name: /David/ }).click();
  await expect(modal.getByTestId("mo-who-input")).toHaveValue("David");
  await modal.getByTestId("mo-amount").fill("100");
  await modal.getByTestId("mo-what").fill(PLAY);
  await expect(modal.getByTestId("mo-payer")).toHaveValue(/./); // defaults to the signed-in admin
  await expect(modal.getByTestId("mo-save")).toBeDisabled(); // How is required for a payout
  await modal.getByTestId("mo-method").selectOption("venmo");
  await expect(modal.getByTestId("mo-saves")).toContainText("Jeff, Venmo");
  await modal.getByTestId("mo-save").click();
  await expect(modal).toBeHidden();
  const row = page.getByTestId("recent").locator("tr", { hasText: PLAY });
  await expect(row).toContainText("David");
  await expect(row).toContainText("$100.00");
  await expect(row).toContainText("paid by Jeff");
});

test("a paid purchase names the vendor and the payer; 'the band owes them back' puts it under We owe", async ({ page }) => {
  const WHAT = `Cables ${Date.now()}`;
  await signInAs(page, "jeff");
  await openTab(page, "money");
  await page.getByTestId("money-out-open").click();
  const modal = page.getByTestId("money-out-modal");
  await modal.getByTestId("mo-paid").check();
  await modal.getByTestId("mo-kind-expense").click();
  await modal.getByTestId("mo-cat-gear").click();
  await modal.getByTestId("mo-who-input").fill("Guitar Center");
  await modal.getByTestId("mo-who-other").click();
  await modal.getByTestId("mo-amount").fill("18");
  await modal.getByTestId("mo-what").fill(WHAT);
  await modal.getByTestId("mo-payer").selectOption({ label: "Ingrid" });
  await expect(modal.getByTestId("mo-method")).toHaveCount(0); // an expense records who and when, not how
  await modal.getByTestId("mo-payback").check();
  await expect(modal.getByTestId("mo-saves")).toContainText("owes Ingrid back");
  await modal.getByTestId("mo-save").click();
  await expect(modal).toBeHidden();
  const row = page.getByTestId("recent").locator("tr", { hasText: WHAT });
  await expect(row).toContainText("Guitar Center");
  await expect(row).toContainText("paid by Ingrid");
  await expect(row).toContainText("Ingrid is owed back");
  await expect(page.getByTestId("we-owe").locator('[data-testid^="we-owe-user:"]', { hasText: WHAT })).toContainText("Ingrid");
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
