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

test("Who's playing: a chip saves on tap, picking a lineup fills the players, no Edit", async ({ page }) => {
  await signInAs(page, "jeff");
  await openShow(page, "Lost Lake Lounge");
  const card = page.getByTestId("whos-playing");
  const chip = (name: string) => card.getByTestId(`whos-pick-${name}`);
  await expect(card.getByTestId("whos-playing-edit")).toHaveCount(0);
  await expect(card.getByTestId("whos-billed")).toContainText("Ingrid Avison Trio (Trio)");
  await expect(card.getByTestId("whos-answers")).toContainText(/Asked .*Ingrid.* said yes/);
  await expect(card.getByTestId("whos-answers")).toContainText(/David hasn.t answered/);
  await expect(chip("David")).toHaveAttribute("aria-pressed", "true");
  await expect(chip("Emma")).toHaveAttribute("aria-pressed", "false");

  // Tap a chip: saved, it survives a reload; tap again to put it back.
  await chip("Emma").click();
  await expect(chip("Emma")).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(chip("Emma")).toHaveAttribute("aria-pressed", "true");
  await chip("Emma").click();
  await expect(chip("Emma")).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(chip("Emma")).toHaveAttribute("aria-pressed", "false");
  await expect(chip("David")).toHaveAttribute("aria-pressed", "true");

  // Billed as is a value: picking the Duo lineup fills in its players; back to the Trio puts David back.
  await card.getByTestId("whos-billed").click();
  await card.getByTestId("whos-billed-input").selectOption({ label: "Ingrid Avison Duo (Duo)" });
  await expect(card.getByTestId("whos-billed-saved")).toBeVisible();
  await expect(card.getByTestId("whos-billed")).toContainText("Ingrid Avison Duo (Duo)");
  await expect(chip("David")).toHaveAttribute("aria-pressed", "false");
  await expect(chip("Jeff")).toHaveAttribute("aria-pressed", "true");
  await card.getByTestId("whos-billed").click();
  await card.getByTestId("whos-billed-input").selectOption({ label: "Ingrid Avison Trio (Trio)" });
  await expect(card.getByTestId("whos-billed")).toContainText("Ingrid Avison Trio (Trio)");
  await expect(chip("David")).toHaveAttribute("aria-pressed", "true");
});

test("Who's playing: a member sees the players as names, nothing to tap", async ({ page }) => {
  await signInAs(page, "david");
  await openShow(page, "Lost Lake Lounge");
  const card = page.getByTestId("whos-playing");
  await expect(card.getByTestId("whos-player-Ingrid")).toBeVisible();
  await expect(card.getByTestId("whos-player-David")).toBeVisible();
  await expect(card.getByTestId("whos-billed")).toHaveText("Ingrid Avison Trio (Trio)");
  // No chips, no values to tap, no Ask (David's own "Can you play?" answer buttons are his, not the card's).
  await expect(card.locator(".pick, .val")).toHaveCount(0);
  await expect(card.getByTestId("whos-playing-ask")).toHaveCount(0);
});
