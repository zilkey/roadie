import { test, expect, type Browser, type Page } from "@playwright/test";
import { A } from "./env";
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

test("member adds an expense (receipt from Drive search) and sees it as owed", async ({ browser }) => {
  const david = await as(browser, "david");
  const p = david.page;
  await expect(p.getByTestId("tab-money")).toHaveText("My money");
  await p.getByTestId("tab-money").click();
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
  const card = p.locator('[data-testid^="expense-"]', { hasText: WHAT }).first();
  await expect(card).toContainText("$64.00");
  await expect(card).toContainText("Owed");
  await david.close();
});

test("admin marks it paid back from Money; the member then sees Paid back and can no longer edit it", async ({ page, browser }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("tab-money").click();
  const owed = page.getByTestId("owed");
  await expect(owed).toContainText(WHAT);
  await owed.locator("div.items-center", { hasText: WHAT }).getByRole("button", { name: "Mark paid back" }).click();
  await expect(owed).not.toContainText(WHAT);

  const david = await as(browser, "david");
  await david.page.getByTestId("tab-money").click();
  const card = david.page.locator('[data-testid^="expense-"]', { hasText: WHAT }).first();
  await expect(card).toContainText("Paid back");
  await expect(card.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await david.close();
});

test("member edits their own unpaid expense", async ({ browser }) => {
  const david = await as(browser, "david");
  const p = david.page;
  const what = `Cables ${Date.now()}`;
  await p.getByTestId("tab-money").click();
  await p.getByTestId("add-expense-link").first().click();
  await p.getByTestId("exp-amount").fill("20");
  await p.getByTestId("expense-what").fill(what);
  await p.getByTestId("exp-save").click();
  await expect(p).toHaveURL(/\/money$/);
  const card = p.locator('[data-testid^="expense-"]', { hasText: what }).first();
  await expect(card).toContainText("$20.00");
  await card.getByRole("button", { name: "Edit" }).click();
  await card.locator('input[data-testid^="expense-edit-amount-"]').fill("25.50");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card).toContainText("$25.50");
  await expect(card).toContainText("Owed");
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
  await david.page.goto(A("/stats"));
  await expect(david.page).toHaveURL(/\/home$/);
  await david.close();
});

test("drafts: a half-entered expense survives a reload and clear with Start over", async ({ browser }) => {
  // a member's expense
  const david = await as(browser, "david");
  const p = david.page;
  await p.getByTestId("tab-money").click();
  await p.getByTestId("add-expense-link").click();
  await p.getByTestId("expense-what").fill("Half typed cables");
  await p.getByTestId("exp-amount").fill("12.50");
  await expect(p.getByTestId("draft-status")).toHaveText("Draft saved");
  await p.reload();
  await expect(p.getByTestId("expense-what")).toHaveValue("Half typed cables");
  await expect(p.getByTestId("exp-amount")).toHaveValue("12.50");
  await expect(p.getByTestId("draft-restored")).toBeVisible();
  await p.goto(A("/home"));
  await expect(p.getByTestId("unfinished")).toContainText("New expense · Half typed cables");
  await p.goBack();
  await p.getByTestId("draft-start-over").click();
  await expect(p.getByTestId("expense-what")).toHaveValue("");
  await expect(p.getByTestId("draft-restored")).toHaveCount(0);
  await david.close();
});
