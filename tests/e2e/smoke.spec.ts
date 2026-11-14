import { test, expect, type Page } from "@playwright/test";
import { A, ARTIST_SLUG, openTab } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
}

test("admin signs in and reaches Money and Booking from the bar", async ({ page }) => {
  await signInAs(page, "rudy");
  await expect(page).toHaveURL(new RegExp(`/artists/${ARTIST_SLUG}/calendar$`)); // sign-in lands on your artist's calendar
  await expect(page.getByTestId("current-artist")).toHaveText("Nora Quill Band");
  // How many tabs fit is measured (Shell.tsx), so the exact count and Money's place are not asserted: Booking and Tours always fit.
  await expect(page.getByTestId("tab-booking")).toBeVisible();
  await expect(page.getByTestId("tab-tours")).toBeVisible();
  // Email templates starts hidden, so it is tucked into More
  await page.getByTestId("more-toggle").click();
  await expect(page.getByTestId("more-templates")).toHaveText("Email templates");
  await page.keyboard.press("Escape");
  await openTab(page, "money");
  await expect(page).toHaveURL(new RegExp(`/artists/${ARTIST_SLUG}/money$`));
  await expect(page.getByTestId("page-title")).toHaveText("Money");
  await page.getByTestId("tab-booking").click();
  await expect(page).toHaveURL(new RegExp(`/artists/${ARTIST_SLUG}/booking$`));
  await expect(page.getByTestId("page-title")).toHaveText("Ongoing"); // Booking opens on Ongoing (#82 Q1)
});

test("admin: phone layout uses bottom tabs", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, "nora");
  await expect(page.getByTestId("bottom-tabs")).toBeVisible();
  await expect(page.getByTestId("topbar")).toBeHidden();
  // the phone bar has no band menu: an admin reaches Artist settings from the three-dot menu
  await page.getByTestId("account-menu-mobile").click();
  await page.getByTestId("artist-settings-mobile").click();
  await expect(page).toHaveURL(new RegExp(`${A("/admin/artist")}$`));
});

test("member sees Tours and Rehearsals, 'My money' in More, and cannot open /booking or admin pages", async ({ page }) => {
  await signInAs(page, "hugo");
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByTestId("tab-booking")).toHaveCount(0);
  await expect(page.getByTestId("tab-tours")).toBeVisible();
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
