import { test, expect, type Browser } from "@playwright/test";
import { A } from "./env";

async function as(browser: Browser, key: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
  return { page, close: () => ctx.close() };
}

// Stage plots: eight circles wait in the strip, get placed (tap-to-place), labelled and reordered; the admin edits, members read.
test("admin makes a plot, raises inputs, places a circle, labels and reorders rows; it persists; a member reads it", async ({ browser }) => {
  const name = `E2E plot ${Date.now()}`;
  const jeff = await as(browser, "jeff");
  const page = jeff.page;
  await page.goto(A("/stage-plots"));

  // Explicit Add: nothing exists until Add is pressed.
  await page.getByTestId("add-plot").click();
  await page.getByTestId("new-plot-name").fill(name);
  await expect(page.getByTestId("new-plot-inputs")).toHaveValue("8");
  await page.getByTestId("new-plot-add").click();
  await expect(page).toHaveURL(/\/stage-plots\/[^/]+$/);
  const plotUrl = page.url();

  await expect(page.getByTestId("strip-chip")).toHaveCount(8);
  await expect(page.getByTestId("ch-row")).toHaveCount(8);

  // Raise to 10.
  await page.getByTestId("inputs-plus").click();
  await expect(page.getByTestId("ch-row")).toHaveCount(9);
  await page.getByTestId("inputs-count").fill("10");
  await page.getByTestId("inputs-count").press("Enter");
  await expect(page.getByTestId("ch-row")).toHaveCount(10);
  await expect(page.getByTestId("strip-chip")).toHaveCount(10);

  // Tap-to-place: arm circle 1 from the strip, tap the stage; circle 2 is armed next.
  await page.getByTestId("strip-chip").filter({ hasText: /^1$/ }).first().click();
  await page.getByTestId("plot-stage").click({ position: { x: 400, y: 200 } });
  await expect(page.locator('[data-testid="plot-stage"] [data-input-id][data-ch="1"]')).toHaveCount(1);
  await expect(page.getByTestId("strip-chip")).toHaveCount(9);
  await expect(page.getByTestId("strip-chip").first()).toHaveAttribute("aria-pressed", "true");

  // Label rows 1 and 2 (autosaved).
  const row = (n: number) => page.locator(`[data-testid="ch-row"][data-ch="${n}"]`);
  await row(1).getByTestId("ch-source").fill("Kick");
  await row(2).getByTestId("ch-source").fill("Snare");
  await row(2).getByTestId("ch-phantom").check();
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");

  // Reorder: drag row 1 below row 2; Snare becomes channel 1.
  await row(1).evaluate((e) => e.scrollIntoView({ block: "center" })); // both rows on screen: a drag that has to scroll mid-gesture is cancelled
  await row(1).getByTestId("ch-grip").dragTo(row(2));
  await expect(row(1).getByTestId("ch-source")).toHaveValue("Snare");
  await expect(row(2).getByTestId("ch-source")).toHaveValue("Kick");

  // Persisted after a reload.
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  await page.reload();
  await expect(page.getByTestId("ch-row")).toHaveCount(10);
  await expect(row(1).getByTestId("ch-source")).toHaveValue("Snare");
  await expect(row(2).getByTestId("ch-source")).toHaveValue("Kick");
  await expect(row(1).getByTestId("ch-phantom")).toBeChecked();
  await expect(page.locator('[data-testid="plot-stage"] [data-input-id]')).toHaveCount(1);

  // Done goes back to the list, where the plot is listed.
  await page.getByTestId("plot-done").click();
  await expect(page).toHaveURL(/\/stage-plots$/);
  await expect(page.getByTestId("stage-plots-list").getByText(name)).toBeVisible();
  await jeff.close();

  // A member sees the same page read-only.
  const david = await as(browser, "david");
  await david.page.goto(plotUrl);
  await expect(david.page.getByTestId("stage-plot-page")).toBeVisible();
  await expect(david.page.getByTestId("plot-pdf")).toBeVisible();
  await expect(david.page.getByTestId("plot-strip")).toHaveCount(0);
  await expect(david.page.getByTestId("gear-tray")).toHaveCount(0);
  await expect(david.page.getByTestId("inputs-plus")).toHaveCount(0);
  await expect(david.page.getByTestId("ch-source")).toHaveCount(0);
  await expect(david.page.locator('[data-testid="ch-row"][data-ch="1"]')).toContainText("Snare");
  await david.page.goto(A("/stage-plots"));
  await expect(david.page.getByTestId("add-plot")).toHaveCount(0);
  await david.close();
});
