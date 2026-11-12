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
  await expect(page.getByTestId("confetti")).toBeVisible(); // every tick gets confetti
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
  await our.getByTestId("todos-additem-our").click();
  await our.getByTestId("todos-additem-our-input").fill("Order more stickers");
  await our.getByTestId("todos-additem-our-add").click();
  await expect(our.getByTestId("todos-additem-our-input")).toHaveValue(""); // stays open for the next one
  await our.getByTestId("todos-additem-our-cancel").click();
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

test("Focus shows one column; columns drag into my own order, which sticks", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/todos"));
  const cols = page.locator('[data-testid^="todos-col-"]:not([data-testid^="todos-col-grip"])');
  const keys = () => cols.evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("todos-col-", "")));
  await expect(page.getByTestId("todos-col-our")).toBeVisible();

  await page.getByTestId("todos-focus-booking").click();
  await expect(cols).toHaveCount(1);
  await expect(page.getByTestId("todos-col-booking")).toBeVisible();
  await expect(page.getByTestId("todos-focus-booking")).toHaveText("Show all");
  await page.getByTestId("todos-focus-booking").click();
  await expect(page.getByTestId("todos-col-our")).toBeVisible();

  const before = await keys();
  expect(before.slice(0, 2)).toEqual(["pinned", "booking"]);
  const after = ["booking", "pinned", ...before.slice(2)];
  await page.getByTestId("todos-col-grip-booking").dragTo(page.getByTestId("todos-col-pinned"));
  await expect.poll(keys).toEqual(after);
  await page.reload();
  await expect.poll(keys).toEqual(after);
});

test("Add list: nothing is made until Add; Cancel throws the draft away; the new list takes to-dos and can be deleted", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/todos"));
  await expect(page.getByTestId("todos-col-our")).toBeVisible();
  const lists = page.locator('[data-testid^="todos-col-list:"]');
  await expect(lists).toHaveCount(0);

  await page.getByTestId("todos-add-list").click();
  await page.getByTestId("todos-add-list-input").fill("Never mind");
  await page.getByTestId("todos-add-list-cancel").click();
  await page.getByTestId("todos-add-list").click();
  await expect(page.getByTestId("todos-add-list-input")).toHaveValue(""); // Cancel discarded the draft
  await expect(lists).toHaveCount(0);

  await page.getByTestId("todos-add-list-input").fill("Van stuff");
  await page.getByTestId("todos-add-list-add").click();
  const van = lists.filter({ hasText: "Van stuff" });
  await expect(van).toHaveCount(1);
  await expect(van.getByRole("heading", { name: "Van stuff" })).toBeVisible();

  const add = van.locator('[data-testid^="todos-additem-board:"]').first();
  await add.click();
  await van.locator('[data-testid$="-input"]').fill("Oil change");
  await van.locator('[data-testid$="-input"]').press("Enter");
  const card = van.locator('[data-testid^="todos-item-board:"]').filter({ hasText: "Oil change" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Pin Oil change" }).click();
  const pinned = page.getByTestId("todos-col-pinned").locator('[data-testid^="todos-item-board:"]').filter({ hasText: "Oil change" });
  await expect(pinned.getByTestId("todos-source")).toHaveText("Van stuff");
  await expect(card).toHaveCount(0);

  await page.reload();
  await expect(lists.filter({ hasText: "Van stuff" })).toHaveCount(1);
  await page.getByRole("button", { name: "Delete list Van stuff" }).click();
  await expect(page.getByTestId("toast-text").filter({ hasText: "Deleted list: Van stuff" })).toBeVisible();
  await expect(lists).toHaveCount(0);
  await expect(pinned).toHaveCount(0);
});

test("every list but Booking adds a to-do at its bottom: a show's checklist, and Pinned (pinned to-do on Our list)", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/todos"));
  await expect(page.getByTestId("todos-col-our")).toBeVisible();
  await expect(page.getByTestId("todos-col-booking").locator('[data-testid^="todos-additem-"]')).toHaveCount(0);

  const show = pineHollow(page);
  const gear = show.locator('[data-testid^="todos-additem-show:"]').first();
  await gear.click();
  await show.locator('[data-testid^="todos-additem-show:"][data-testid$="-input"]').fill("Spare strings");
  await show.locator('[data-testid^="todos-additem-show:"][data-testid$="-add"]').click();
  await expect(show.locator('[data-testid^="todos-item-show:"]').filter({ hasText: "Spare strings" })).toBeVisible();

  const pinned = page.getByTestId("todos-col-pinned");
  await pinned.getByTestId("todos-additem-pinned").click();
  await pinned.getByTestId("todos-additem-pinned-input").fill("Call the van rental");
  await pinned.getByTestId("todos-additem-pinned-add").click();
  const card = pinned.locator('[data-testid^="todos-item-todo:"]').filter({ hasText: "Call the van rental" });
  await expect(card.getByTestId("todos-source")).toHaveText("Our list");
  await card.getByRole("button", { name: "Unpin Call the van rental" }).click();
  await expect(page.getByTestId("todos-col-our").locator('[data-testid^="todos-item-todo:"]').filter({ hasText: "Call the van rental" })).toBeVisible();
  await expect(card).toHaveCount(0);
});
