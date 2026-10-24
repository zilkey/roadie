import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function openShow(page: Page, venue: string) {
  await page.goto("/signin");
  await page.getByTestId("dev-jeff").click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto(A("/shows"));
  await page.getByTestId("shows-row").filter({ hasText: venue }).first().locator("a").first().click();
  await expect(page.getByTestId("sound")).toBeVisible();
}

test("Sound, Setlist and Promotion cards edit and save on a private hold", async ({ page }) => {
  await openShow(page, "Lost Lake Lounge");

  // Sound: one card, no Edit. The toggle saves at once; notes save when you leave the box, and clicking them edits again.
  const sound = page.getByTestId("sound");
  await expect(sound.getByTestId("sound-edit")).toHaveCount(0);
  await sound.getByTestId("sound-bandProvided").check();
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

  // Setlist: empty -> pick -> open link
  await expect(page.getByTestId("setlist-empty")).toContainText("No setlist yet.");
  await page.getByTestId("setlist-pick").click();
  await page.getByTestId("setlist-select").selectOption({ label: "Hi-Dive 45 min" });
  await page.getByTestId("setlist-save").click();
  await expect(page.getByTestId("setlist-name")).toHaveText("Hi-Dive 45 min");
  await expect(page.getByTestId("setlist-link")).toHaveAttribute("href", /\/songs\?setlist=/);

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
  await page.getByTestId("setlist-edit").click();
  await page.getByTestId("setlist-select").selectOption("");
  await page.getByTestId("setlist-save").click();
  await expect(page.getByTestId("setlist-empty")).toBeVisible();
  await page.getByTestId("sound-venueProvided").check();
  await expect(page.getByTestId("sound-venueProvided")).toBeChecked();
  await page.getByTestId("sound-notes-view").click();
  await page.getByTestId("sound-notes").fill("");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("sound-add-notes")).toBeVisible(); // no notes: Add notes again
});

test("Hi-Dive shows listing state and members see no Edit", async ({ page, browser }) => {
  await openShow(page, "Hi-Dive");
  await expect(page.getByTestId("sound-venueProvided")).toBeChecked();
  await expect(page.getByTestId("sound-notes-view")).toHaveText("House engineer");
  await expect(page.getByTestId("setlist-name")).toHaveText("Hi-Dive 45 min");
  await expect(page.getByTestId("bit-sync")).toBeVisible();
  const url = page.url();

  const ctx = await browser.newContext();
  const m = await ctx.newPage();
  await m.goto("/signin");
  await m.getByTestId("dev-david").click();
  await expect(m).toHaveURL(/\/home$/);
  await m.goto(url);
  await expect(m.getByTestId("sound")).toBeVisible();
  await expect(m.getByTestId("sound-venueProvided")).toBeDisabled();
  await expect(m.getByTestId("sound-add-notes")).toHaveCount(0);
  await expect(m.getByTestId("setlist-edit")).toHaveCount(0);
  await expect(m.getByTestId("promotion-edit")).toHaveCount(0);
  await expect(m.getByTestId("bit-sync")).toHaveCount(0);
  await ctx.close();
});
