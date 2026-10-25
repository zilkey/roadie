import { test, expect } from "@playwright/test";
import { A } from "./env";

test("Finances tab: income from a starter and an expense with a receipt; the total and Net follow", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-jeff").click();
  await expect(page).toHaveURL(/\/calendar$/);

  // The seeded played show (Dairy Arts Center): only the date cell links.
  await page.goto(A("/shows#played"));
  await page.getByTestId("shows-table-played").getByTestId("shows-row").filter({ hasText: "Dairy Arts Center" }).first().locator("td.date a").click();
  await expect(page).toHaveURL(/\/shows\/[^/?]+/);
  await page.getByTestId("show-tab-finances").click();

  // Income: admin-only; the seeded show already has a $450 guarantee, so there is no empty starter box to press
  const income = page.getByTestId("income");
  await expect(income).toBeVisible();
  await expect(income.getByTestId("admin-only")).toBeVisible();
  await expect(income.getByTestId("income-line")).toHaveCount(1);
  await income.getByTestId("income-edit").click();
  await income.getByTestId("income-add").click();
  const rows = income.getByTestId("income-row");
  await rows.nth(1).getByTestId("income-what").selectOption("tips");
  await rows.nth(1).getByTestId("income-amount").fill("84");
  await expect(income.getByTestId("income-total")).toContainText("$534.00");
  await income.getByTestId("income-notes").fill("Check made out to the LLC");
  await income.getByTestId("income-save").click();
  await expect(income).not.toHaveAttribute("data-editing", "1");
  await expect(income.getByTestId("income-line")).toHaveCount(2);
  await expect(income.getByTestId("income-total")).toContainText("$534.00");
  await expect(income.getByTestId("income-notes-view")).toHaveText("Check made out to the LLC");

  // Expenses: the seeded one, edited in place to fix its amount; adding goes to the full form (no inline add)
  const card = page.getByTestId("expenses");
  await expect(card.getByText("Bass strings and cables")).toBeVisible();
  await expect(card.getByText("Owed").first()).toBeVisible();
  await expect(page.getByTestId("net")).toBeVisible();

  await page.getByTestId("expenses-edit").click();
  await expect(card.getByTestId("expenses-add-line")).toHaveCount(0);
  const line = page.getByTestId("expense-line-0");
  await line.getByTestId("expense-what").fill("Bass strings, cables and gas");
  await line.getByTestId("expense-amount").fill("60.90");
  await expect(page.getByTestId("expenses-total")).toHaveText("$60.90");
  await page.getByTestId("expenses-save").click();
  await expect(card.getByText("Bass strings, cables and gas")).toBeVisible();
  await expect(page.getByTestId("expenses-total")).toHaveText("$60.90");
  await expect(page.getByTestId("net")).toBeVisible();
});

test("Finances tab: the full expense form opens for the show and returns to it on Save", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-jeff").click();
  await expect(page).toHaveURL(/\/calendar$/);

  await page.goto(A("/shows#played"));
  await page.getByTestId("shows-table-played").getByTestId("shows-row").filter({ hasText: "Dairy Arts Center" }).first().locator("td.date a").click();
  await expect(page).toHaveURL(/\/shows\/[^/?]+/);
  await page.getByTestId("show-tab-finances").click();

  await page.getByTestId("expenses").getByTestId("expenses-full-form").click();
  await expect(page).toHaveURL(/\/money\/expense\?show=/);
  await expect(page.getByTestId("exp-cat-gas")).toBeVisible(); // gas is one of the choices
  await page.getByTestId("exp-amount").fill("18");
  await page.getByTestId("expense-what").fill("Parking garage");
  await page.getByTestId("exp-save").click();

  await expect(page).toHaveURL(/\/shows\/[^/?]+\?tab=finances$/);
  await expect(page.getByTestId("expenses").getByTestId("expense-row").filter({ hasText: "Parking garage" })).toBeVisible();
});
