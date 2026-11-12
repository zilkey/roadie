import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
/** The seeded Deep End show (Nov 14): other specs add Deep End shows, so match the date too. Only the date cell links. */
async function openDeepEnd(page: Page) {
  await page.goto(A("/shows"));
  await page.getByTestId("shows-row").filter({ hasText: "Deep End" }).filter({ hasText: "Nov 14" }).first().locator("td.date a").click();
  await expect(page.getByTestId("show-page")).toBeVisible();
  return page.getByTestId("checklists");
}
/** The card of the list with this exact name. */
const card = (page: Page, name: string) =>
  page.locator('section[data-testid^="checklist-"]').filter({ has: page.getByRole("heading", { name, exact: true }) });
const listId = async (c: ReturnType<typeof card>) => (await c.getAttribute("data-testid"))!.replace("checklist-", "");

test("an admin adds a list from a template, works its to-dos in place, renames and deletes it", async ({ page }) => {
  await signInAs(page, "rudy");
  await openDeepEnd(page);
  await page.getByTestId("new-list-actions").click();
  await page.getByRole("menuitem", { name: "Follow Up", exact: true }).click();
  const c = card(page, "Follow Up");
  await expect(c).toBeVisible();
  const id = await listId(c);
  await expect(c.getByTestId(`checklist-count-${id}`)).toHaveText("0 of 1");
  await expect(c.getByText("Unassigned")).toBeVisible();

  const add = c.getByTestId(`checklist-add-${id}`);
  await add.fill("Bring the banner");
  await add.press("Enter");
  await expect(add).toBeFocused();
  await expect(add).toHaveValue("");
  await expect(c.getByTestId(`checklist-count-${id}`)).toHaveText("0 of 2");

  // click to edit: Enter saves, Esc cancels
  await c.getByText("Bring the banner").click();
  const input = c.getByTestId("checklist-edit-input");
  await input.fill("Bring the big banner");
  await input.press("Enter");
  await expect(c.getByText("Bring the big banner")).toBeVisible();
  await c.getByText("Bring the big banner").click();
  await c.getByTestId("checklist-edit-input").fill("Never mind");
  await c.getByTestId("checklist-edit-input").press("Escape");
  await expect(c.getByTestId("checklist-edit-input")).toHaveCount(0);
  await expect(c.getByText("Bring the big banner")).toBeVisible();

  const done = c.getByRole("checkbox", { name: "Done: Bring the big banner" });
  await done.click();
  await expect(done).toBeChecked();
  await expect(c.getByTestId(`checklist-count-${id}`)).toHaveText("1 of 2");

  // admins pin an open item to To Dos, and unpin it
  await c.getByRole("button", { name: "Pin Post on social media to To Dos" }).click();
  await expect(c.getByRole("button", { name: "Unpin Post on social media from To Dos" })).toBeVisible();
  await expect(c.getByText("On To Dos")).toBeVisible();
  await expect(c.getByRole("button", { name: /^Pin Bring the big banner/ })).toHaveCount(0); // done items have no pin

  // × removes an item; so does saving it empty
  await c.getByRole("button", { name: "Remove Post on social media" }).click();
  await expect(c.getByTestId(`checklist-count-${id}`)).toHaveText("1 of 1");

  await c.getByTestId(`checklist-${id}-actions`).click();
  await page.getByTestId(`checklist-${id}-menu-rename`).click();
  // renaming swaps the heading for the input, so `c` (found by its heading) no longer matches: use the card's id
  const rename = page.getByTestId(`checklist-${id}`).getByTestId(`checklist-rename-${id}`);
  await rename.fill("E2E Follow-up");
  await rename.press("Enter");
  const renamed = card(page, "E2E Follow-up");
  await expect(renamed).toBeVisible();

  page.once("dialog", (d) => void d.accept());
  await renamed.getByTestId(`checklist-${id}-actions`).click();
  await page.getByTestId(`checklist-${id}-menu-delete`).click();
  await expect(card(page, "E2E Follow-up")).toHaveCount(0);
});
