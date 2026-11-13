import { test, expect } from "@playwright/test";
import { openTab } from "./env";

test("Money's sub-nav: the breakdowns are pages; an admin's tax worksheet splits cash from the rest and takes unassigned income", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-rudy").click();
  await expect(page).toHaveURL(/\/calendar$/);
  await openTab(page, "money");
  const nav = page.getByTestId("money-nav");
  await expect(nav.getByTestId("money-seg-overview")).toHaveAttribute("aria-current", "page");

  await nav.getByTestId("money-seg-years").click();
  await expect(page.getByTestId("years-table")).toContainText("2026");
  await nav.getByTestId("money-seg-people").click();
  await expect(page.getByTestId("people-all")).toContainText("Rudy");

  // Projects is its own page now, with New project on its title line
  await nav.getByTestId("money-seg-projects").click();
  await expect(page.locator(".page-actions").getByTestId("new-project")).toBeVisible();

  await nav.locator('[data-testid^="money-seg-taxes-"]', { hasText: "Rudy" }).click();
  await expect(page).toHaveURL(/\/money\/taxes\/[^/?]+/);
  await page.getByTestId("tax-year").selectOption("2026");
  await expect(page.getByTestId("tax-name")).toHaveText("Rudy");
  // The Creamery guarantee (a check) is Rudy's; the backer pledges came in with nobody down as receiving them.
  // (Earlier specs may have received more as Rudy, so the totals are checked relative to what is there.)
  const cents = async (id: string) => { const t = (await page.getByTestId(id).textContent()) ?? ""; return t === "—" ? 0 : Math.round(Number(t.replace(/[$,]/g, "")) * 100); };
  const line1 = page.getByTestId("tax-line-1");
  await expect(line1.locator('[data-testid^="tax-line-1-income-"]', { hasText: "Creamery Arts Center" })).toHaveCount(1);
  await expect(line1.locator('[data-testid^="tax-line-1-income-"]', { hasText: "Backer pledges" })).toHaveCount(0);
  // Cash is left out by default; Include cash adds it to Line 1, and unticking takes it back out
  await expect(page.getByTestId("tax-cash-off")).toBeVisible();
  const nonCash = await cents("tax-noncash-amount");
  expect(await cents("tax-line-1-amount")).toBe(nonCash);
  await page.getByTestId("tax-include-cash").click();
  await expect(page.getByTestId("tax-include-cash")).toBeChecked();
  await expect(page).toHaveURL(/cash=1/);
  await expect(page.getByTestId("tax-cash-off")).toHaveCount(0);
  expect(await cents("tax-line-1-amount")).toBe((await cents("tax-cash-amount")) + nonCash);
  await page.getByTestId("tax-include-cash").click();
  await expect(page.getByTestId("tax-include-cash")).not.toBeChecked();
  await expect(page).not.toHaveURL(/cash=1/);
  await expect(page.getByTestId("tax-cash-off")).toBeVisible();
  const before = await cents("tax-line-1-amount");
  expect(before).toBe(nonCash);
  const loose = page.getByTestId("tax-unassigned");
  await expect(loose).toContainText("Backer pledges");
  await loose.locator('[data-testid^="tax-assign-"]').first().selectOption({ label: "Rudy" });
  await expect(line1.locator('[data-testid^="tax-line-1-income-"]', { hasText: "Backer pledges" })).toHaveCount(1);
  expect(await cents("tax-line-1-amount")).toBe(before + 40000);
  await expect(loose).toHaveCount(0);
  await expect(page.getByTestId("tax-line-31")).toBeVisible();
});
