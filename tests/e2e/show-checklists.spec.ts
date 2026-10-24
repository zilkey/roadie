import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
}
async function openHiDive(page: Page, query = "") {
  await page.goto(A("/shows"));
  await page.getByText("Hi-Dive").first().click();
  await expect(page.getByTestId("show-page")).toBeVisible();
  if (query) await page.goto(page.url().split("?")[0] + query);
  return page.getByTestId("checklists");
}
/** The card of the list with this exact name. */
const card = (page: Page, name: string) =>
  page.locator('section[data-testid^="checklist-"]').filter({ has: page.getByRole("heading", { name, exact: true }) });
const listId = async (c: ReturnType<typeof card>) => (await c.getAttribute("data-testid"))!.replace("checklist-", "");

test("the checklists sit beside the tabs: no Prep tab, count in the sidebar header, on both tabs", async ({ page }) => {
  await signInAs(page, "jeff");
  const side = await openHiDive(page, "?tab=prep");
  await expect(page.getByTestId("show-tab-prep")).toHaveCount(0);
  await expect(page.getByTestId("where-when")).toBeVisible(); // ?tab=prep falls back to Show Details
  await expect(side.getByTestId("checklists-count")).toHaveText(/^\d+ of \d+$/);
  await expect(card(page, "Promo").getByRole("button", { name: "Update template" })).toBeVisible();
  await expect(card(page, "Load-out").getByRole("button", { name: "Save as template" })).toBeVisible();
  await page.getByTestId("show-tab-finances").click();
  await expect(page.getByTestId("checklists")).toBeVisible();

  // desktop: a 600px column against the right edge; the main column takes the rest
  await page.setViewportSize({ width: 1920, height: 900 });
  const box = await page.locator("aside.show-side").boundingBox();
  expect(Math.round(box!.width)).toBe(600);
  await expect(page.getByTestId("manage-templates")).toHaveAttribute("href", /\/admin\/artist#checklist-templates$/);
  // phone: full width, under the tab's cards and above Comments
  await page.setViewportSize({ width: 390, height: 900 });
  const side2 = await page.locator("aside.show-side").boundingBox();
  const comments = await page.getByTestId("comments").boundingBox();
  expect(side2!.y).toBeLessThan(comments!.y);
});

test("an admin adds a list from a template, works its to-dos in place, renames and deletes it", async ({ page }) => {
  await signInAs(page, "jeff");
  await openHiDive(page);
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

  await c.getByRole("checkbox", { name: "Done: Bring the big banner" }).check();
  await expect(c.getByTestId(`checklist-count-${id}`)).toHaveText("1 of 2");

  // × removes an item; so does saving it empty
  await c.getByRole("button", { name: "Remove Post on social media" }).click();
  await expect(c.getByTestId(`checklist-count-${id}`)).toHaveText("1 of 1");

  await c.getByTestId(`checklist-${id}-actions`).click();
  await page.getByTestId(`checklist-${id}-menu-rename`).click();
  await c.getByTestId(`checklist-rename-${id}`).fill("E2E Follow-up");
  await c.getByTestId(`checklist-rename-${id}`).press("Enter");
  const renamed = card(page, "E2E Follow-up");
  await expect(renamed).toBeVisible();

  page.once("dialog", (d) => void d.accept());
  await renamed.getByTestId(`checklist-${id}-actions`).click();
  await page.getByTestId(`checklist-${id}-menu-delete`).click();
  await expect(card(page, "E2E Follow-up")).toHaveCount(0);
});

test("a blank list starts at its name, then its first to-do; lists reorder in their own edit mode", async ({ page }) => {
  await signInAs(page, "jeff");
  const side = await openHiDive(page);
  await side.getByTestId("new-list-actions").click();
  await side.getByTestId("new-list-menu-blank").click();
  await expect(side.getByTestId("new-list-name")).toBeFocused();
  await side.getByTestId("new-list-name").press("Escape");
  await expect(side.getByTestId("new-list-name")).toHaveCount(0);
  await side.getByTestId("new-list-actions").click();
  await side.getByTestId("new-list-menu-blank").click();
  await side.getByTestId("new-list-name").fill("E2E Blank");
  await side.getByTestId("new-list-name").press("Enter");
  const c = card(page, "E2E Blank");
  const id = await listId(c);
  await expect(c.getByTestId(`checklist-add-${id}`)).toBeFocused();

  // the page's Edit leaves the sidebar alone
  await page.getByTestId("show-edit").click();
  await expect(side).not.toHaveAttribute("data-reordering", "1");
  await page.reload();

  await page.getByTestId("checklists-edit").click();
  const reorder = page.getByTestId("checklists");
  await expect(reorder).toHaveAttribute("data-reordering", "1");
  await expect(reorder.getByTestId(`reorder-down-${id}`)).toBeDisabled();
  await reorder.getByTestId(`reorder-up-${id}`).click();
  await reorder.getByTestId("reorder-save").click();
  await expect(page.getByTestId("checklists")).not.toHaveAttribute("data-reordering", "1");
  const titles = await page.locator('[data-testid^="checklist-title-"]').allTextContents();
  expect(titles.indexOf("E2E Blank")).toBe(titles.length - 2);

  page.once("dialog", (d) => void d.accept());
  await c.getByTestId(`checklist-${id}-actions`).click();
  await page.getByTestId(`checklist-${id}-menu-delete`).click();
  await expect(card(page, "E2E Blank")).toHaveCount(0);
});

test("a member ticks, adds and removes to-dos but can't change the lists", async ({ page }) => {
  await signInAs(page, "david");
  const side = await openHiDive(page);
  await expect(side.getByTestId("new-list-actions")).toHaveCount(0);
  await expect(side.getByTestId("manage-templates")).toHaveCount(0);
  await expect(side.getByTestId("checklists-edit")).toHaveCount(0);
  await expect(side.locator('[data-testid$="-actions"]')).toHaveCount(0);
  await expect(side.getByRole("button", { name: /template/ })).toHaveCount(0);

  const c = card(page, "Load-out");
  const id = await listId(c);
  const box = c.getByRole("checkbox", { name: "Done: Get paid before leaving" }); // Jeff's, not David's
  await box.check();
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect(box).not.toBeChecked();

  await c.getByTestId(`checklist-add-${id}`).fill("E2E spare strings");
  await c.getByTestId(`checklist-add-owner-${id}`).selectOption({ label: "David" });
  await c.getByTestId(`checklist-add-btn-${id}`).click();
  await expect(c.getByText("E2E spare strings")).toBeVisible();
  await c.getByText("E2E spare strings").click();
  await c.getByTestId("checklist-edit-input").fill("");
  await c.getByTestId("checklist-edit-input").press("Enter");
  await expect(c.getByText("E2E spare strings")).toHaveCount(0);
});

test("checklist templates live in Artist settings: add one, give it items, use it on a show, delete it", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/admin/artist#checklist-templates"));
  const section = page.getByTestId("checklist-templates");
  await expect(section).toContainText("These show up as “New list” options on every show.");
  await section.getByTestId("new-template").click();
  await section.getByTestId("new-template-name").fill("E2E Soundcheck");
  await section.getByTestId("new-template-add").click();
  const t = section.locator('[data-testid^="template-"]').filter({ has: page.locator('input[value="E2E Soundcheck"]') });
  await expect(t).toBeVisible();
  const tid = (await t.getAttribute("data-testid"))!.replace("template-", "");
  const add = t.getByTestId(`template-add-item-${tid}`);
  await add.fill("Line check");
  await add.press("Enter");
  await expect(add).toBeFocused();
  await add.fill("Monitor mix");
  await add.press("Enter");
  await expect(t.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  await page.reload();
  await expect(page.getByTestId(`template-item-${tid}-1`)).toHaveValue("Monitor mix");

  await openHiDive(page);
  await page.getByTestId("new-list-actions").click();
  await expect(page.getByTestId(`new-list-menu-template-${tid}`)).toHaveText("E2E Soundcheck");

  await page.goto(A("/admin/artist#checklist-templates"));
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId(`template-delete-${tid}`).click();
  await expect(page.getByTestId(`template-${tid}`)).toHaveCount(0);
});
