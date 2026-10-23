import { test, expect, type Page } from "@playwright/test";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
}

test("admin signs in and sees 5 tabs", async ({ page }) => {
  await signInAs(page, "jeff");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId("sidebar").getByTestId(/^tab-/)).toHaveCount(5);
  await expect(page.getByTestId("tab-booking")).toBeVisible();
  await expect(page.getByTestId("tab-money")).toHaveText("Money");
  await page.getByTestId("tab-booking").click();
  await expect(page).toHaveURL(/\/booking$/);
  await expect(page.getByTestId("page-title")).toHaveText("Booking");
});

test("admin: phone layout uses bottom tabs", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, "ingrid");
  await expect(page.getByTestId("bottom-tabs").getByTestId(/^mtab-/)).toHaveCount(5);
  await expect(page.getByTestId("sidebar")).toBeHidden();
});

test("admin adds a musician, a sub, and a user by email", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("band-setup").getByTestId("admin-musicians").click();
  await page.getByTestId("musician-name").fill("Riley Sub");
  await page.getByTestId("musician-add").click();
  await expect(page.getByTestId("musician-Riley Sub")).toContainText("no login");
  // an existing musician autosaves
  await page.getByTestId("musician-Riley Sub").getByTestId("musician-edit").click();
  await page.getByTestId("musician-edit-phone").fill("303-555-0100");
  await expect(page.getByTestId("musician-Riley Sub").getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("musician-Riley Sub")).toContainText("303-555-0100");
  await page.goto("/admin/users");
  const email = `newbie${Date.now()}@example.com`;
  await page.getByTestId("user-email").fill(email);
  await page.getByTestId("user-name").fill("New Bie");
  await expect(page.getByTestId("draft-status")).toHaveText("Draft saved");
  await page.reload();
  await expect(page.getByTestId("user-email")).toHaveValue(email); // the add form is a draft
  await page.getByTestId("user-add").click();
  await expect(page.getByTestId(`user-${email}`)).toContainText("member");
  // role changes save on the spot, with status
  await page.getByTestId(`user-${email}`).getByLabel("Role").selectOption("admin");
  await expect(page.getByTestId(`user-${email}`).getByTestId("save-status")).toHaveText("Saved");
  await expect(page.getByTestId(`user-${email}`)).toContainText("admin");
  // duplicate invite is refused with a readable error
  await page.getByTestId("user-email").fill(email);
  await page.getByTestId("user-name").fill("Again");
  await page.getByTestId("user-add").click();
  await expect(page.getByTestId("error")).toContainText("already");
});

test("admin edits artist configurations", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto("/admin/artist");
  await expect(page.getByTestId("config-trio")).toBeVisible();
  await expect(page.getByTestId("artist-save")).toHaveCount(0); // autosave: no Save button
  await page.getByTestId("artist-name").fill("Ingrid Avison Band Test");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("artist-name")).toHaveValue("Ingrid Avison Band Test");
  await page.getByTestId("artist-name").fill("Ingrid Avison Band");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  // a new configuration is a draft until Add
  await page.getByTestId("add-config").click();
  await page.getByTestId("new-config-name").fill("Quartet");
  await expect(page.getByTestId("draft-status")).toHaveText("Draft saved");
  await page.reload();
  await expect(page.getByTestId("new-config-name")).toHaveValue("Quartet");
  await page.getByTestId("new-config-add").click();
  await expect(page.getByTestId("config-quartet")).toBeVisible();
});

test("member sees 4 tabs, 'My money', and cannot open /booking or admin pages", async ({ page }) => {
  await signInAs(page, "david");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId("sidebar").getByTestId(/^tab-/)).toHaveCount(4);
  await expect(page.getByTestId("tab-booking")).toHaveCount(0);
  await expect(page.getByTestId("tab-money")).toHaveText("My money");
  await page.goto("/booking");
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId("band-setup")).toHaveCount(0);
});

test("uninvited email is turned away", async ({ page }) => {
  await signInAs(page, "stranger");
  await expect(page).toHaveURL(/\/not-invited$/);
  await expect(page.getByTestId("not-invited")).toContainText("stranger@example.com");
  await page.goto("/home");
  await expect(page).toHaveURL(/\/signin$/);
});
