import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function openShow(page: Page, venue: string, date: string) {
  await page.goto("/signin");
  await page.getByTestId("dev-jeff").click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto(A("/shows"));
  await page.getByTestId("shows-row").filter({ hasText: venue }).filter({ hasText: date }).first().locator("td.date a").click();
  await expect(page.getByTestId("sound")).toBeVisible();
}

test("Sound and Promotion cards edit and save on a private hold", async ({ page }) => {
  await openShow(page, "Lost Lake Lounge", "Jan 16");

  // Sound: one card, no Edit. The toggle saves at once; notes save when you leave the box, and clicking them edits again.
  const sound = page.getByTestId("sound");
  await expect(sound.getByTestId("sound-edit")).toHaveCount(0);
  await sound.getByTestId("sound-bandProvided").click();
  await expect(sound.getByTestId("sound-bandProvided")).toBeChecked();
  await page.reload();
  await expect(page.getByTestId("sound-bandProvided")).toBeChecked();
  await page.getByTestId("sound-add-notes").click();
  await page.getByTestId("sound-notes").fill("We run our own PA.\nBring the long snake.");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("sound-notes")).toHaveCount(0);
  await expect(page.getByTestId("sound-notes-view")).toContainText("Bring the long snake.");
  await page.getByTestId("sound-notes-view").click();
  await expect(page.getByTestId("sound-notes")).toHaveValue("We run our own PA.\nBring the long snake.");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("sound-notes-view")).toBeVisible();

  // Promotion: private show with docs and a ticket link
  await expect(page.getByTestId("ticket-none")).toHaveText("No ticket link yet");
  await page.getByTestId("promotion-edit").click();
  await page.getByTestId("ticket-url").fill("https://tickets.example.com/lost-lake");
  await page.getByTestId("doc-title").fill("Stage plot");
  await page.getByTestId("doc-url").fill("https://example.com/stage-plot.pdf");
  await page.getByTestId("doc-add").click();
  await page.getByTestId("promotion-save").click();
  await expect(page.getByTestId("ticket-link")).toHaveAttribute("href", "https://tickets.example.com/lost-lake");
  await expect(page.getByTestId("doc-link")).toHaveAttribute("href", "https://example.com/stage-plot.pdf");
  await expect(page.getByTestId("bit-state")).toHaveText("Not listed");
  await expect(page.getByTestId("bit-detail")).toHaveText("Not published.");
  // Publish: a hold is published but waits to be confirmed before it lists
  await page.getByTestId("bit-publish").click();
  await expect(page.getByTestId("bit-detail")).toHaveText("Published: it lists once the show is confirmed.");
  await page.getByTestId("bit-unpublish").click();
  await expect(page.getByTestId("bit-publish")).toBeVisible();

  // Clean up so reruns start from the same place
  await page.getByTestId("promotion-edit").click();
  await page.getByTestId("ticket-url").fill("");
  await page.getByTestId("doc-remove").click();
  await page.getByTestId("promotion-save").click();
  await expect(page.getByTestId("ticket-none")).toBeVisible();
  await page.getByTestId("sound-venueProvided").click();
  await expect(page.getByTestId("sound-venueProvided")).toBeChecked();
  await page.getByTestId("sound-notes-view").click();
  await page.getByTestId("sound-notes").fill("");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("sound-add-notes")).toBeVisible(); // no notes: Add notes again
});
