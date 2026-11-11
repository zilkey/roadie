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
  await signInAs(page, "rudy");
  await openShow(page, "Pine Hollow Lounge");
  const card = page.getByTestId("whos-playing");
  const chip = (name: string) => card.getByTestId(`whos-pick-${name}`);
  await expect(card.getByTestId("whos-playing-edit")).toHaveCount(0);
  await expect(card.getByTestId("whos-billed")).toContainText("Nora Quill Trio (Trio)");
  await expect(card.getByTestId("whos-answers")).toContainText(/Asked .*Nora.* said yes/);
  await expect(card.getByTestId("whos-answers")).toContainText(/Hugo hasn.t answered/);
  await expect(chip("Hugo")).toHaveAttribute("aria-pressed", "true");
  await expect(chip("Iris")).toHaveAttribute("aria-pressed", "false");

  // Tap a chip: saved, it survives a reload; tap again to put it back.
  await chip("Iris").click();
  await expect(chip("Iris")).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(chip("Iris")).toHaveAttribute("aria-pressed", "true");
  await chip("Iris").click();
  await expect(chip("Iris")).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(chip("Iris")).toHaveAttribute("aria-pressed", "false");
  await expect(chip("Hugo")).toHaveAttribute("aria-pressed", "true");

  // Billed as is a value: picking the Duo lineup fills in its players; back to the Trio puts Hugo back.
  await card.getByTestId("whos-billed").click();
  await card.getByTestId("whos-billed-input").selectOption({ label: "Nora Quill Duo (Duo)" });
  await expect(card.getByTestId("whos-billed-saved")).toBeVisible();
  await expect(card.getByTestId("whos-billed")).toContainText("Nora Quill Duo (Duo)");
  await expect(chip("Hugo")).toHaveAttribute("aria-pressed", "false");
  await expect(chip("Rudy")).toHaveAttribute("aria-pressed", "true");
  await card.getByTestId("whos-billed").click();
  await card.getByTestId("whos-billed-input").selectOption({ label: "Nora Quill Trio (Trio)" });
  await expect(card.getByTestId("whos-billed")).toContainText("Nora Quill Trio (Trio)");
  await expect(chip("Hugo")).toHaveAttribute("aria-pressed", "true");
});

test("Who's playing: a member sees the players as names, nothing to tap", async ({ page }) => {
  await signInAs(page, "hugo");
  await openShow(page, "Pine Hollow Lounge");
  const card = page.getByTestId("whos-playing");
  await expect(card.getByTestId("whos-player-Nora")).toBeVisible();
  await expect(card.getByTestId("whos-player-Hugo")).toBeVisible();
  await expect(card.getByTestId("whos-billed")).toHaveText("Nora Quill Trio (Trio)");
  // No chips, no values to tap, no Ask (Hugo's own "Can you play?" answer buttons are his, not the card's).
  await expect(card.locator(".pick, .val")).toHaveCount(0);
  await expect(card.getByTestId("whos-playing-ask")).toHaveCount(0);
});
