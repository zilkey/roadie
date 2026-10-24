import { test, expect, type Browser, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
}

/** Opens the seeded Lost Lake Lounge show (starts on Hold) from the shows list. */
async function openLostLake(page: Page) {
  await page.goto(A("/shows"));
  await page.getByText("Lost Lake Lounge").first().click();
  await expect(page.getByTestId("show-page")).toBeVisible();
}

test("an admin changes a show's status with a reason, and it can be put back", async ({ page }) => {
  await signInAs(page, "jeff");
  await openLostLake(page);
  const pill = page.getByTestId("show-status");
  await expect(pill).toHaveAttribute("aria-label", "Change status, currently Hold");
  await expect(pill).toHaveAttribute("aria-expanded", "false");

  // Escape closes the menu
  await pill.click();
  await expect(pill).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("dialog", { name: "Change status" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("status-menu")).toHaveCount(0);

  // outside click closes it too
  await pill.click();
  await expect(page.getByTestId("status-menu")).toBeVisible();
  await page.getByTestId("page-title").click();
  await expect(page.getByTestId("status-menu")).toHaveCount(0);

  // Confirmed takes no reason: the box is hidden
  await pill.click();
  await page.getByTestId("status-opt-confirmed").check();
  await expect(page.getByTestId("status-reason")).toHaveCount(0);

  // Hold -> Canceled with a reason
  await page.getByTestId("status-opt-canceled").check();
  await page.getByTestId("status-reason").fill("Venue double-booked the room.");
  await page.getByTestId("status-save").click();
  await expect(page.getByTestId("status-menu")).toHaveCount(0);
  await expect(pill).toHaveAttribute("aria-label", "Change status, currently Canceled");
  await expect(page.getByTestId("show-reason")).toHaveText("Venue double-booked the room.");

  // put it back so other specs see the seeded Hold
  await pill.click();
  await page.getByTestId("status-opt-hold").check();
  await page.getByTestId("status-save").click();
  await expect(pill).toHaveAttribute("aria-label", "Change status, currently Hold");
  await expect(page.getByTestId("show-reason")).toHaveCount(0);
});

test("a member sees a plain pill with no menu", async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInAs(page, "david");
  await openLostLake(page);
  const pill = page.getByTestId("show-status");
  await expect(pill).toHaveText("Hold");
  await expect(page.getByRole("button", { name: /Change status/ })).toHaveCount(0);
  await ctx.close();
});
