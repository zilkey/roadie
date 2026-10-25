import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
async function openShow(page: Page, venue: string) {
  await page.goto(A("/shows"));
  const id = await page.getByTestId("shows-row").filter({ hasText: venue }).first().getAttribute("data-id");
  await page.goto(A(`/shows/${id}`));
  await expect(page.getByTestId("whos-playing")).toBeVisible();
}

test("Saving a changed lineup updates the card, and it can be put back", async ({ page }) => {
  await signInAs(page, "jeff");
  await openShow(page, "Lost Lake Lounge");
  const card = page.getByTestId("whos-playing");
  await expect(card.getByTestId("whos-billed-view")).toContainText("Ingrid Avison Trio (Trio)");
  await expect(card.getByTestId("whos-player-Ingrid")).toContainText("✓ Confirmed");
  await expect(card.getByTestId("whos-player-David")).toContainText("Waiting");
  await card.getByTestId("whos-playing-edit").click();
  await card.getByTestId("whos-pick-Emma").click();
  await card.getByTestId("whos-playing-save").click();
  await expect(card.getByTestId("whos-player-Emma")).toBeVisible();
  await card.getByTestId("whos-playing-edit").click();
  await card.getByTestId("whos-pick-Emma").click();
  await card.getByTestId("whos-playing-save").click();
  await expect(card.getByTestId("whos-player-Emma")).toHaveCount(0);
  await expect(card.getByTestId("whos-player-David")).toBeVisible();
});
