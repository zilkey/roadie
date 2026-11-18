import { test, expect, type Browser, type Page } from "@playwright/test";
import { A, openTab } from "./env";

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

const WHAT = `Cables ${Date.now()}`;

test("an admin limits a member to one project; the member sees no Project field and the expense lands there", async ({ browser }) => {
  const rudy = await as(browser, "rudy");
  const a = rudy.page;
  await a.goto(A("/admin/money"));
  const felixRow = a.locator('[data-testid^="expense-project-row-"]', { hasText: "Felix" });
  const chips = felixRow.locator('[data-testid^="visible-projects-"]');
  await expect(chips).toBeVisible();
  // Start from no limit, so a retry after a failed run doesn't toggle the chip back off.
  const all = chips.getByRole("button", { name: "All projects" });
  if ((await all.getAttribute("aria-pressed")) !== "true") await all.click();
  await expect(all).toHaveAttribute("aria-pressed", "true");
  const tour = chips.getByRole("button", { name: "Spring West Tour" });
  await tour.click();
  await expect(tour).toHaveAttribute("aria-pressed", "true");
  await expect(chips.getByRole("button", { name: "All projects" })).toHaveAttribute("aria-pressed", "false");

  const felix = await as(browser, "felix");
  const p = felix.page;
  await openTab(p, "money");
  await p.getByTestId("add-expense-link").click();
  await expect(p.getByTestId("add-expense")).toBeVisible();
  await expect(p.getByTestId("exp-project")).toHaveCount(0);
  await p.getByTestId("exp-amount").fill("12");
  await p.getByTestId("expense-what").fill(WHAT);
  await p.getByTestId("exp-save").click();
  await expect(p).toHaveURL(/\/money$/);
  await expect(p.getByTestId("my-money-table").locator('[data-testid^="my-money-row-"]', { hasText: WHAT })).toContainText("Spring West Tour");

  // Put Felix back on every project.
  await chips.getByRole("button", { name: "All projects" }).click();
  await expect(chips.getByRole("button", { name: "All projects" })).toHaveAttribute("aria-pressed", "true");
  await felix.close();
  await rudy.close();
});
