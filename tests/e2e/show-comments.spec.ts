import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
}
async function openHiDive(page: Page) {
  await page.goto(A("/shows"));
  await page.getByTestId("shows-row").filter({ hasText: "Hi-Dive" }).first().locator("a").first().click();
  await expect(page.getByTestId("comments")).toBeVisible();
}

test("a comment can be posted, edited and deleted by its author, and others cannot edit it", async ({ browser }) => {
  const text = `Parking is behind the building ${Date.now()}`;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInAs(page, "jeff");
  await openHiDive(page);
  const url = page.url();

  await expect(page.getByTestId("comment-post")).toBeDisabled();
  await page.getByTestId("comment-input").fill(text);
  await page.getByTestId("comment-post").click();
  const mine = page.getByTestId("comment").filter({ hasText: text });
  await expect(mine).toBeVisible();
  await expect(page.getByTestId("comment-input")).toHaveValue("");
  await expect(mine).toContainText("Jeff");

  // a band member sees it but cannot edit it
  const ctx2 = await browser.newContext();
  const eric = await ctx2.newPage();
  await signInAs(eric, "eric");
  await eric.goto(url);
  const seen = eric.getByTestId("comment").filter({ hasText: text });
  await expect(seen).toBeVisible();
  await expect(seen.getByTestId("comment-edit")).toHaveCount(0);
  await ctx2.close();

  // edit
  await mine.getByTestId("comment-edit").click();
  await page.getByTestId("comment-edit-input").fill(`${text} (edited)`);
  await page.getByTestId("comment-save").click();
  await expect(page.getByTestId("comment").filter({ hasText: `${text} (edited)` })).toBeVisible();

  // cancel keeps it
  await page.getByTestId("comment").filter({ hasText: text }).getByTestId("comment-edit").click();
  await page.getByTestId("comment-edit-input").fill("nope");
  await page.getByTestId("comment-cancel").click();
  await expect(page.getByTestId("comment").filter({ hasText: `${text} (edited)` })).toBeVisible();

  // delete
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("comment").filter({ hasText: text }).getByTestId("comment-edit").click();
  await page.getByTestId("comment-delete").click();
  await expect(page.getByTestId("comment").filter({ hasText: text })).toHaveCount(0);
  await ctx.close();
});
