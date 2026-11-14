import { test, expect, type Browser, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(browser: Browser, key: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
  return page;
}
async function openShow(page: Page, venue: string) {
  await page.goto(A("/shows"));
  const id = await page.getByTestId("shows-row").filter({ hasText: venue }).first().getAttribute("data-id");
  await page.goto(A(`/shows/${id}`));
  await expect(page.getByTestId("comments")).toBeVisible();
}
const VENUE = "Pine Hollow Lounge";

test("Show comments: admins post Private by default, edit or delete anyone's, and edits say edited", async ({ browser }) => {
  let page: Page;
  const card = { getByTestId: (id: string) => page.getByTestId("comments").getByTestId(id) };
  const row = (text: string) => card.getByTestId("comment").filter({ hasText: text });

  // A member posts to the band; no Private choice for them.
  page = await signInAs(browser, "hugo");
  await openShow(page, VENUE);
  await expect(card.getByTestId("comment-audience")).toHaveCount(0);
  await card.getByTestId("comment-input").fill("Hugo: bringing the small amp");
  await card.getByTestId("comment-post").click();
  await expect(row("Hugo: bringing the small amp")).toBeVisible();
  await expect(row("Hugo: bringing the small amp").getByTestId("comment-edited")).toHaveCount(0);

  // The admin edits Hugo's comment: it says edited.
  page = await signInAs(browser, "rudy");
  await openShow(page, VENUE);
  await row("Hugo: bringing the small amp").getByTestId("comment-edit").click();
  await card.getByTestId("comment-edit-input").fill("Hugo: bringing the big amp");
  await card.getByTestId("comment-save").click();
  await expect(row("Hugo: bringing the big amp").getByTestId("comment-edited")).toHaveText("edited");
  await expect(row("Hugo: bringing the big amp").getByTestId("comment-private")).toHaveCount(0);

  // The admin's own comment is Private by default, then shared with the band by editing.
  await expect(card.getByTestId("comment-audience-private")).toBeChecked();
  await card.getByTestId("comment-input").fill("Rudy: guarantee is firm");
  await card.getByTestId("comment-post").click();
  await expect(row("Rudy: guarantee is firm").getByTestId("comment-private")).toBeVisible();
  await card.getByTestId("comment-input").fill("Rudy: secret note");
  await card.getByTestId("comment-post").click();
  await expect(row("Rudy: secret note").getByTestId("comment-private")).toBeVisible();
  await row("Rudy: guarantee is firm").getByTestId("comment-edit").click();
  await expect(card.getByTestId("comment-edit-audience-private")).toBeChecked();
  await card.getByTestId("comment-edit-audience-band").check();
  await card.getByTestId("comment-save").click();
  await expect(row("Rudy: guarantee is firm").getByTestId("comment-private")).toHaveCount(0);
  await expect(row("Rudy: guarantee is firm").getByTestId("comment-edited")).toHaveCount(0);

  // Hugo sees his edited comment and the shared one, not the private one, and can't edit the admin's.
  page = await signInAs(browser, "hugo");
  await openShow(page, VENUE);
  await expect(row("Hugo: bringing the big amp").getByTestId("comment-edited")).toBeVisible();
  await expect(row("Rudy: guarantee is firm")).toBeVisible();
  await expect(row("Rudy: guarantee is firm").getByTestId("comment-edit")).toHaveCount(0);
  await expect(row("Rudy: secret note")).toHaveCount(0);

  // The admin deletes Hugo's comment.
  page = await signInAs(browser, "rudy");
  await openShow(page, VENUE);
  page.once("dialog", (d) => void d.accept());
  await row("Hugo: bringing the big amp").getByTestId("comment-edit").click();
  await card.getByTestId("comment-delete").click();
  await expect(row("Hugo: bringing the big amp")).toHaveCount(0);
});
