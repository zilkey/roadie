import { test, expect, type Browser, type Page } from "@playwright/test";
import { openTab } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

async function as(browser: Browser, key: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInAs(page, key);
  return { page, close: () => ctx.close() };
}

const WHAT = `Tour dinner ${Date.now()}`;

test("member logs a food expense on the tour project and sees what the band owes, what's paid to them and the projects without money", async ({ page }) => {
  await signInAs(page, "hugo");
  await openTab(page, "money");
  // Members never get the admin cards.
  await expect(page.getByTestId("my-money")).toBeVisible();
  await expect(page.getByTestId("admin-money")).toHaveCount(0);

  const before = await page.getByTestId("my-money-total-count").innerText();
  const n = Number(/(\d+) expense/.exec(before)![1]);

  await page.getByTestId("add-expense-link").click();
  await page.getByTestId("exp-cat").click();
  await page.getByTestId("exp-cat-opt-food").click();
  await page.getByTestId("exp-amount").fill("36");
  await page.getByTestId("expense-what").fill(WHAT);
  await page.getByTestId("exp-project").selectOption({ label: "Spring West Tour" });
  await page.getByTestId("exp-save").click();
  await expect(page).toHaveURL(/\/money$/);

  const row = page.getByTestId("my-money-table").locator('[data-testid^="my-money-row-"]', { hasText: WHAT });
  await expect(row).toContainText("Spring West Tour");
  await expect(row).toContainText("$36.00");
  await expect(row).toContainText("Owed to you");
  await expect(page.getByTestId("my-money-total-count")).toContainText(`${n + 1} expense`);

  // The seeded Venmo payout is listed; the unpaid payouts to the band are not Hugo's and never shown.
  const paid = page.getByTestId("my-money-table");
  await expect(paid).toContainText("Creamery Arts Center show");
  await expect(paid).toContainText("Paid Oct 12");
  await expect(paid).toContainText("$75.00");
  await expect(paid).not.toContainText("Deep End show");
  await expect(paid).not.toContainText("Moonlighters");

  // My money has no Projects button for a member. The list itself: names, no money columns.
  await expect(page.getByTestId("projects-link")).toHaveCount(0);
  await page.goto(page.url().replace(/\/money.*$/, "/money/projects"));
  await expect(page).toHaveURL(/\/money\/projects$/);
  await expect(page.getByText("Spring West Tour").first()).toBeVisible();
  await expect(page.getByText("Wild Hearts LP").first()).toBeVisible();
  await expect(page.getByText(/\$\d/)).toHaveCount(0);
});

const money = (t: string) => Math.round(Number(t.replace(/[^0-9.]/g, "")) * 100);

test("My money is one table: a pinned total, sorting, no reimbursement row, and an autosaving editor", async ({ page, browser }) => {
  // Iris pays herself in: her own expense, paid back by an admin, so the table shows it as "Paid back" and no row for the reimbursement.
  const iris = await as(browser, "iris");
  const p = iris.page;
  const PAID = `Reimbursed picks ${Date.now()}`, OPEN = `Open cables ${Date.now()}`;
  await openTab(p, "money");
  await p.getByTestId("add-expense-link").click();
  await p.getByTestId("exp-amount").fill("21");
  await p.getByTestId("expense-what").fill(PAID);
  await p.getByTestId("exp-save").click();
  await expect(p).toHaveURL(/\/money$/);
  // The admin pays Iris back (everything owed to her).
  await signInAs(page, "rudy");
  await openTab(page, "money");
  const group = page.getByTestId("we-owe").locator('[data-testid^="we-owe-user:"]', { hasText: PAID });
  await group.getByRole("button", { name: "Pay Iris" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByTestId("mo-method").selectOption("venmo");
  await dialog.getByTestId("mo-save").click();
  await expect(dialog).toHaveCount(0);
  await p.reload();
  // Log one more that stays unpaid.
  await p.getByTestId("add-expense-link").click();
  await p.getByTestId("exp-amount").fill("9");
  await p.getByTestId("expense-what").fill(OPEN);
  await p.getByTestId("exp-save").click();
  await expect(p).toHaveURL(/\/money$/);

  const table = p.getByTestId("my-money-table");
  const rows = table.locator('[data-testid^="my-money-row-"]');
  await expect(rows.filter({ hasText: PAID }).getByTestId(/my-money-status-/)).toContainText("Paid back");
  await expect(rows.filter({ hasText: /Reimbursement/i })).toHaveCount(0);
  // The total is the sum of what is still owed back.
  const owedRows = rows.filter({ has: p.locator('[data-testid^="my-money-status-"]', { hasText: "Owed to you" }) });
  await expect(p.getByTestId("my-money-total-count")).toContainText(`${await owedRows.count()} expense`);
  const owedSum = (await owedRows.locator("td.font-mono").allInnerTexts()).reduce((n: number, t: string) => n + money(t), 0);
  expect(money(await p.getByTestId("my-money-total-amount").innerText())).toBe(owedSum);

  // Sorting by Amount reorders the rows; the total stays first.
  await table.getByTestId("my-money-sort-amount").click();
  await expect(table.locator("th[aria-sort]")).toContainText("Amount");
  const amounts = async () => (await rows.locator("td.font-mono").allInnerTexts()).map(money);
  const desc = await amounts();
  expect(desc).toEqual([...desc].sort((a, b) => b - a));
  await table.getByTestId("my-money-sort-amount").click();
  const asc = await amounts();
  expect(asc).toEqual([...asc].sort((a, b) => a - b));
  await expect(table.locator("tbody tr").first()).toHaveAttribute("data-testid", "my-money-total");

  // An unpaid expense opens the editor; a changed What autosaves. A paid-back one doesn't open it.
  await rows.filter({ hasText: PAID }).click();
  await expect(p.getByTestId("expense-editor")).toHaveCount(0);
  await rows.filter({ hasText: OPEN }).click();
  const editor = p.getByTestId("expense-editor");
  await expect(editor).toBeVisible();
  const RENAMED = `${OPEN} renamed`;
  await editor.getByTestId("expense-edit-what").fill(RENAMED);
  await editor.getByTestId("expense-edit-amount").focus(); // blur saves
  await editor.getByTestId("expense-edit-done").click();
  await p.reload();
  await expect(p.getByTestId("my-money-table")).toContainText(RENAMED);
  await iris.close();
});
