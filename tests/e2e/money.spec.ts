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

const WHAT = `Drum heads ${Date.now()}`;

test("member adds an expense (receipt from Drive search); admin marks it paid back; member sees Paid back and can no longer edit", async ({ page, browser }) => {
  const david = await as(browser, "david");
  const p = david.page;
  await openTab(p, "money");
  await p.getByTestId("add-expense-link").click();
  await p.getByTestId("exp-amount").fill("64");
  await p.getByTestId("exp-cat-gear").click();
  await p.getByTestId("expense-what").fill(WHAT);
  await p.getByTestId("receipt-search").fill("Glass");
  await p.getByTestId("receipt-search-go").click();
  await p.locator('[data-testid^="receipt-hit-"]').first().click();
  await expect(p.getByTestId("expense-receipt")).toHaveValue(/^http/);
  await p.getByTestId("exp-save").click();
  await expect(p).toHaveURL(/\/money$/);
  const mine = p.locator('[data-testid^="expense-"]', { hasText: WHAT }).first();
  await expect(mine).toContainText("$64.00");
  await expect(mine).toContainText("Owed");

  await signInAs(page, "jeff");
  await openTab(page, "money");
  await expect(page.locator(".page-actions").getByTestId("add-expense-link")).toBeVisible();
  const owed = page.getByTestId("owed");
  await expect(owed).toContainText(WHAT);
  await owed.locator("div.items-center", { hasText: WHAT }).getByRole("button", { name: "Mark paid back" }).click();
  await expect(owed).not.toContainText(WHAT);

  await p.reload();
  const card = p.locator('[data-testid^="expense-"]', { hasText: WHAT }).first();
  await expect(card).toContainText("Paid back");
  await expect(card.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await david.close();
});


test("admin marks everything owed to one person paid in one go", async ({ page, browser }) => {
  // Eric, not David: the seeded expense is David's, and show-finances expects it still owed.
  const eric = await as(browser, "eric");
  const p = eric.page;
  const items = [`Strings ${Date.now()}`, `Cables ${Date.now()}`];
  for (const what of items) {
    await openTab(p, "money");
    await p.getByTestId("add-expense-link").click();
    await p.getByTestId("exp-amount").fill("20");
    await p.getByTestId("exp-cat-gear").click();
    await p.getByTestId("expense-what").fill(what);
    await p.getByTestId("exp-save").click();
    await expect(p).toHaveURL(/\/money$/);
  }
  await eric.close();

  await signInAs(page, "jeff");
  await openTab(page, "money");
  const owed = page.getByTestId("owed");
  const group = owed.locator('[data-testid^="owed-"]', { hasText: items[0] });
  await expect(group).toContainText(items[1]);
  await group.getByRole("button", { name: "Mark all paid" }).click();
  for (const what of items) await expect(owed).not.toContainText(what);
});
