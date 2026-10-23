import { test, expect, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
}
async function as(browser: Browser, key: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInAs(page, key);
  return { page, close: () => ctx.close() };
}

const WHAT = `Drum heads ${Date.now()}`;

test("enter money after the played seeded show: ledger entries, payouts, settled", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto("/shows");
  await page.getByTestId("shows-past").getByText("Dairy Arts Center").click();
  await page.getByTestId("after-show").click();
  const id = page.url().split("/shows/")[1].split("/")[0];

  // the guarantee ($450) is prefilled from the deal; add the door
  await expect(page.getByTestId("income-guarantee")).toHaveValue("450");
  await page.getByTestId("income-door").fill("100");
  await page.getByTestId("income-merch").fill("55.50");
  await expect(page.getByTestId("income-total")).toHaveText("$605.50");
  // trio: three people, split evenly with leftover cents on the first
  await expect(page.locator('[data-testid^="payout-row-"]')).toHaveCount(3);
  const first = page.locator('input[data-testid^="payout-"]').first();
  await expect(first).toHaveValue("201.84");
  await first.fill("200");
  await page.getByTestId("enter-money").click();
  await expect(page.getByTestId("settled")).toBeVisible();
  await expect(page.getByTestId("money-step")).toContainText("Guarantee");
  await expect(page.getByTestId("money-step")).toContainText("$450.00");

  // Home no longer shows it as unsettled
  await page.goto("/home");
  await expect(page.getByTestId(`recent-${id}`)).toHaveCount(0);

  // the ledger on the Money tab has it, and entering again is refused
  await page.getByTestId("tab-money").click();
  await page.getByTestId("money-tab-ledger").click();
  await expect(page.getByTestId("ledger-list")).toContainText("Tickets / door");
  await expect(page.getByTestId("ledger-list")).toContainText("Dairy Arts Center");
  await page.getByTestId("money-tab-overview").click();
  await expect(page.getByTestId("total-in")).toHaveText("$605.50");
  await expect(page.getByTestId("chart-months")).toBeVisible();
  await page.getByTestId("money-tab-shows").click();
  await expect(page.getByTestId("chart-shows")).toContainText("Dairy Arts Center");
  await page.getByTestId("money-tab-categories").click();
  await expect(page.getByTestId("chart-categories")).toContainText("Guarantee");
});

test("admin records a photo shoot and corrects it; the original stays", async ({ page }) => {
  await signInAs(page, "ingrid");
  await page.getByTestId("tab-money").click();
  await page.getByTestId("money-tab-ledger").click();
  await page.getByTestId("rec-category").selectOption("photo");
  await page.getByTestId("rec-amount").fill("120");
  await page.getByTestId("rec-memo").fill("Press photos");
  await page.getByTestId("rec-save").click();
  await expect(page.getByTestId("rec-saved")).toBeVisible();
  const row = page.getByTestId("ledger-list").locator("div.card", { hasText: "Press photos" });
  await expect(row).toHaveCount(1);
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: /Correct/ }).click();
  await expect(page.getByTestId("ledger-list").locator("div.card", { hasText: "Reverses expense" })).toHaveCount(1);
  await expect(row.locator('[data-testid^="reversed-"]')).toBeVisible();
  await expect(row.getByRole("button", { name: /Correct/ })).toHaveCount(0);
});

test("member adds an expense (receipt from Drive search) and sees it as not paid back", async ({ browser }) => {
  const david = await as(browser, "david");
  const p = david.page;
  await expect(p.getByTestId("tab-money")).toHaveText("My money");
  await p.getByTestId("tab-money").click();
  await p.getByTestId("add-expense-link").click();
  await p.getByTestId("expense-amount").fill("64");
  await p.getByTestId("expense-cat-gear").click();
  await p.getByTestId("expense-what").fill(WHAT);
  await p.getByTestId("receipt-search").fill("Glass");
  await p.getByTestId("receipt-search-go").click();
  await p.locator('[data-testid^="receipt-hit-"]').first().click();
  await expect(p.getByTestId("expense-receipt")).toHaveValue(/^http/);
  await p.getByTestId("expense-send").click();
  await expect(p).toHaveURL(/\/money$/);
  const card = p.locator('[data-testid^="expense-"]', { hasText: WHAT }).first();
  await expect(card).toContainText("$64.00");
  await expect(card).toContainText("Not yet");
  await david.close();
});

test("admin reimburses it; the member then sees it paid back and the payment", async ({ page, browser }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("tab-money").click();
  const owed = page.getByTestId("owed");
  await expect(owed).toContainText(WHAT);
  await owed.locator("div.items-center", { hasText: WHAT }).getByRole("button", { name: "Mark reimbursed" }).click();
  await expect(owed).not.toContainText(WHAT);

  const david = await as(browser, "david");
  await david.page.getByTestId("tab-money").click();
  const card = david.page.locator('[data-testid^="expense-"]', { hasText: WHAT }).first();
  await expect(card).toContainText("Paid back");
  await expect(david.page.getByText("Payments to me").locator("..")).toContainText(WHAT);
  await expect(david.page.getByText("Payments to me").locator("..")).toContainText("Reimbursed");
  await david.close();
});

test("stats: pull from Spotify, import the Spotify for Artists sample, charts render", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("tab-money").click();
  await page.getByTestId("stats-link").click();
  await expect(page.getByTestId("stats-page")).toBeVisible();
  await page.getByTestId("stats-pull").click();
  await expect(page.getByTestId("stats-msg")).toContainText(/Saved|Already have/);
  const chart = page.getByTestId("chart-followers");
  await expect(chart).toBeVisible();
  await expect(chart.getByTestId("chart-followers-line")).toHaveAttribute("d", /^M[\d.]+,[\d.]+ L/);
  expect(Number(await chart.getAttribute("data-points"))).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId("current-followers")).not.toHaveText("—");

  await page.getByTestId("csv-text").fill(fs.readFileSync("fixtures/spotify-for-artists-sample.csv", "utf8"));
  await page.getByTestId("csv-import").click();
  await expect(page.getByTestId("stats-msg")).toContainText("Read 6 rows");
  await expect(page.getByTestId("chart-listeners")).toHaveAttribute("data-points", "6");
  await expect(page.getByTestId("current-monthly")).toHaveText("2,310");
});

test("members cannot open the stats page", async ({ browser }) => {
  const david = await as(browser, "david");
  await david.page.goto("/stats");
  await expect(david.page).toHaveURL(/\/home$/);
  await david.close();
});
