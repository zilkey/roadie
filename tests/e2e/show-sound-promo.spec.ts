import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function openShow(page: Page, venue: string, date: string) {
  await page.goto("/signin");
  await page.getByTestId("dev-rudy").click();
  await expect(page).toHaveURL(/\/calendar$/);
  await page.goto(A("/shows"));
  await page.getByTestId("shows-row").filter({ hasText: venue }).filter({ hasText: date }).first().locator("td.date a").click();
  await expect(page.getByTestId("sound")).toBeVisible();
}

test("Sound and Promotion cards edit and save on a private hold", async ({ page }) => {
  await openShow(page, "Pine Hollow Lounge", "Jan 16");

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

  // Promotion is its own tab: Posters (anyone uploads; the first upload makes "{date} {venue}" in the Shows folder) and the Promotion card.
  await page.getByTestId("show-tab-promotion").click();
  await expect(page.getByTestId("posters-none")).toHaveText("No posters yet.");
  await expect(page.getByTestId("show-folder-link")).toHaveCount(0);
  await page.getByTestId("poster-upload-input").setInputFiles({ name: "Pine Hollow poster.png", mimeType: "image/png", buffer: Buffer.from("not really a png") });
  await expect(page.getByTestId("poster-upload-done")).toHaveText("Uploaded to 2027-01-16 Pine Hollow Lounge.");
  await expect(page.getByTestId("poster-title")).toHaveText("Pine Hollow poster.png");
  await expect(page.getByTestId("show-folder-link")).toContainText("2027-01-16 Pine Hollow Lounge");
  await page.reload();
  await expect(page.getByTestId("poster-title")).toHaveText("Pine Hollow poster.png");

  // Promotion: no Edit. The ticket link is a value; docs add through the plus and leave through their ×.
  await expect(page.getByTestId("promotion-edit")).toHaveCount(0);
  await expect(page.getByTestId("docs-none")).toHaveText("No docs yet");
  await page.getByTestId("ticket-url").click();
  await page.getByTestId("ticket-url-input").fill("https://tickets.example.com/pine-hollow");
  await page.getByTestId("ticket-url-input").press("Enter");
  await expect(page.getByTestId("ticket-url-saved")).toBeVisible();
  await expect(page.getByTestId("ticket-link")).toHaveAttribute("href", "https://tickets.example.com/pine-hollow");
  await page.getByTestId("doc-add").click();
  await page.getByTestId("doc-title").fill("Stage plot");
  await page.getByTestId("doc-url").fill("https://example.com/stage-plot.pdf");
  await page.getByTestId("doc-add-confirm").click();
  await expect(page.getByTestId("doc-title")).toHaveCount(0);
  await expect(page.getByTestId("doc-link")).toHaveAttribute("href", "https://example.com/stage-plot.pdf");
  await page.reload();
  await expect(page.getByTestId("ticket-link")).toHaveAttribute("href", "https://tickets.example.com/pine-hollow");
  await expect(page.getByTestId("doc-link")).toHaveText("Stage plot");
  // Bandsintown: Roadie can't publish there. A hold has no to-do yet; Open Bandsintown goes to Bandsintown for Artists' new-event form.
  await expect(page.getByTestId("bit-publish")).toHaveCount(0);
  await expect(page.getByTestId("bit-state")).toHaveCount(0);
  await expect(page.getByTestId("bit-detail")).toHaveText("Once the show is confirmed it gets an \"Add to Bandsintown\" to-do.");
  await expect(page.getByTestId("bit-open")).toHaveAttribute("href", "https://artists.bandsintown.com/artists/1234567/events/new?version=multi-step&step=type");

  // Clean up so reruns start from the same place
  await page.getByTestId("ticket-url").locator(".pen").click(); // the pencil edits; the link itself opens the site
  await page.getByTestId("ticket-url-input").fill("");
  await page.getByTestId("ticket-url-input").press("Enter");
  await expect(page.getByTestId("ticket-link")).toHaveCount(0);
  await expect(page.getByTestId("ticket-url")).toHaveText("Add…");
  await page.getByTestId("doc-remove").click();
  await expect(page.getByTestId("doc-link")).toHaveCount(0);
  await expect(page.getByTestId("docs-none")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("poster-remove").click();
  await expect(page.getByTestId("posters-none")).toBeVisible();
  await page.getByTestId("show-tab-details").click();
  await page.getByTestId("sound-venueProvided").click();
  await expect(page.getByTestId("sound-venueProvided")).toBeChecked();
  await page.getByTestId("sound-notes-view").click();
  await page.getByTestId("sound-notes").fill("");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("sound-add-notes")).toBeVisible(); // no notes: Add notes again
});
