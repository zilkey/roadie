import { test, expect } from "@playwright/test";
import { A } from "./env";

test("Finances tab: seeded income, project select and Net; the seeded expense is a Money out line", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-jeff").click();
  await expect(page).toHaveURL(/\/calendar$/);

  // The seeded played show (Dairy Arts Center): only the date cell links.
  await page.goto(A("/shows#played"));
  await page.getByTestId("shows-table-played").getByTestId("shows-row").filter({ hasText: "Dairy Arts Center" }).first().locator("td.date a").click();
  await expect(page).toHaveURL(/\/shows\/[^/?]+/);
  await page.getByTestId("show-tab-finances").click();

  // Money in: admin-only; the seeded show has a received $450 guarantee (an income doc), no starter box
  const income = page.getByTestId("income");
  await expect(income).toBeVisible();
  await expect(income.getByTestId("admin-only")).toBeVisible();
  const guarantee = income.locator('[data-testid^="income-row-"]');
  await expect(guarantee).toHaveCount(1);
  await expect(guarantee).toContainText("Guarantee");
  await expect(guarantee).toContainText("$450.00");
  await expect(guarantee).toContainText("Received");
  await expect(income.getByTestId("money-in-open")).toBeVisible();
  await expect(page.getByTestId("show-project")).toBeVisible();
  await expect(page.getByTestId("paid-out").locator('[data-testid^="payout-row-"]')).toContainText("David");

  // Net: follows the show's project
  await expect(page.getByTestId("net-card")).toBeVisible();
  await expect(page.getByTestId("net-in")).toHaveText("$450.00");
  await page.getByTestId("show-project").selectOption({ label: "Duo" });
  await expect(page.getByTestId("net-card")).toContainText("Net to Duo");

  // Admins have no Expenses card: the seeded expense is a line in Money out, still owed back, and can't be edited here
  await expect(page.getByTestId("expenses")).toHaveCount(0);
  const out = page.getByTestId("paid-out");
  const row = out.locator('[data-testid^="expense-row-"]').filter({ hasText: "Bass strings and cables" });
  await expect(row).toBeVisible();
  await expect(row.locator('[data-testid^="expense-status-"]')).toContainText("owed back");
  await expect(row.locator('[data-testid^="expense-paid-back-"]')).toBeVisible();
  await expect(row.getByTestId("expense-what")).toHaveCount(0);
  await expect(page.getByTestId("net-card")).toBeVisible();
});

test("Finances tab: a member edits their own expense in place; the full form opens for the show and returns to it on Save", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-david").click();
  await expect(page).toHaveURL(/\/calendar$/);

  await page.goto(A("/shows#played"));
  await page.getByTestId("shows-table-played").getByTestId("shows-row").filter({ hasText: "Dairy Arts Center" }).first().locator("td.date a").click();
  await expect(page).toHaveURL(/\/shows\/[^/?]+/);
  await page.getByTestId("show-tab-finances").click();

  // David's seeded expense, edited in place to fix its amount
  const card = page.getByTestId("expenses");
  await expect(card.getByText("Bass strings and cables")).toBeVisible();
  await page.getByTestId("expenses-edit").click();
  await expect(card.getByTestId("expenses-add-line")).toHaveCount(0);
  const line = page.getByTestId("expense-line-0");
  await line.getByTestId("expense-what").fill("Bass strings, cables and gas");
  await line.getByTestId("expense-amount").fill("60.90");
  await page.getByTestId("expenses-save").click();
  await expect(card.getByText("Bass strings, cables and gas")).toBeVisible();
  await expect(page.getByTestId("expenses-total")).toHaveText("$60.90");

  await card.getByTestId("expenses-full-form").click();
  await expect(page).toHaveURL(/\/money\/expense\?show=/);
  await expect(page.getByTestId("exp-cat")).toHaveValue("Gas"); // from a show, gas is the default
  await page.getByTestId("exp-amount").fill("18");
  await page.getByTestId("expense-what").fill("Parking garage");
  await page.getByTestId("exp-save").click();

  await expect(page).toHaveURL(/\/shows\/[^/?]+\?tab=finances$/);
  await expect(page.getByTestId("expenses").getByTestId("expense-row").filter({ hasText: "Parking garage" })).toBeVisible();
});

async function openShow(page: import("@playwright/test").Page, key: string, tab: "played" | "upcoming", venue: string) {
  await page.goto("/signin");
  await page.getByTestId(key).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await page.goto(A(`/shows#${tab}`));
  await page.getByTestId(`shows-table-${tab}`).getByTestId("shows-row").filter({ hasText: venue }).first().locator("td.date a").click();
  await expect(page).toHaveURL(/\/shows\/[^/?]+/);
  await page.getByTestId("show-tab-finances").click();
}

test("Finances tab: mark an owed payout paid", async ({ page }) => {
  await openShow(page, "dev-jeff", "upcoming", "Hi-Dive");
  const owed = page.getByTestId("paid-out").locator('[data-testid^="payout-row-"]').filter({ hasText: "The Moonlighters" });
  await expect(owed).toContainText("We owe");
  await owed.locator('[data-testid^="payout-mark-paid-"]').click();
  // Mark paid opens the Money out modal's mark-paid form (who paid, when, how)
  await expect(page.getByTestId("mark-paid-form")).toBeVisible();
  await page.getByTestId("mp-method").selectOption("venmo");
  await page.getByTestId("mp-save").click();
  await expect(page.getByTestId("mark-paid-form")).toBeHidden();
  await expect(owed).toContainText("We paid");
  await expect(owed).toContainText("Paid");
  await expect(owed.locator('[data-testid^="payout-mark-paid-"]')).toHaveCount(0);
});

test("Finances tab: Split evenly proposes one row per player without pay, Add payouts creates them; Money in opens its modal", async ({ page }) => {
  await openShow(page, "dev-jeff", "played", "Dairy Arts Center");
  const card = page.getByTestId("paid-out");
  // Other specs run in parallel against this database and may add payouts on this show, so compare row ids, not counts.
  const rowIds = () => card.locator('[data-testid^="payout-row-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!));
  const before = new Set(await rowIds());
  const addedSince = async () => (await rowIds()).filter((id) => !before.has(id));
  await card.getByTestId("split-evenly").click();
  const proposed = card.getByTestId("split-row");
  const n = await proposed.count();
  const proposedNames = await proposed.locator("b").allInnerTexts();
  expect(n).toBeGreaterThan(0);
  await expect(proposed.filter({ hasText: "David" })).toHaveCount(0); // David already has pay on this show
  await card.getByTestId("split-cancel").click();
  await expect(card.getByTestId("split-plan")).toHaveCount(0);
  // Cancel added nothing of its own: no row for any proposed player (others' rows may have arrived meanwhile).
  for (const name of proposedNames) {
    for (const id of await addedSince()) await expect(card.getByTestId(id)).not.toContainText(name);
  }

  await card.getByTestId("split-evenly").click();
  await card.getByTestId("split-add").click();
  await expect.poll(async () => (await addedSince()).length).toBeGreaterThanOrEqual(n);
  await expect(card.getByTestId("split-plan")).toHaveCount(0);

  await page.getByTestId("money-in-open").click();
  await expect(page.getByTestId("money-in-modal")).toBeVisible();
});

test("Finances tab: a member sees Expenses only", async ({ page }) => {
  await openShow(page, "dev-david", "played", "Dairy Arts Center");
  await expect(page.getByTestId("expenses")).toBeVisible();
  for (const t of ["show-project", "income", "paid-out", "net-card"]) await expect(page.getByTestId(t)).toHaveCount(0);
});

test("Finances tab: an admin opens a Money out line, the amount autosaves, Done closes and the card shows it", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-jeff").click();
  await expect(page).toHaveURL(/\/calendar$/);
  await page.goto(A("/shows#played"));
  await page.getByTestId("shows-table-played").getByTestId("shows-row").filter({ hasText: "Dairy Arts Center" }).first().locator("td.date a").click();
  await page.getByTestId("show-tab-finances").click();

  const out = page.getByTestId("paid-out");
  const row = out.locator('[data-testid^="expense-row-"]').filter({ hasText: "Bass strings" });
  await row.click();
  const modal = page.getByTestId("money-out-modal");
  await expect(modal.getByTestId("money-out-edit")).toBeVisible();
  await expect(modal.getByTestId("mo-what")).toHaveValue(/^Bass strings/);
  await modal.getByTestId("mo-amount").fill("77.25");
  await modal.getByTestId("mo-what").focus(); // leaving the box saves it
  await expect(modal.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  await modal.getByTestId("mo-done").click();
  await expect(modal).not.toBeVisible();
  await expect(row).toContainText("$77.25");
  // The Mark paid back button on the line still works without opening the modal
  await row.locator('[data-testid^="expense-paid-back-"]').click();
  await expect(modal).not.toBeVisible();
  await expect(row.locator('[data-testid^="expense-status-"]')).toContainText("paid back");
  // A paid-back expense opens read-only
  await row.click();
  await expect(modal.getByTestId("mo-locked")).toContainText("so it can't be changed");
  await expect(modal.getByTestId("mo-amount")).toBeDisabled();
});
