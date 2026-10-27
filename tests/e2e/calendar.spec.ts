import { test, expect, type Page } from "@playwright/test";
import { A, openTab } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

/**
 * Seeded in scripts/seed.ts: a confirmed show and a pitched Bluebird Room pitch date on 2026-12-12, the Folks deadline on
 * 2026-12-01, and the Folks pitch's next step ("Check for decision") due 2026-12-15.
 */
test("admin sees shows, pitch dates and deadlines, and a day with a show and a pitch date is a conflict", async ({ page }) => {
  await signInAs(page, "jeff");
  await openTab(page, "calendar");
  await expect(page).toHaveURL(/\/calendar/);
  await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();

  await page.goto(A("/calendar?m=2026-12"));
  await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();

  const dec12 = page.getByRole("button", { name: "2026-12-12" });
  await expect(dec12).toContainText("Cervantes' Other Side");
  await expect(dec12).toContainText("Bluebird Room");
  await expect(page.getByRole("button", { name: "2026-12-01" })).toContainText("Folks");

  await dec12.click();
  await expect(page.getByRole("heading", { level: 2, name: "Saturday, December 12, 2026" })).toBeVisible();
  await expect(page.getByTestId("conflict-banner")).toContainText("show + pitch date");

  const dec15 = page.getByRole("button", { name: "2026-12-15" });
  await expect(dec15).toContainText("Next: Rocky Mountain Folks Festival 2027");
  await dec15.click();
  const panel = page.getByTestId("day-panel");
  await expect(panel).toContainText("Next step");
  await expect(panel).toContainText("Check for decision");
  await panel.getByRole("link", { name: /Rocky Mountain Folks Festival 2027/ }).click();
  await expect(page).toHaveURL(/\/booking\/pitches\//);
});

test("a member sees the Calendar nav link, and no Booking filter tab", async ({ page }) => {
  await signInAs(page, "david");
  await expect(page.getByTestId("tab-calendar")).toBeVisible(); // fixed first item: never in More

  await page.goto(A("/calendar?m=2026-12"));
  await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
  // Members get All / Shows / Rehearsals only. The nav's own links are not buttons or tabs, so these match only the page's filter tabs.
  await expect(page.getByRole("tab", { name: "Booking", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Booking", exact: true })).toHaveCount(0);
});
