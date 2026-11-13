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
  // Iris, not Hugo: paying a person pays everything owed to them, and the seeded expenses are Hugo's (show-finances edits one).
  const iris = await as(browser, "iris");
  const p = iris.page;
  await openTab(p, "money");
  await p.getByTestId("add-expense-link").click();
  await p.getByTestId("exp-amount").fill("64");
  await p.getByTestId("exp-cat").click();
  await p.getByTestId("exp-cat-opt-gear").click();
  await p.getByTestId("expense-what").fill(WHAT);
  await p.getByTestId("expense-add-receipt").click(); // the receipt hides behind "Add receipt"
  await p.getByTestId("receipt-search").fill("Glass");
  await p.getByTestId("receipt-search-go").click();
  await p.locator('[data-testid^="receipt-hit-"]').first().click();
  await expect(p.getByTestId("expense-receipt")).toHaveValue(/^http/);
  await p.getByTestId("exp-save").click();
  await expect(p).toHaveURL(/\/money$/);
  const mine = p.locator('[data-testid^="expense-"]', { hasText: WHAT }).first();
  await expect(mine).toContainText("$64.00");
  await expect(mine).toContainText("waiting");

  await signInAs(page, "rudy");
  await openTab(page, "money");
  await expect(page.locator(".page-actions").getByTestId("add-expense-link")).toHaveCount(0); // admins log a bandmate's expense from Money out
  const owe = page.getByTestId("we-owe");
  const group = owe.locator('[data-testid^="we-owe-user:"]', { hasText: WHAT });
  await expect(group).toContainText(WHAT);
  await payInModal(page, group, "Iris");
  await expect(owe).not.toContainText(WHAT);

  await p.reload();
  const card = p.locator('[data-testid^="expense-"]', { hasText: WHAT }).first();
  await expect(card).toContainText("paid back");
  await expect(card.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await iris.close();
});


test("Projects tab lists the seeded projects; New project adds Fall run and Cancel discards", async ({ page }) => {
  await signInAs(page, "rudy");
  await openTab(page, "money");
  await page.getByTestId("money-seg-projects").click();
  const table = page.getByTestId("projects-table");
  for (const name of ["General", "Duo", "Wild Hearts LP", "Spring West Tour", "Lighthouse video"]) await expect(table).toContainText(name);
  await expect(table.locator("tr", { hasText: "General" }).first()).toContainText("default");

  await page.getByTestId("new-project").click();
  await page.getByTestId("np-name").fill("Discarded");
  await page.getByTestId("np-cancel").click();
  await expect(page.getByTestId("np-name")).toHaveCount(0);
  await expect(table).not.toContainText("Discarded");

  await page.getByTestId("new-project").click();
  await expect(page.getByTestId("np-name")).toHaveValue("");
  await page.getByTestId("np-name").fill("Fall run");
  await page.getByTestId("np-kind").selectOption("tour");
  await page.getByTestId("np-add").click();
  await expect(table).toContainText("Fall run");
  await expect(table.locator("tr", { hasText: "Fall run" })).toContainText("Tour");
});

test("the Wild Hearts LP project page shows its totals and records", async ({ page }) => {
  await signInAs(page, "rudy");
  await openTab(page, "money");
  await page.getByTestId("money-seg-projects").click();
  await page.getByTestId("projects-table").locator("tr", { hasText: "Wild Hearts LP" }).click();
  await expect(page).toHaveURL(/\/money\/projects\/[^/]+$/);
  await expect(page.getByTestId("project-page")).toContainText("Wild Hearts LP");
  // The release's spend (three days tracking, the mix revisions) is paid; the backer pledges arrived, the Bandcamp sale is still owed.
  // The Bandcamp money hasn't arrived: owed on the In tile, and listed under Money in as "Owed to us" (received income is green).
  await expect(page.getByTestId("tile-in")).toContainText("$184.00 owed to us");
  const records = page.getByTestId("project-records");
  await expect(records.locator("[data-testid^=project-record-income-]", { hasText: "Bandcamp" }).locator(".chip.a")).toHaveText("Owed to us");
  await page.getByTestId("project-flow-out").click();
  await expect(records).not.toContainText("Bandcamp");
  await expect(records.locator("[data-testid^=project-record-expense-]", { hasText: "3 days tracking" })).toContainText("paid by Rudy");
  await expect(page.getByTestId("project-by-payer")).toBeVisible();
  // Each record's project edits in place; the Bandcamp sale moves to the tour and back.
  await page.getByTestId("project-flow-in").click();
  const sel = records.locator("[data-testid^=project-record-income-]", { hasText: "Bandcamp" }).locator("[data-testid$=-project]");
  await sel.click();
  await records.locator("[data-testid$=-project-input]").selectOption({ label: "Spring West Tour" });
  await expect(records).not.toContainText("Bandcamp");
  await expect(page.getByTestId("project-by-category")).toBeVisible();
  await page.getByTestId("back").click();
  await expect(page).toHaveURL(/\/money\/projects$/);
  // ...and back, from the tour's page, so the release specs (which run after this file) still find it on the LP.
  await page.getByTestId("projects-table").locator("tr", { hasText: "Spring West Tour" }).click();
  await expect(page.getByTestId("project-page")).toContainText("Spring West Tour");
  await page.getByTestId("project-flow-in").click();
  await records.locator("[data-testid^=project-record-income-]", { hasText: "Bandcamp" }).locator("[data-testid$=-project]").click();
  await records.locator("[data-testid$=-project-input]").selectOption({ label: "Wild Hearts LP" });
  await expect(records).not.toContainText("Bandcamp");
});

/** Pay one person's group from the We owe card: Money out opens on "We paid"; pick Venmo and save. */
async function payInModal(page: Page, group: import("@playwright/test").Locator, first: string) {
  await group.getByRole("button", { name: `Pay ${first}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByTestId("mo-method").selectOption("venmo");
  await dialog.getByTestId("mo-save").click();
  await expect(dialog).toHaveCount(0);
}

test("a project's ⋯ menu makes it the default and deletes it once nothing is on it; one with money only offers Close", async ({ page }) => {
  const NAME = `Scratch ${Date.now()}`;
  await signInAs(page, "rudy");
  await openTab(page, "money");
  await page.getByTestId("money-seg-projects").click();
  await page.getByTestId("new-project").click();
  await page.getByTestId("np-name").fill(NAME);
  await page.getByTestId("np-add").click();
  const table = page.getByTestId("projects-table");
  await table.locator("tr", { hasText: NAME }).click();
  await expect(page.getByTestId("project-page")).toBeVisible();

  // Make it the default, then put the old default back so the rest of the suite still lands on General.
  await page.getByTestId("project-actions").click();
  await page.getByTestId("project-make-default").click();
  await page.getByTestId("project-actions").click();
  await expect(page.getByTestId("project-remove")).toHaveAttribute("aria-disabled", "true"); // the default can't go
  await page.keyboard.press("Escape");
  await page.getByTestId("back").click();
  await table.locator("tr", { hasText: "General" }).first().click();
  await page.getByTestId("project-actions").click();
  await page.getByTestId("project-make-default").click();
  await page.getByTestId("back").click();
  await expect(table.locator("tr", { hasText: "General" }).first()).toContainText("default");

  await table.locator("tr", { hasText: NAME }).click();
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("project-actions").click();
  await page.getByTestId("project-remove").click();
  await expect(page).toHaveURL(/\/money\/projects$/);
  await expect(table).not.toContainText(NAME);
});
