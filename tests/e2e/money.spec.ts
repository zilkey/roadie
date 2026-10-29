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
  // Emma, not David: paying a person pays everything owed to them, and the seeded expenses are David's (show-finances edits one).
  const emma = await as(browser, "emma");
  const p = emma.page;
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
  await expect(mine).toContainText("waiting");

  await signInAs(page, "jeff");
  await openTab(page, "money");
  await expect(page.locator(".page-actions").getByTestId("add-expense-link")).toBeVisible();
  const owe = page.getByTestId("we-owe");
  const group = owe.locator('[data-testid^="we-owe-user:"]', { hasText: WHAT });
  await expect(group).toContainText(WHAT);
  await payInModal(page, group, "Emma");
  await expect(owe).not.toContainText(WHAT);

  await p.reload();
  const card = p.locator('[data-testid^="expense-"]', { hasText: WHAT }).first();
  await expect(card).toContainText("paid back");
  await expect(card.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await emma.close();
});


test("admin pays everything owed to one person in one go", async ({ page, browser }) => {
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
  const owe = page.getByTestId("we-owe");
  const group = owe.locator('[data-testid^="we-owe-user:"]', { hasText: items[0] });
  await expect(group).toContainText(items[1]);
  await payInModal(page, group, "Eric");
  for (const what of items) await expect(owe).not.toContainText(what);
});

test("Overview lists what is owed to us and what we owe; Received marks the Lost Lake guarantee", async ({ page }) => {
  await signInAs(page, "jeff");
  await openTab(page, "money");
  const owedIn = page.getByTestId("owed-to-us");
  await expect(owedIn).toContainText("Lost Lake Lounge");
  await expect(owedIn).toContainText("$300.00");
  const owe = page.getByTestId("we-owe");
  await expect(owe).toContainText("The Moonlighters");
  await expect(owe).toContainText("Eric");
  await expect(page.getByTestId("recent")).toBeVisible();
  await expect(page.getByTestId("open-projects")).toBeVisible();
  await owedIn.locator("div.items-center", { hasText: "Lost Lake Lounge" }).getByRole("button", { name: "Received" }).click();
  await expect(owedIn).not.toContainText("Lost Lake Lounge");
});

test("Projects tab lists the seeded projects; New project adds Fall run and Cancel discards", async ({ page }) => {
  await signInAs(page, "jeff");
  await openTab(page, "money");
  await page.getByTestId("money-tab-projects").click();
  const table = page.getByTestId("projects-table");
  for (const name of ["Band", "Duo", "Wild Hearts LP", "Spring West Tour", "Lighthouse video"]) await expect(table).toContainText(name);
  await expect(table.locator("tr", { hasText: "Band" }).first()).toContainText("default");

  await page.getByTestId("new-project").click();
  await page.getByTestId("np-name").fill("Discarded");
  await page.getByTestId("np-cancel").click();
  await expect(page.getByTestId("np-name")).toHaveCount(0);
  await expect(table).not.toContainText("Discarded");

  await page.getByTestId("new-project").click();
  await expect(page.getByTestId("np-name")).toHaveValue("");
  await page.getByTestId("np-name").fill("Fall run");
  await page.getByTestId("np-kind").selectOption("tour");
  await page.getByTestId("np-budget").fill("2000");
  await page.getByTestId("np-add").click();
  await expect(table).toContainText("Fall run");
  await expect(table.locator("tr", { hasText: "Fall run" })).toContainText("Tour");
});

test("the Wild Hearts LP project page shows its totals and records", async ({ page }) => {
  await signInAs(page, "jeff");
  await openTab(page, "money");
  await page.getByTestId("money-tab-projects").click();
  await page.getByTestId("projects-table").locator("tr", { hasText: "Wild Hearts LP" }).click();
  await expect(page).toHaveURL(/\/money\/projects\/[^/]+$/);
  await expect(page.getByTestId("project-page")).toContainText("Wild Hearts LP");
  const totals = page.getByTestId("project-totals");
  await expect(totals).toContainText("$6,000.00");
  await expect(totals).toContainText("$184.00");
  await expect(page.getByTestId("project-records")).toContainText("Bandcamp");
  await expect(page.getByTestId("project-records")).toContainText("Owed to us");
  await expect(page.getByTestId("project-by-category")).toBeVisible();
  await page.getByTestId("back").click();
  await expect(page).toHaveURL(/\/money\/projects$/);
});

/** Pay one person's group from the We owe card: Money out opens on "We paid"; pick Venmo and save. */
async function payInModal(page: Page, group: import("@playwright/test").Locator, first: string) {
  await group.getByRole("button", { name: `Pay ${first}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByTestId("mo-method").selectOption("venmo");
  await dialog.getByTestId("mo-save").click();
  await expect(dialog).toHaveCount(0);
}
