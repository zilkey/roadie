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
  await expect(page.getByTestId("sidebar").getByTestId(/^tab-/)).toHaveCount(5);
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
  await expect(page.getByTestId("sidebar")).toBeHidden();
});

test("admin adds a musician, a sub, and a user by email", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/admin/people"));
  await page.getByTestId("musician-name").fill("Riley Sub");
  await page.getByTestId("musician-add").click();
  await expect(page.getByTestId("musician-Riley Sub")).toContainText("no login");
  // an existing musician autosaves
  await page.getByTestId("musician-Riley Sub").getByTestId("musician-edit").click();
  await page.getByTestId("musician-edit-phone").fill("303-555-0100");
  await expect(page.getByTestId("musician-Riley Sub").getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("musician-Riley Sub")).toContainText("303-555-0100");
  // Members & logins: one form makes a band member, a login, or both
  const email = `newbie${Date.now()}@example.com`;
  await expect(page.getByTestId("add-user").getByLabel("Email")).toHaveAttribute("placeholder", "Email");
  await expect(page.getByTestId("user-instruments")).toHaveCount(0);
  await expect(page.getByTestId("user-role")).toHaveCount(0);
  await page.getByTestId("user-name").fill("New Bie");
  await page.getByTestId("user-email").fill(email);
  await page.getByTestId("user-band-member").check();
  await page.getByTestId("user-instruments").fill("banjo, vocals");
  await page.getByTestId("user-invite").check();
  await expect(page.getByTestId("user-role").locator("option")).toHaveText(["Member", "Admin", "AI"]);
  await expect(page.getByTestId("add-user").getByTestId("draft-status")).toHaveText("Draft saved");
  await page.reload();
  await expect(page.getByTestId("user-email")).toHaveValue(email); // the add form is a draft
  await expect(page.getByTestId("user-instruments")).toHaveValue("banjo, vocals");
  await expect(page.getByTestId(`person-${email}`)).toHaveCount(0); // nothing is created until Add
  await page.getByTestId("user-add").click();
  const row = page.getByTestId(`person-${email}`);
  await expect(row.getByTestId("person-role-chip")).toHaveText("member");
  await expect(row.getByTestId("person-band-member")).toBeChecked();
  await expect(row.getByTestId("person-invite")).toBeChecked();
  await expect(row.getByTestId("person-instruments")).toHaveValue("banjo, vocals");
  // role changes save on the spot, with status
  await row.getByLabel("Role").selectOption("admin");
  await expect(row.getByTestId("person-login").getByTestId("save-status")).toHaveText("Saved");
  await expect(row.getByTestId("person-role-chip")).toHaveText("admin");
  // instruments edit in place
  await row.getByTestId("person-instruments").fill("banjo");
  await expect(row.getByTestId("person-musician").getByTestId("save-status")).toHaveText("Saved");
  // a band member without a login, invited afterwards with an explicit Invite
  const subName = `Bandie ${Date.now()}`;
  await page.getByTestId("user-name").fill(subName);
  await page.getByTestId("user-band-member").check();
  await page.getByTestId("user-instruments").fill("drums");
  await page.getByTestId("user-add").click();
  const sub = page.getByTestId(`person-${subName}`);
  await expect(sub.getByTestId("person-band-member")).toBeChecked();
  await expect(sub.getByTestId("person-invite")).not.toBeChecked();
  await sub.getByTestId("person-invite").check();
  const subEmail = `bandie${Date.now()}@example.com`;
  await sub.getByTestId("person-invite-email").fill(subEmail);
  await sub.getByTestId("person-invite-role").selectOption("ai");
  await sub.getByTestId("person-send-invite").click();
  const invited = page.getByTestId(`person-${subEmail}`);
  await expect(invited.getByTestId("person-role-chip")).toHaveText("ai");
  await expect(invited.getByTestId("person-mcp")).toHaveCount(0); // an ai login always has AI access
  await expect(invited.getByTestId("person-instruments")).toHaveValue("drums");
  // duplicate invite is refused with a readable error
  await page.getByTestId("user-name").fill("Again");
  await page.getByTestId("user-email").fill(email);
  await page.getByTestId("user-invite").check();
  await page.getByTestId("user-add").click();
  await expect(page.getByTestId("error")).toContainText("already");
});

test("admin edits artist configurations", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/admin/artist"));
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
  await page.goto(A("/booking"));
  await expect(page).toHaveURL(/\/home$/);
  await page.goto(A("/admin/users"));
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
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
  await page.getByTestId("to-my-artists").click();
  await expect(page).toHaveURL(new RegExp(`${A("/home")}$`));
});

test("settings: Artist comes before People; the artist's web address is validated and can be changed", async ({ page }) => {
  await signInAs(page, "jeff");
  await expect(page).toHaveURL(/\/home$/);
  await page.getByTestId("settings-toggle").click();
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
