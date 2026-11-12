import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
/** The card of the template with this exact name, on the tab showing. Other specs share the seeded templates, so these tests only touch their own. */
const card = (page: Page, name: string) =>
  page.getByTestId("template-list").locator("li").filter({ has: page.getByRole("button", { name: `Rename ${name}`, exact: true }) });
async function newTemplate(page: Page, button: string, name: string) {
  await page.getByTestId("new-template").click();
  await expect(page.getByTestId("new-template")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: button })).toBeVisible();
  await page.getByTestId("new-template-name").fill(name);
  await page.getByTestId("new-template-add").click();
  await expect(card(page, name)).toBeVisible();
}

test("checklist templates: add one with an item, see it after a reload, delete it", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  const name = `E2E Soundcheck ${Date.now()}`;
  await signInAs(page, "rudy");
  await page.goto(A("/admin/checklists"));
  await expect(page.getByTestId("page-title")).toHaveText("Checklist templates");
  await expect(page.getByTestId("settings-nav-checklists")).toHaveAttribute("aria-current", "page");
  await newTemplate(page, "New show template", name);
  const c = card(page, name);
  await c.getByRole("textbox", { name: `Add an item to ${name}` }).fill("Line check");
  await page.keyboard.press("Enter");
  await expect(c.getByRole("textbox", { name: "Item" }).first()).toHaveValue("Line check");
  await expect(c.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  await expect(c).toContainText("1 item");

  await page.reload();
  const saved = card(page, name);
  await expect(saved).toContainText("1 item");
  await saved.getByRole("button", { name: `Expand ${name}` }).click();
  await expect(saved.getByRole("textbox", { name: "Item" }).first()).toHaveValue("Line check");

  // Rename from the menu: the name turns into a field, autosaved
  const byId = page.getByTestId((await saved.getAttribute("data-testid"))!);
  await byId.getByRole("button", { name: `${name} menu` }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await byId.getByRole("textbox", { name: "Template name" }).fill(`${name} 2`);
  await page.keyboard.press("Enter");
  await expect(byId.getByRole("button", { name: `Rename ${name} 2`, exact: true })).toBeVisible();
  await expect(byId.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  await page.reload();
  await expect(card(page, `${name} 2`)).toBeVisible();

  await card(page, `${name} 2`).getByRole("button", { name: `${name} 2 menu` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(card(page, `${name} 2`)).toHaveCount(0);
});

test("checklist templates: tabs by kind in ?tab, New makes one on the tab, Move to moves it", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  const name = `E2E Kinds ${Date.now()}`;
  await signInAs(page, "rudy");
  // Artist settings nav, then the Shows tab by default
  await page.goto(A("/admin/artist"));
  await expect(page.getByTestId("checklist-templates")).toHaveCount(0); // no longer in General
  await page.getByTestId("settings-nav-checklists").click();
  await expect(page).toHaveURL(new RegExp(`${A("/admin/checklists")}$`));
  const tab = (k: string) => page.getByTestId(`template-tab-${k}`);
  await expect(tab("show")).toHaveAttribute("aria-selected", "true");
  await expect(tab("show")).toHaveText(/^Shows \(\d+\)$/);
  await expect(tab("release")).toHaveText(/^Releases \(\d+\)$/);
  await expect(tab("social")).toHaveText(/^Social media \(\d+\)$/);

  // The Releases tab: in the URL, its own New button
  await tab("release").click();
  await expect(page).toHaveURL(/\/admin\/checklists\?tab=release$/);
  await expect(tab("release")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("new-template")).toHaveText("New release template");
  await newTemplate(page, "New release template", name);

  // Move to Social media: it leaves Releases and shows on Social media
  await card(page, name).getByRole("button", { name: `${name} menu` }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Rename", "Move to Shows", "Move to Social media", "Delete"]);
  await page.getByRole("menuitem", { name: "Move to Social media" }).click();
  await expect(card(page, name)).toHaveCount(0);
  await tab("social").click();
  await expect(page).toHaveURL(/\?tab=social$/);
  await expect(page.getByTestId("new-template")).toHaveText("New social media template");
  await expect(card(page, name)).toBeVisible();

  // A link straight to a tab opens it (the show page's "Manage templates" links to ?tab=show)
  await page.goto(A("/admin/checklists?tab=social"));
  await expect(tab("social")).toHaveAttribute("aria-selected", "true");
  await card(page, name).getByRole("button", { name: `${name} menu` }).click();
  await page.getByRole("menuitem", { name: "Move to Shows" }).click();
  await expect(card(page, name)).toHaveCount(0);
  await tab("show").click();
  await expect(page).toHaveURL(/\?tab=show$/);
  await card(page, name).getByRole("button", { name: `${name} menu` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(card(page, name)).toHaveCount(0);
});
