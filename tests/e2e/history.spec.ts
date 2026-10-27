import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
const STAMP = Date.now();

test("undo from the History page for an app change restores the earlier value", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await signInAs(page, "jeff");
  await page.getByTestId("tab-booking").click();
  // add a venue through the app so the run is a plain app run
  const name = `Undo Me ${STAMP}`;
  await page.getByTestId("booking-add-actions").click();
  await page.getByTestId("add-venue").click();
  await page.getByTestId("new-venue-name").fill(name);
  await page.getByTestId("new-venue-city").fill("Boulder");
  await page.getByTestId("new-venue-submit").click();
  // creating a venue opens it; wait for that instead of racing the navigation with a search on /booking
  await expect(page).toHaveURL(/\/booking\/venues\/[^/]+$/);
  await expect(page.getByTestId("page-title")).toHaveText(name);

  await page.getByTestId("band-menu").click(); // Artist settings lives in the band menu; Activity is in its sub-nav
  await page.getByTestId("band-menu-settings").click();
  await page.getByTestId("settings-nav-activity").click();
  await page.getByTestId("filter-via").selectOption("app");
  await page.getByTestId("filter-entity").fill("venues");
  const row = page.locator('[data-testid="history-row"]', { hasText: "create" }).first();
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-kind", "venues");
  await row.getByTestId("pick-run").click();
  await expect(page.getByTestId("run-card")).toContainText("1 change");
  await expect(page.getByTestId("undo-run")).toHaveText("Undo this run");
  await page.getByTestId("undo-run").click();
  await expect(page.getByTestId("undo-counts")).toContainText("put back");
  // the reversal is a new entry in the new record's own history, found by the same listener
  await page.getByRole("button", { name: "Show this undo" }).click();
  await expect(page.locator('[data-testid="history-row"][data-op="delete"][data-kind="venues"]')).toHaveCount(1);

  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-venues").click();
  await page.getByTestId("booking-search").fill(name);
  await expect(page.getByTestId(/^row-venue-/)).toHaveCount(0);
});
