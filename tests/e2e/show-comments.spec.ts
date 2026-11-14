import { test, expect, type Browser, type Page } from "@playwright/test";
import { A } from "./env";
import { SEED, mmmD } from "./dates";

async function signInAs(browser: Browser, key: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
  return page;
}
async function openShow(page: Page, venue: string) {
  await page.goto(A("/shows"));
  const id = await page.getByTestId("shows-row").filter({ hasText: venue }).filter({ hasText: mmmD(SEED.hold) }).first().getAttribute("data-id");
  await page.goto(A(`/shows/${id}`));
  await expect(page.getByTestId("comments")).toBeVisible();
}
const VENUE = "Pine Hollow Lounge";

// Posting, editing, deleting, the "edited" mark and Private are covered in tests/emulator/shows.test.ts ("comments: ...") and
// the Private read rule in tests/emulator/rules.test.ts. What only a browser shows: a member's comment listener works
// (the query must be scoped to the band's comments or the rules reject it) and a Private comment never reaches them.
test("Show comments: a member posts to the band and does not see an admin's Private comment", async ({ browser }) => {
  const stamp = Date.now().toString(36); // a retry posts new text, so it never meets a first attempt's rows
  const hugoText = `Hugo ${stamp}: bringing the small amp`;
  const secret = `Rudy ${stamp}: secret note`;
  let page: Page;
  const card = { getByTestId: (id: string) => page.getByTestId("comments").getByTestId(id) };
  const row = (text: string) => card.getByTestId("comment").filter({ hasText: text });

  page = await signInAs(browser, "hugo");
  await openShow(page, VENUE);
  await expect(card.getByTestId("comment-audience")).toHaveCount(0);
  await card.getByTestId("comment-input").fill(hugoText);
  await card.getByTestId("comment-post").click();
  await expect(row(hugoText)).toBeVisible();

  page = await signInAs(browser, "rudy");
  await openShow(page, VENUE);
  await expect(card.getByTestId("comment-audience-private")).toBeChecked();
  await card.getByTestId("comment-input").fill(secret);
  await card.getByTestId("comment-post").click();
  await expect(row(secret).getByTestId("comment-private")).toBeVisible();
  await expect(row(hugoText)).toBeVisible();

  page = await signInAs(browser, "hugo");
  await openShow(page, VENUE);
  await expect(row(hugoText)).toBeVisible();
  await expect(row(secret)).toHaveCount(0);
  page.once("dialog", (d) => void d.accept());
  await row(hugoText).getByTestId("comment-edit").click();
  await card.getByTestId("comment-delete").click(); // leave nothing behind
  await expect(row(hugoText)).toHaveCount(0);
});
