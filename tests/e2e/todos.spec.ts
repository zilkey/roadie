import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
/** The seeded Pine Hollow show (Jan 16 2027, a hold) and its Gear list. */
const pineHollow = (page: Page) => page.locator('[data-testid^="todos-col-show:"]').filter({ hasText: "Pine Hollow Lounge" });

test("To Dos starts in More for an admin, and members don't get it", async ({ page }) => {
  await signInAs(page, "rudy");
  await expect(page.getByTestId("tab-todos")).toHaveCount(0); // not in the main bar
  await page.getByTestId("more-toggle").click();
  await page.getByTestId("more-todos").click();
  await expect(page).toHaveURL(/\/todos$/);
  await expect(page.getByTestId("todos-page")).toBeVisible();
  await expect(page.getByTestId("todos-col-pinned")).toBeVisible();
  await expect(page.getByTestId("todos-col-booking")).toBeVisible();
  await expect(page.getByTestId("todos-col-our")).toBeVisible();
});

test("pin a show item, see it in Pinned with its source, tick it; Show done brings it back", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/todos"));
  const show = pineHollow(page);
  await expect(show.getByRole("heading", { name: /Sat Jan 16 · Pine Hollow Lounge/ })).toBeVisible();
  await show.getByRole("button", { name: "Pin Keys rig" }).click();

  const pinned = page.getByTestId("todos-col-pinned");
  const card = pinned.locator('[data-testid^="todos-item-show:"]').filter({ hasText: "Keys rig" });
  await expect(card).toBeVisible();
  await expect(card.getByTestId("todos-source")).toHaveText("Sat Jan 16 Pine Hollow Lounge › Gear");
  await expect(show.getByText("Keys rig")).toHaveCount(0); // pinned items live in Pinned, not in their show

  await card.getByRole("checkbox").check();
  await expect(page.getByTestId("toast-text").filter({ hasText: "Done: Keys rig" })).toBeVisible();
  await expect(card).toHaveCount(0); // done items are hidden
  await page.getByTestId("todos-show-done").check();
  await expect(card).toBeVisible();
  await expect(card.getByRole("checkbox")).toBeChecked();
  await card.getByRole("checkbox").uncheck();
  await page.getByTestId("todos-show-done").uncheck();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Unpin Keys rig" }).click();
  await expect(show.getByText("Keys rig")).toBeVisible();
});

test("Our list: add a to do, click to edit it and pick who", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/todos"));
  const our = page.getByTestId("todos-col-our");
  await our.getByTestId("todos-add-input").fill("Order more stickers");
  await our.getByTestId("todos-add").click();
  await expect(our.getByTestId("todos-add-input")).toHaveValue("");
  await our.getByText("Order more stickers").click();
  await our.getByTestId("checklist-edit-input").fill("Order 500 stickers");
  await our.getByTestId("checklist-edit-owner").selectOption({ label: "Hugo" });
  await our.getByTestId("checklist-edit-input").press("Enter");
  const item = our.locator('[data-testid^="todos-item-todo:"]').filter({ hasText: "Order 500 stickers" });
  await expect(item).toBeVisible();
  await expect(item.getByText("Hugo", { exact: true })).toBeVisible();
  await expect(our.getByText("Order more stickers")).toHaveCount(0);
});

test("dismiss a checklist from my To Dos, then show it again", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/todos"));
  const show = pineHollow(page);
  await expect(show.getByText("Bass rig")).toBeVisible();
  await show.getByRole("button", { name: "Dismiss Gear" }).click();
  await expect(show).toHaveCount(0); // nothing left on that show, so no column
  await expect(page.getByTestId("todos-dismissed")).toHaveText("Dismissed (1)");
  await page.getByTestId("todos-dismissed").click();
  const list = page.getByTestId("todos-dismissed-list");
  await expect(list.getByText("Sat Jan 16 Pine Hollow Lounge › Gear")).toBeVisible();
  await list.getByRole("button", { name: "Show again" }).click();
  await expect(pineHollow(page).getByText("Bass rig")).toBeVisible();
  await expect(page.getByTestId("todos-dismissed")).toHaveText("Dismissed (0)");
});
