import { test, expect, type Page } from "@playwright/test";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

// e2e runs against the fakes with GOOGLE_OAUTH_CLIENT_ID blank, so there is no fake OAuth server to round-trip Continue with
// Google through; the connect itself (signed state, returnTo) is covered in tests/unit/google.test.ts. These cover what the
// fakes can: the connect screen, Skip, and the setup screen's folder and calendar cards against the fake Drive and Calendar.
test("Connect Google says when Google isn't set up here, and Skip for now goes to Ready", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto("/artists/ingrid-avison-band/welcome/google");
  await expect(page.getByTestId("google-not-configured")).toBeVisible();
  await page.getByTestId("google-skip").click();
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByTestId("welcome")).toBeVisible();
});

test("Setup: pick a band folder and a band calendar, Finish later lands on Ready, Settings › Google shows the same", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto("/artists/ingrid-avison-band/welcome/google/setup");
  const folder = page.getByTestId("google-band-folder");
  await expect(folder.getByTestId("band-folder-link")).toContainText("Ingrid Avison Band");
  await folder.getByTestId("band-folder-change").click();
  await folder.getByTestId("band-folder-q").fill("Ingrid");
  await folder.getByTestId("band-folder-search").click();
  await expect(folder.getByTestId("band-folder-hit-Ingrid Avison Band").getByTestId("band-folder-choose")).toHaveText("Current");
  await folder.getByTestId("band-folder-cancel").click();

  const cal = page.getByTestId("google-calendar");
  await expect(cal.getByTestId("calendar-hit-Boulder Venues (view only)").getByTestId("calendar-choose")).toBeDisabled();
  await cal.getByTestId("calendar-hit-Ingrid Avison Band").getByTestId("calendar-choose").check();
  await cal.getByTestId("calendar-save").click();
  await expect(cal.getByTestId("calendar-note")).toContainText("saved");

  await page.getByTestId("google-finish-later").click();
  await expect(page.getByTestId("welcome")).toBeVisible();

  await page.goto("/artists/ingrid-avison-band/admin/google");
  await expect(page.getByTestId("google-band-folder").getByTestId("band-folder-link")).toContainText("Ingrid Avison Band");
  await expect(page.getByTestId("calendar-name")).toHaveText("Ingrid Avison Band");
});
