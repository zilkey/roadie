import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
const OTHER = (path: string) => `/artists/fern-valley-trio${path}`;
const STAMP = Date.now();

/** Booking -> the kind's tab -> search -> the record's full page, as an admin of `base`. A festival with a year lists as its year's row. */
async function open(page: Page, base: (p: string) => string, kind: "promoter" | "festival" | "contact", name: string) {
  await page.goto(base(`/booking/${kind}s`));
  await page.getByTestId("booking-search").fill(name);
  await page.getByTestId(new RegExp(`^${kind}-(full|name)-`)).filter({ hasText: name }).first().click();
  await expect(page.getByTestId(`${kind}-page`)).toBeVisible();
}

test("a promoter's notes and the venues they book are this band's own: another band's admin sees the promoter but neither", async ({ page, browser }) => {
  await signInAs(page, "jeff");
  await open(page, A, "promoter", "Front Range Presents");
  await expect(page.getByTestId("notes-private")).toContainText("Email Marcus with live video and two dates.");
  await expect(page.getByTestId("promoter-page")).toContainText("Fox Theatre");
  // the note is the control: tap it, type, leave it, and it saves (no Edit, no Done)
  await expect(page.getByTestId("notes-edit")).toHaveCount(0);
  await page.getByTestId("promoter-notes").click();
  await page.getByTestId("promoter-notes-input").fill(`Met them at UMS ${STAMP}`);
  await page.getByTestId("promoter-notes-input").blur();
  await expect(page.getByTestId("promoter-notes-saved")).toBeVisible();
  await expect(page.getByTestId("promoter-notes")).toContainText(`Met them at UMS ${STAMP}`);
  const url = page.url();
  await page.reload();
  await expect(page.getByTestId("notes-private")).toContainText(`Met them at UMS ${STAMP}`);

  const olga = await browser.newContext();
  const op = await olga.newPage();
  await signInAs(op, "olga");
  await open(op, OTHER, "promoter", "Front Range Presents");
  await expect(op.getByTestId("promoter-page")).toContainText("Front Range Presents");
  await expect(op.locator("body")).not.toContainText("Email Marcus");
  await expect(op.locator("body")).not.toContainText(`Met them at UMS ${STAMP}`);
  await expect(op.locator("body")).not.toContainText("Fox Theatre");
  await op.getByTestId("promoter-howtopitch").click();
  await op.getByTestId("promoter-howtopitch-input").fill(`Fern Valley pitches by phone ${STAMP}`);
  await op.getByTestId("promoter-howtopitch-input").blur();
  await expect(op.getByTestId("promoter-howtopitch-saved")).toBeVisible();
  await olga.close();

  await page.goto(url);
  await expect(page.getByTestId("notes-private")).toContainText("Email Marcus with live video and two dates.");
  await expect(page.locator("body")).not.toContainText("Fern Valley pitches by phone");
});

test("a festival's notes autosave into this band's notes and stay out of another band's view", async ({ page, browser }) => {
  await signInAs(page, "jeff");
  await open(page, A, "festival", "Underground Music Showcase");
  await expect(page.getByTestId("festival-notes-card")).toContainText("Our notes");
  await page.getByTestId("festival-notes").click();
  await page.getByTestId("festival-notes-input").fill(`Apply with the trio video ${STAMP}`);
  await page.getByTestId("festival-notes-input").blur();
  await expect(page.getByTestId("festival-notes-saved")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("festival-notes-card")).toContainText(`Apply with the trio video ${STAMP}`);
  const festivalUrl = page.url();

  const olga = await browser.newContext();
  const op = await olga.newPage();
  await signInAs(op, "olga");
  await open(op, OTHER, "festival", "Underground Music Showcase");
  await expect(op.getByTestId("festival-about")).toBeVisible();
  await expect(op.locator("body")).not.toContainText(`Apply with the trio video ${STAMP}`);
  await olga.close();

  // the year's notes: Pay is one line (Enter saves), Escape puts a value back unsaved
  await page.goto(festivalUrl);
  await page.getByTestId("festival-years").getByRole("link", { name: "2027", exact: true }).first().click();
  await expect(page.getByTestId("edition-page")).toBeVisible();
  await page.getByTestId("edition-pay").click();
  await page.getByTestId("edition-pay-input").fill(`$400 guarantee ${STAMP}`);
  await page.getByTestId("edition-pay-input").press("Enter");
  await expect(page.getByTestId("edition-pay-saved")).toBeVisible();
  await expect(page.getByTestId("edition-pay")).toContainText(`$400 guarantee ${STAMP}`);
  await page.getByTestId("edition-notes").click();
  await page.getByTestId("edition-notes-input").fill("not this");
  await page.getByTestId("edition-notes-input").press("Escape");
  await expect(page.getByTestId("edition-notes-input")).toHaveCount(0);
  await expect(page.getByTestId("edition-notes")).not.toContainText("not this");
  await page.reload();
  await expect(page.getByTestId("edition-notes-card")).toContainText(`$400 guarantee ${STAMP}`);
});

test("a contact's notes and a venue's notes edit in place; Booked by links and unlinks a promoter without a flip", async ({ page }) => {
  await signInAs(page, "jeff");
  await open(page, A, "contact", "Marcus Webb");
  await expect(page.getByTestId("contact-page")).toBeVisible();
  await page.getByTestId("contact-notes").click();
  await page.getByTestId("contact-notes-input").fill(`Prefers texts ${STAMP}`);
  await page.getByTestId("contact-notes-input").blur();
  await expect(page.getByTestId("contact-notes-saved")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("contact-notes")).toContainText(`Prefers texts ${STAMP}`);

  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-venues").click();
  await page.getByTestId("booking-search").fill("Dairy Arts Center");
  await page.getByTestId(/^row-venue-/).filter({ hasText: "Dairy Arts Center" }).first().getByTestId(/^venue-full-/).click();
  await expect(page.getByTestId(/^(venue|pitch)-page$/)).toBeVisible();
  if (await page.getByTestId("pitch-page").count()) await page.getByTestId("target-link").click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
  const card = page.getByTestId("notes-private");
  await expect(card.getByTestId("notes-edit")).toHaveCount(0);

  await card.getByTestId("venue-loadin").click();
  await page.getByTestId("venue-loadin-input").fill(`Loading dock on Walnut ${STAMP}`);
  await page.getByTestId("venue-loadin-input").blur();
  await expect(page.getByTestId("venue-loadin-saved")).toBeVisible();
  await expect(card.getByTestId("venue-loadin")).toContainText(`Loading dock on Walnut ${STAMP}`);

  // the plus opens the promoter picker; picking one links it; its × unlinks it again
  await card.getByTestId("booked-by-add").click();
  await page.getByTestId("promoter-link").selectOption({ label: "Front Range Presents" });
  await expect(page.getByTestId("promoter-link")).toHaveCount(0);
  await expect(card.getByRole("link", { name: "Front Range Presents" })).toBeVisible();
  await card.getByRole("button", { name: "Unlink Front Range Presents" }).click();
  await expect(card.getByRole("link", { name: "Front Range Presents" })).toHaveCount(0);
});
