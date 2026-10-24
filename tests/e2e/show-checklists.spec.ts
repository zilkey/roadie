import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
}
async function openPrep(page: Page) {
  await page.goto(A("/shows"));
  await page.getByText("Hi-Dive").first().click();
  await expect(page.getByTestId("show-page")).toBeVisible();
  await page.getByTestId("show-tab-prep").click();
}

test("an admin makes a checklist, ticks an item, and deletes the list", async ({ page }) => {
  await signInAs(page, "jeff");
  await openPrep(page);

  await page.getByTestId("checklist-new").click();
  const card = page.getByTestId("checklists");
  await expect(card).toHaveAttribute("data-editing", "1");
  const name = card.getByLabel("List name").last();
  await expect(name).toBeFocused();
  await name.fill("E2E Promo");
  const add = card.getByTestId(/^checklist-add-\d+$/).last();
  await add.fill("Post the poster");
  await add.press("Enter");
  await expect(add).toBeFocused();
  await add.fill("Email the newsletter");
  await add.press("Enter");
  await card.getByTestId("checklists-save").click();

  const list = page.locator('[data-testid^="checklist-"]', { has: page.getByRole("heading", { name: "E2E Promo" }) }).first();
  await expect(list.getByRole("heading", { name: "E2E Promo" })).toBeVisible();
  await expect(list.getByText("0 of 2")).toBeVisible();
  await expect(list.getByText("Anyone")).toHaveCount(2);
  await list.getByLabel("Post the poster").check();
  await expect(list.getByText("1 of 2")).toBeVisible();

  // clean up: delete the list
  await list.getByRole("button", { name: "Edit" }).click();
  const names = page.getByTestId("checklists").getByLabel("List name");
  const n = await names.count();
  for (let i = 0; i < n; i++) {
    if ((await names.nth(i).inputValue()) === "E2E Promo") {
      await page.getByTestId(`checklist-${i}-actions`).click();
      await page.getByTestId(`checklist-${i}-menu-delete`).click();
      break;
    }
  }
  await page.getByTestId("checklists-save").click();
  await expect(page.getByRole("heading", { name: "E2E Promo" })).toHaveCount(0);
});

test("a member cannot edit lists and can only tick their own items", async ({ page }) => {
  await signInAs(page, "david");
  await openPrep(page);
  await expect(page.getByTestId("checklist-new")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  const boxes = page.getByTestId("checklist-item").getByRole("checkbox");
  const total = await boxes.count();
  expect(total).toBeGreaterThan(0);
  const disabled = await boxes.evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).disabled).length);
  expect(disabled).toBeLessThan(total); // David's own gear item is enabled
  expect(disabled).toBeGreaterThan(0); // others' items are not
});
