import { test, expect, type Page } from "@playwright/test";
import { openTab } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

const WHAT = `Tour dinner ${Date.now()}`;

test("member logs a food expense on the tour project and sees what the band owes, what's paid to them and the projects without money", async ({ page }) => {
  await signInAs(page, "david");
  await openTab(page, "money");
  // Members never get the admin cards.
  await expect(page.getByTestId("my-money")).toBeVisible();
  await expect(page.getByTestId("admin-money")).toHaveCount(0);

  const before = await page.getByTestId("my-owed-count").innerText();
  const n = Number(/for (\d+)/.exec(before)![1]);

  await page.getByTestId("add-expense-link").click();
  await page.getByTestId("exp-cat").click();
  await page.getByTestId("exp-cat-opt-food").click();
  await page.getByTestId("exp-amount").fill("36");
  await page.getByTestId("expense-what").fill(WHAT);
  await page.getByTestId("exp-project").selectOption({ label: "Spring West Tour" });
  await page.getByTestId("exp-save").click();
  await expect(page).toHaveURL(/\/money$/);

  const row = page.getByTestId("my-expenses").locator('[data-testid^="my-expense-"]', { hasText: WHAT });
  await expect(row).toContainText("Spring West Tour");
  await expect(row).toContainText("$36.00");
  await expect(row).toContainText("waiting");
  await expect(page.getByTestId("my-owed")).toContainText(`for ${n + 1} expense`);

  // The seeded Venmo payout is listed; the unpaid payouts to the band are not David's and never shown.
  const paid = page.getByTestId("paid-to-me");
  await expect(paid).toContainText("Dairy Arts Center show");
  await expect(paid).toContainText("Venmo");
  await expect(paid).toContainText("$75.00");
  await expect(paid).not.toContainText("Hi-Dive show");
  await expect(paid).not.toContainText("Moonlighters");

  // Projects: names, no money columns.
  await page.getByTestId("projects-link").click();
  await expect(page).toHaveURL(/\/money\/projects$/);
  await expect(page.getByText("Spring West Tour").first()).toBeVisible();
  await expect(page.getByText("Wild Hearts LP").first()).toBeVisible();
  await expect(page.getByText(/\$\d/)).toHaveCount(0);
});
