import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

/** The sidebar link marked as the page you're on: exactly one, and it looks it (the accent background, not transparent). */
async function expectCurrent(page: Page, testid: string) {
  const nav = page.getByTestId("booking-nav");
  await expect(nav.getByTestId(testid)).toHaveAttribute("aria-current", "page");
  await expect(nav.locator("[aria-current='page']")).toHaveCount(1);
  await expect(nav.getByTestId(testid)).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
}

test("a pitch in a campaign: the sidebar marks the campaign and the crumbs lead back to it from Search Gmail, compose and find", async ({ page }) => {
  const name = `Crumbs ${Date.now()}`;
  await signInAs(page, "rudy");
  await page.goto(A("/booking/campaigns"));
  await expectCurrent(page, "booking-seg-campaigns");
  await page.getByTestId("campaign-new").click();
  await page.getByTestId("campaign-new-name").fill(name);
  await page.getByTestId("campaign-new-create").click();
  await expect(page).toHaveURL(/\/booking\/campaigns\/(?!ongoing)[^/?]+$/);
  const campaignId = page.url().split("/").pop()!;
  const seg = `booking-seg-campaign-${campaignId}`;
  await expectCurrent(page, seg);

  // Move Pine Hollow's pitch into it (moved back to Ongoing at the end: later specs find it there).
  await page.getByTestId("booking-seg-pitches").click();
  await expectCurrent(page, "booking-seg-pitches");
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Pine Hollow Lounge" }).locator("[data-testid^='flag-'][data-flagged='1']").click();
  const select = page.getByTestId("pitch-campaign-select");
  try {
    await select.selectOption({ label: name });
    await expect(page.getByTestId("crumb-2")).toHaveText(name); // Booking › Campaigns › the campaign › Pine Hollow Lounge
    await expectCurrent(page, seg);

    // Search Gmail: Booking › Campaigns › the campaign › the pitch › Search Gmail, the campaign still marked
    await page.getByTestId("search-gmail").click();
    await expect(page.getByTestId("gmail-search-page")).toBeVisible();
    await expect(page.getByTestId("gmail-search-page").locator(".page-meta")).toContainText("Looks in rudy@example.com"); // no booking mailbox set: the caller's own
    await expect(page.getByTestId("crumb-1")).toHaveText("Campaigns");
    await expect(page.getByTestId("crumb-2")).toHaveText(name);
    await expect(page.getByTestId("crumb-3")).toHaveText("Pine Hollow Lounge");
    await expect(page.getByTestId("crumb-current")).toHaveText("Search Gmail");
    await expectCurrent(page, seg);
    const query = new URL(page.url()).search;

    // New email on the pitch: the same trail
    await page.goto(A(`/booking/email/new${query}`));
    await expect(page.getByTestId("compose-page")).toBeVisible();
    await expect(page.getByTestId("crumb-2")).toHaveText(name);
    await expect(page.getByTestId("crumb-3")).toHaveText("Pine Hollow Lounge");
    await expectCurrent(page, seg);

    // Find sent emails for the campaign: Booking › Campaigns › the campaign › Find sent emails
    await page.goto(A(`/booking/email/find?campaign=${campaignId}`));
    await expect(page.getByTestId("crumb-1")).toHaveText("Campaigns");
    await expect(page.getByTestId("crumb-2")).toHaveText(name);
    await expect(page.getByTestId("crumb-current")).toHaveText("Find sent emails");
    await expectCurrent(page, seg);

    // The campaign crumb goes back to the campaign
    await page.goto(A(`/booking/email/search${query}`));
    await page.getByTestId("crumb-2").click();
    await expect(page).toHaveURL(new RegExp(`/booking/campaigns/${campaignId}$`));
    await expect(page.getByTestId("pitch-list")).toContainText("Pine Hollow Lounge");
  } finally {
    await page.goto(A("/booking/campaigns/" + campaignId));
    await page.getByTestId("pitch-list").locator("tr", { hasText: "Pine Hollow Lounge" }).locator("[data-testid^='flag-'][data-flagged='1']").click();
    await select.selectOption({ label: "Ongoing (no campaign)" });
    await expect(page.getByTestId("crumb-2")).toHaveText("Ongoing");
    // and close the campaign: while one is active, a flag asks which campaign (booking.spec flags straight onto Ongoing)
    await page.goto(A("/booking/campaigns/" + campaignId));
    page.once("dialog", (d) => void d.accept());
    await page.getByTestId("campaign-more-actions").click();
    await page.getByTestId("campaign-close").click();
    await expect(page.getByTestId("campaign-closed")).toBeVisible();
  }
});
