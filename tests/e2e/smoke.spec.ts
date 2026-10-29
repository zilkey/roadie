import { test, expect, type Page } from "@playwright/test";
import { A, ARTIST_SLUG, openTab } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
}

test("admin signs in and sees 5 tabs", async ({ page }) => {
  await signInAs(page, "jeff");
  await expect(page).toHaveURL(new RegExp(`/artists/${ARTIST_SLUG}/calendar$`)); // sign-in lands on your artist's calendar
  await expect(page.getByTestId("current-artist")).toHaveText("Ingrid Avison Band");
  await expect(page.getByTestId("topbar").getByTestId(/^tab-/)).toHaveCount(5);
  await expect(page.getByTestId("tab-booking")).toBeVisible();
  await expect(page.getByTestId("tab-money")).toHaveText("Money");
  // Email templates starts hidden, so it is tucked into More
  await page.getByTestId("more-toggle").click();
  await expect(page.getByTestId("more-templates")).toHaveText("Email templates");
  await page.keyboard.press("Escape");
  await openTab(page, "money");
  await expect(page).toHaveURL(new RegExp(`/artists/${ARTIST_SLUG}/money$`));
  await expect(page.getByTestId("page-title")).toHaveText("Money");
  await page.getByTestId("tab-booking").click();
  await expect(page).toHaveURL(new RegExp(`/artists/${ARTIST_SLUG}/booking$`));
  await expect(page.getByTestId("page-title")).toHaveText("Booking");
});

test("admin: phone layout uses bottom tabs", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, "ingrid");
  await expect(page.getByTestId("bottom-tabs").getByTestId(/^mtab-/)).toHaveCount(5);
  await expect(page.getByTestId("topbar")).toBeHidden();
  // the phone bar has no band menu: an admin reaches Artist settings from the three-dot menu
  await page.getByTestId("account-menu-mobile").click();
  await page.getByTestId("artist-settings-mobile").click();
  await expect(page).toHaveURL(new RegExp(`${A("/admin/artist")}$`));
});

test("settings: General edits the artist name", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await signInAs(page, "jeff");
  await expect(page).toHaveURL(/\/calendar$/);
  await page.getByTestId("band-menu").click(); // Artist settings lives in the band menu
  await page.getByTestId("band-menu-settings").click();
  await expect(page).toHaveURL(new RegExp(`${A("/admin/artist")}$`));
  // name and address are read-only until Edit, then saved with Save
  await expect(page.getByTestId("artist-name")).toHaveCount(0);
  await page.getByTestId("artist-edit").click();
  await page.getByTestId("artist-name").fill("Ingrid Avison Band Test");
  await page.getByTestId("artist-save").click();
  await expect(page.getByTestId("artist-name-value")).toHaveText("Ingrid Avison Band Test");
  await page.reload();
  await expect(page.getByTestId("artist-name-value")).toHaveText("Ingrid Avison Band Test");
  await page.getByTestId("artist-edit").click();
  await page.getByTestId("artist-name").fill("Ingrid Avison Band");
  await page.getByTestId("artist-save").click();
  await expect(page.getByTestId("artist-name-value")).toHaveText("Ingrid Avison Band");

  // checklist templates: add one with an item, see it after a reload, delete it
  const section = page.getByTestId("checklist-templates");
  await section.getByTestId("new-template").click();
  await page.getByTestId("new-template-name").fill("E2E Soundcheck");
  await page.getByTestId("new-template-add").click();
  const card = section.locator('[data-testid^="template-"]', { has: page.locator('input[value="E2E Soundcheck"]') }).first();
  await expect(card).toBeVisible();
  await card.locator('input[data-testid^="template-add-item-"]').fill("Line check");
  await page.keyboard.press("Enter");
  await expect(card.locator('input[data-testid^="template-item-"]').first()).toHaveValue("Line check");
  await expect(card.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  await page.reload();
  const saved = page.getByTestId("checklist-templates").locator('[data-testid^="template-"]', { has: page.locator('input[value="E2E Soundcheck"]') }).first();
  await expect(saved).toBeVisible();
  await expect(saved.locator('input[data-testid^="template-item-"]').first()).toHaveValue("Line check");
  await saved.getByRole("button", { name: "Delete E2E Soundcheck" }).click();
  await expect(page.locator('input[value="E2E Soundcheck"]')).toHaveCount(0);
});

test("member sees 4 tabs with Rehearsals, 'My money' in More, and cannot open /booking or admin pages", async ({ page }) => {
  await signInAs(page, "david");
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByTestId("topbar").getByTestId(/^tab-/)).toHaveCount(4);
  await expect(page.getByTestId("tab-booking")).toHaveCount(0);
  await expect(page.getByTestId("tab-rehearsals")).toBeVisible();
  await expect(page.getByTestId("tab-money")).toHaveCount(0);
  await page.getByTestId("more-toggle").click(); await expect(page.getByTestId("more-money")).toHaveText("My money"); await page.keyboard.press("Escape");
  await page.goto(A("/booking"));
  await expect(page).toHaveURL(/\/calendar$/);
  await page.goto(A("/booking/templates"));
  await expect(page).toHaveURL(/\/calendar$/);
  await page.goto(A("/admin/people"));
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByTestId("band-setup")).toHaveCount(0);
  await expect(page.getByTestId("roadie-panel")).toHaveCount(0);
  // a band you don't belong to is refused
  await page.goto("/artists/someone-elses-band/calendar");
  await expect(page.getByTestId("not-member")).toBeVisible();
  await expect(page.getByTestId("topbar")).toHaveCount(0);
  await page.getByTestId("to-my-artists").click();
  await expect(page).toHaveURL(new RegExp(`${A("/calendar")}$`));
});
