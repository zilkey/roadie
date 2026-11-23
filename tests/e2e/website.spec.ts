import { test, expect, type Page } from "@playwright/test";

// The Website section (docs/designs/sites): the seeded artist's starter site, served by the in-memory fake Hosting. Preview the
// draft, publish to staging, promote, see History, roll back. The release logic itself is in tests/emulator/sites.test.ts.

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

test("preview the draft, publish to staging, promote, roll back", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.getByTestId("band-menu").click();
  await page.getByTestId("band-menu-settings").click();
  await page.getByTestId("settings-nav-website").click();
  await expect(page.getByTestId("page-title")).toHaveText("Website");
  await expect(page.getByTestId("site-live-url")).toHaveText("nora-quill.web.app");

  const frame = page.frameLocator('[data-testid="site-preview"]');
  await expect(frame.locator("h1")).toHaveText("Nora Quill");
  await page.getByTestId("site-page-about").click();
  await expect(frame.locator("h1")).toHaveText("About");

  await page.getByTestId("site-publish-staging").click();
  await expect(page.getByTestId("site-confirm")).toBeVisible();
  await page.getByTestId("site-note").fill("First look");
  await page.getByTestId("site-confirm-go").click();
  await expect(page.getByTestId("site-done")).toContainText("is live on staging");

  await page.getByTestId("site-view-staging").click();
  await expect(frame.locator("h1")).toHaveText("About");

  await page.getByTestId("site-promote").click();
  await page.getByTestId("site-confirm-go").click();
  await expect(page.getByTestId("site-done")).toContainText("is live on the live site");
  await expect(page.getByTestId("site-changes")).toHaveText("Live matches the draft");

  // Publish the draft straight to live once more, so the promote is an earlier live version to roll back to.
  await page.getByTestId("site-publish").click();
  await page.getByTestId("site-confirm-go").click();
  await expect(page.getByTestId("site-done")).toContainText("is live on the live site");

  await page.getByTestId("site-history").click();
  const promote = page.getByTestId("site-versions").locator("li", { hasText: "Promote staging" }).first();
  await expect(promote).toBeVisible();
  await promote.locator('[data-testid^="site-rollback-"]').click();
  await page.getByTestId("site-confirm-go").click();
  await expect(page.getByTestId("site-done")).toContainText("rolls live back");
  await expect(page.getByTestId("site-paused")).toBeVisible();
});
