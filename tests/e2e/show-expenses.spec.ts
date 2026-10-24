import { test, expect, type Browser, type Page } from "@playwright/test";
import { A } from "./env";

async function as(browser: Browser, key: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
  return { page, close: () => ctx.close() };
}

/** The seeded played show (Dairy Arts Center): open its Finances tab. */
async function openFinances(page: Page) {
  await page.goto(A("/shows#played"));
  await page.getByTestId("shows-table-played").getByText("Dairy Arts Center").first().click();
  await expect(page).toHaveURL(/\/shows\/[^/?]+/);
  await page.getByTestId("show-tab-finances").click();
  await expect(page.getByTestId("expenses")).toBeVisible();
}

test("an admin sees the seeded expense, adds one with a receipt, and Net follows", async ({ browser }) => {
  const { page, close } = await as(browser, "jeff");
  await openFinances(page);
  const card = page.getByTestId("expenses");
  await expect(card.getByText("Bass strings and cables")).toBeVisible();
  await expect(card.getByText("Owed").first()).toBeVisible();
  await expect(page.getByTestId("net")).toBeVisible();

  await page.getByTestId("expenses-edit").click();
  await page.getByTestId("expenses-add-line").click();
  const line = page.getByTestId("expense-line-1");
  await line.getByTestId("expense-what").fill("Gas to Boulder");
  await line.getByTestId("expense-amount").fill("abc");
  await page.getByTestId("expenses-save").click();
  await expect(line.getByTestId("expense-error")).toBeVisible();
  await line.getByTestId("expense-amount").fill("32.40");
  await line.getByTestId("expense-attach").click();
  await line.getByTestId("expense-link").fill("https://drive.google.com/file/d/abc123/view");
  await expect(page.getByTestId("expenses-total")).toHaveText("$60.90");
  await page.getByTestId("expenses-save").click();
  await expect(page.getByTestId("expenses").getByText("Gas to Boulder")).toBeVisible();
  await expect(page.getByTestId("expenses-total")).toHaveText("$60.90");
  await close();
});

test("a member sees only their own expenses, with no Paid by choice and no Net", async ({ browser }) => {
  const { page, close } = await as(browser, "eric");
  await openFinances(page);
  await expect(page.getByTestId("net")).toHaveCount(0);
  await expect(page.getByTestId("expenses").getByText("Bass strings and cables")).toHaveCount(0); // David's
  await page.getByTestId("expenses-edit").click();
  await expect(page.getByTestId("expense-by").first()).toHaveText("You");
  await expect(page.getByTestId("expense-markpaid")).toHaveCount(0);
  await page.getByTestId("expense-what").first().fill("Capo");
  await page.getByTestId("expense-amount").first().fill("9");
  await page.getByTestId("expenses-save").click();
  await expect(page.getByTestId("expenses").getByText("Capo")).toBeVisible();
  await expect(page.getByTestId("expenses").getByText("· You").first()).toBeVisible();
  await close();
});
