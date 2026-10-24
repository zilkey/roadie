import { test, expect, type Page } from "@playwright/test";
import { A, ARTIST_SLUG } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
}

test("admin signs in and sees 5 tabs", async ({ page }) => {
  await signInAs(page, "jeff");
  await expect(page).toHaveURL(new RegExp(`/artists/${ARTIST_SLUG}/home$`)); // sign-in lands in your artist
  await expect(page.getByTestId("current-artist")).toHaveText("Ingrid Avison Band");
  await expect(page.getByTestId("topbar").getByTestId(/^tab-/)).toHaveCount(5);
  await expect(page.getByTestId("tab-booking")).toBeVisible();
  await expect(page.getByTestId("tab-money")).toHaveText("Money");
  await page.getByTestId("tab-booking").click();
  await expect(page).toHaveURL(new RegExp(`/artists/${ARTIST_SLUG}/booking$`));
  await expect(page.getByTestId("page-title")).toHaveText("Booking");
});

test("admin: phone layout uses bottom tabs", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, "ingrid");
  await expect(page.getByTestId("bottom-tabs").getByTestId(/^mtab-/)).toHaveCount(5);
  await expect(page.getByTestId("topbar")).toBeHidden();
});

test("admin edits artist configurations", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/admin/artist"));
  await expect(page.getByTestId("config-trio")).toBeVisible();
  await expect(page.getByTestId("artist-save")).toHaveCount(0); // autosave: no Save button
  await expect(page.getByText("Add gear")).toHaveCount(0); // gear lives on each show, not here
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
  await expect(page.getByTestId("topbar").getByTestId(/^tab-/)).toHaveCount(4);
  await expect(page.getByTestId("tab-booking")).toHaveCount(0);
  await expect(page.getByTestId("tab-money")).toHaveText("My money");
  await page.goto(A("/booking"));
  await expect(page).toHaveURL(/\/home$/);
  await page.goto(A("/admin/people"));
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId("band-setup")).toHaveCount(0);
});

test("uninvited email is turned away", async ({ page }) => {
  await signInAs(page, "stranger");
  await expect(page).toHaveURL(/\/not-invited$/);
  await expect(page.getByTestId("not-invited")).toContainText("stranger@example.com");
  await page.goto(A("/home"));
  await expect(page).toHaveURL(/\/signin$/);
});

test("old URLs and / open the same page in your artist", async ({ page }) => {
  await signInAs(page, "jeff");
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/shows");
  await expect(page).toHaveURL(new RegExp(`${A("/shows")}$`));
  await page.goto("/songs?seg=setlists");
  await expect(page).toHaveURL(new RegExp(`${A("/songs")}\\?seg=setlists$`));
  await page.goto("/admin/people");
  await expect(page).toHaveURL(new RegExp(`${A("/admin/people")}$`));
  await expect(page.getByTestId("page-title")).toHaveText("People");
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`${A("/home")}$`));
});

test("a band you don't belong to is refused", async ({ page }) => {
  await signInAs(page, "david");
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/artists/someone-elses-band/home");
  await expect(page.getByTestId("not-member")).toBeVisible();
  await expect(page.getByTestId("topbar")).toHaveCount(0);
  await page.getByTestId("to-my-artists").click();
  await expect(page).toHaveURL(new RegExp(`${A("/home")}$`));
});

test("settings: Artist comes before People; the artist's web address is validated and can be changed", async ({ page }) => {
  await signInAs(page, "jeff");
  await expect(page).toHaveURL(/\/home$/);
  await page.getByTestId("account-menu").click(); // Settings lives in the avatar menu
  await expect(page.getByTestId(/^side-admin-/)).toHaveText(["Artist", "People", "Claude Code", "History"]);
  await page.getByTestId("side-admin-artist").click();
  await expect(page).toHaveURL(new RegExp(`${A("/admin/artist")}$`));
  const slug = page.getByTestId("artist-slug");
  await expect(slug).toHaveValue(ARTIST_SLUG);
  await slug.fill("bad--slug");
  await expect(page.getByTestId("artist-slug-hint")).toContainText("single hyphens");
  await expect(page.getByTestId("artist-slug-save")).toBeDisabled();
  await slug.fill("ingrid-test");
  await page.getByTestId("artist-slug-save").click();
  await expect(page).toHaveURL(/\/artists\/ingrid-test\/admin\/artist$/);
  await expect(page.getByTestId("config-trio")).toBeVisible();
  await page.getByTestId("tab-shows").click();
  await expect(page).toHaveURL(/\/artists\/ingrid-test\/shows$/);
  // put it back for the other tests
  await page.goto("/artists/ingrid-test/admin/artist");
  await page.getByTestId("artist-slug").fill(ARTIST_SLUG);
  await page.getByTestId("artist-slug-save").click();
  await expect(page).toHaveURL(new RegExp(`${A("/admin/artist")}$`));
  await page.goto("/artists/ingrid-test/home");
  await expect(page.getByTestId("not-member")).toBeVisible(); // the old address is gone
});
