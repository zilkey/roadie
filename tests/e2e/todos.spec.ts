import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";
import { SEED, shortDate } from "./dates";

const STAMP = Date.now().toString(36);

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
/** The seeded Pine Hollow show (a hold, SEED.hold) and its Gear list. */
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

test("pin a show item, see it in Pinned with its source, tick it", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/todos"));
  const show = pineHollow(page);
  await expect(show.getByRole("heading", { name: new RegExp(`${shortDate(SEED.hold)} · Pine Hollow Lounge`) })).toBeVisible();
  // A retry finds Keys rig pinned and/or ticked by the first attempt: put it back first.
  await page.getByTestId("todos-show-done").check();
  const left = page.locator('[data-testid^="todos-item-show:"]').filter({ hasText: "Keys rig" }).first();
  if (await left.count()) {
    if (await left.getByRole("checkbox").isChecked()) await left.getByRole("checkbox").uncheck();
    const unpin = left.getByRole("button", { name: "Unpin Keys rig" });
    if (await unpin.count()) await unpin.click();
  }
  await page.getByTestId("todos-show-done").uncheck();
  await show.getByRole("button", { name: "Pin Keys rig" }).click();

  const pinned = page.getByTestId("todos-col-pinned");
  const card = pinned.locator('[data-testid^="todos-item-show:"]').filter({ hasText: "Keys rig" });
  await expect(card).toBeVisible();
  await expect(card.getByTestId("todos-source")).toHaveText(`${shortDate(SEED.hold)} Pine Hollow Lounge › Gear`);
  await expect(show.getByText("Keys rig")).toHaveCount(0); // pinned items live in Pinned, not in their show

  await card.getByRole("checkbox").check();
  await expect(page.getByTestId("confetti")).toBeVisible(); // every tick gets confetti
  await expect(page.getByTestId("toast-text").filter({ hasText: "Done: Keys rig" })).toBeVisible();
  await expect(card).toHaveCount(0); // done items are hidden; Show done, Dismiss and the add rows: tests/unit/todos.test.ts, tests/emulator/todos.test.ts
  // put it back for the next run
  await page.getByTestId("todos-show-done").check();
  await card.getByRole("checkbox").uncheck();
  await page.getByTestId("todos-show-done").uncheck();
  await card.getByRole("button", { name: "Unpin Keys rig" }).click();
  await expect(show.getByText("Keys rig")).toBeVisible();
});

test("Our list: add a to do, click to edit it and pick who", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/todos"));
  const our = page.getByTestId("todos-col-our");
  await our.getByTestId("todos-additem-our").click();
  await our.getByTestId("todos-additem-our-input").fill(`Order more stickers ${STAMP}`);
  await our.getByTestId("todos-additem-our-add").click();
  await expect(our.getByTestId("todos-additem-our-input")).toHaveValue(""); // stays open for the next one
  await our.getByTestId("todos-additem-our-cancel").click();
  // Its card is like every other: the text is click-to-edit, who's on it is a click-to-pick under it (Jeff, 2026-11-12).
  const card = our.locator('[data-testid^="todos-item-todo:"]').filter({ hasText: `Order more stickers ${STAMP}` });
  const text = card.getByTestId(/^todos-text-[A-Za-z0-9]+$/);
  const textId = (await text.getAttribute("data-testid"))!; // held: once the text is an input, the card no longer matches by its words
  await text.click();
  await page.getByTestId(`${textId}-input`).fill(`Order 500 stickers ${STAMP}`);
  await page.getByTestId(`${textId}-input`).press("Enter");
  const item = our.locator('[data-testid^="todos-item-todo:"]').filter({ hasText: `Order 500 stickers ${STAMP}` });
  const whoId = textId.replace("todos-text-", "todos-who-");
  await page.getByTestId(whoId).click();
  await page.getByTestId(`${whoId}-input`).selectOption({ label: "Hugo" });
  await expect(item).toBeVisible();
  await expect(item.getByText("Hugo", { exact: true })).toBeVisible();
  await expect(our.getByText(`Order more stickers ${STAMP}`)).toHaveCount(0);
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
  expect([...before.slice(0, 2)].sort()).toEqual(["booking", "pinned"]); // (swapped already when a retry finds the first attempt's order)
  const after = [before[1], before[0], ...before.slice(2)];
  await page.getByTestId(`todos-col-grip-${before[1]}`).dragTo(page.getByTestId(`todos-col-${before[0]}`));
  await expect.poll(keys).toEqual(after);
  await page.reload();
  await expect.poll(keys).toEqual(after);
});
