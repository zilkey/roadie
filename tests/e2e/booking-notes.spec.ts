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
async function open(page: Page, base: (p: string) => string, kind: "promoter" | "festival", name: string) {
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
  await page.getByTestId("notes-edit").click();
  await page.getByTestId("promoter-notes-notes").fill(`Met them at UMS ${STAMP}`);
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
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
  await op.getByTestId("notes-edit").click();
  await op.getByTestId("promoter-notes-howToPitch").fill(`Fern Valley pitches by phone ${STAMP}`);
  await expect(op.getByTestId("save-status")).toHaveText("Saved");
  await olga.close();

  await page.goto(url);
  await expect(page.getByTestId("notes-private")).toContainText("Email Marcus with live video and two dates.");
  await expect(page.locator("body")).not.toContainText("Fern Valley pitches by phone");
});

test("a festival's notes autosave into this band's notes and stay out of another band's view", async ({ page, browser }) => {
  await signInAs(page, "jeff");
  await open(page, A, "festival", "Underground Music Showcase");
  await expect(page.getByTestId("festival-notes-card")).toContainText("Our notes");
  await page.getByTestId("festival-notes-card").getByTestId("notes-edit").click();
  await page.getByTestId("festival-notes-notes").fill(`Apply with the trio video ${STAMP}`);
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("festival-notes-card")).toContainText(`Apply with the trio video ${STAMP}`);

  const olga = await browser.newContext();
  const op = await olga.newPage();
  await signInAs(op, "olga");
  await open(op, OTHER, "festival", "Underground Music Showcase");
  await expect(op.getByTestId("festival-about")).toBeVisible();
  await expect(op.locator("body")).not.toContainText(`Apply with the trio video ${STAMP}`);
  await olga.close();
});
