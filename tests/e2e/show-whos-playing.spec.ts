import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
}
async function openShow(page: Page, venue: string) {
  await page.goto(A("/shows"));
  const id = await page.getByTestId("shows-row").filter({ hasText: venue }).first().getAttribute("data-id");
  await page.goto(A(`/shows/${id}`));
  await expect(page.getByTestId("whos-playing")).toBeVisible();
}

test("Who's playing shows the billing, the players and their answers to the ask", async ({ page }) => {
  await signInAs(page, "jeff");
  await openShow(page, "Lost Lake Lounge");
  const card = page.getByTestId("whos-playing");
  await expect(card.getByTestId("whos-billed-view")).toContainText("Ingrid Avison Trio (Trio)");
  await expect(card.getByTestId("whos-player-Ingrid")).toContainText("✓ Confirmed");
  await expect(card.getByTestId("whos-player-David")).toContainText("Waiting");
});

test("Members see the lineup but no Edit button", async ({ page }) => {
  await signInAs(page, "eric");
  await openShow(page, "Hi-Dive");
  const card = page.getByTestId("whos-playing");
  await expect(card.getByTestId("whos-player-Eric")).toBeVisible();
  await expect(card.getByTestId("whos-playing-edit")).toHaveCount(0);
});

test("Picking a configuration fills the players; Cancel changes nothing", async ({ page }) => {
  await signInAs(page, "jeff");
  await openShow(page, "Hi-Dive");
  const card = page.getByTestId("whos-playing");
  await expect(card.getByTestId("whos-player-Emma")).toBeVisible();
  await card.getByTestId("whos-playing-edit").click();
  await card.getByTestId("whos-billed").selectOption({ label: "Ingrid Avison Duo (Duo)" });
  await expect(card).toContainText("Filled in from the Duo lineup. Tap anyone to change.");
  await expect(card.getByTestId("whos-pick-Ingrid")).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByTestId("whos-pick-Emma")).toHaveAttribute("aria-pressed", "false");
  await card.getByTestId("whos-playing-cancel").click();
  await expect(card.getByTestId("whos-player-Emma")).toBeVisible();
  await expect(card.getByTestId("whos-billed-view")).toContainText("Ingrid Avison Band (Full band)");
});

test("Saving a changed lineup updates the card, and it can be put back", async ({ page }) => {
  await signInAs(page, "jeff");
  await openShow(page, "Lost Lake Lounge");
  const card = page.getByTestId("whos-playing");
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

test("Ask who's free from the edit form opens the ask", async ({ page }) => {
  await signInAs(page, "jeff");
  await openShow(page, "Lost Lake Lounge");
  const card = page.getByTestId("whos-playing");
  await card.getByTestId("whos-playing-edit").click();
  await card.getByTestId("whos-playing-ask").click();
  await expect(card.getByTestId("ask-form")).toBeVisible();
});
