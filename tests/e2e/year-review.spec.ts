import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";
import { TODAY } from "./dates";
import { reviewSeason } from "../../src/lib/yearReview";

// Year in Review: story slides of the band's year at /review, for admins, with a banner above the Calendar from November
// through January. The seed's 2026 is fixed: one played show (Creamery Arts Center, Oct 10, 112 paid), two October
// rehearsals and $850 received ($450 guarantee + $400 crowdfunding).

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
const slide = (page: Page, key: string) => page.locator(`[data-testid="review-slide"][data-slide="${key}"]`);

test("an admin plays 2026: full screen, one stat per slide, through to the summary and back out", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); // no auto-advance, numbers don't count up
  await signInAs(page, "rudy");
  await page.goto(A("/review?y=2026"));

  await expect(slide(page, "intro")).toContainText("Nora Quill Band");
  await expect(slide(page, "intro")).toContainText("2026");
  // No app shell: the review owns the screen.
  await expect(page.getByTestId("more-toggle")).toHaveCount(0);
  await expect(page.getByTestId("review-year")).toHaveValue("2026");
  await expect(page.getByTestId("review-prev")).toBeDisabled();

  await page.getByTestId("review-next").click();
  await expect(slide(page, "shows")).toContainText("You played");
  await expect(slide(page, "shows")).toContainText("1 city");
  await expect(slide(page, "shows")).toContainText("October was the busiest: 1 show.");

  // Walk every slide to the end; the ones the seed has data for all turn up, in order.
  const seen: string[] = ["intro", "shows"];
  for (let n = 0; n < 20; n++) {
    const key = await page.getByTestId("review-slide").getAttribute("data-slide");
    if (key && seen[seen.length - 1] !== key) seen.push(key);
    if (key === "crowd") await expect(slide(page, "crowd")).toContainText("112");
    if (key === "money") await expect(page.getByTestId("review-money-in")).toHaveText("$850");
    if (key === "summary") break;
    await page.keyboard.press("ArrowRight");
  }
  for (const key of ["rehearsals", "crowd", "money", "lineups", "summary"]) expect(seen).toContain(key);
  expect(seen.indexOf("money")).toBeGreaterThan(seen.indexOf("shows"));
  // The seed has nothing in 2025, so nothing is compared: no "vs" chips and no head-to-head slide.
  expect(seen).not.toContain("versus");
  await expect(page.getByTestId("review-vs")).toHaveCount(0);

  await expect(page.getByTestId("review-tiles")).toContainText("$850");
  await expect(page.getByTestId("review-next")).toBeDisabled();
  await page.keyboard.press("ArrowLeft");
  await expect(slide(page, "summary")).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await page.getByTestId("review-again").click();
  await expect(slide(page, "intro")).toBeVisible();

  await page.getByTestId("review-close").click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByTestId("more-toggle")).toBeVisible();
});

test("it fits a phone: no sideways scroll, and a tap on the right goes on", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAs(page, "rudy");
  await page.goto(A("/review?y=2026"));
  await expect(slide(page, "intro")).toBeVisible();
  await page.mouse.click(300, 400);
  await expect(slide(page, "shows")).toBeVisible();
  await page.mouse.click(40, 400);
  await expect(slide(page, "intro")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the Calendar banner shows for admins from November through January", async ({ page }) => {
  const year = reviewSeason(TODAY);
  await signInAs(page, "rudy");
  await expect(page.getByTestId("calendar-page")).toBeVisible();
  await expect(page.getByTestId("calendar-month")).toBeVisible();
  if (!year) {
    await expect(page.getByTestId("review-banner")).toHaveCount(0);
    return;
  }
  await expect(page.getByTestId("review-banner")).toContainText(`Your ${year} in review`);
  await page.getByTestId("review-banner").click();
  await expect(page).toHaveURL(new RegExp(`/review\\?y=${year}$`));
  await expect(page.getByTestId("review-page")).toBeVisible();
});

test("a band member sees no banner and can't open the review", async ({ page }) => {
  await signInAs(page, "hugo");
  await expect(page.getByTestId("calendar-page")).toBeVisible();
  await expect(page.getByTestId("calendar-month")).toBeVisible();
  await expect(page.getByTestId("review-banner")).toHaveCount(0);
  await page.goto(A("/review?y=2026"));
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByTestId("review-page")).toHaveCount(0);
});
