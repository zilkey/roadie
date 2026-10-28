import { test, expect, type Page } from "@playwright/test";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

// Dev and e2e run against the fakes (no GOOGLE_OAUTH_CLIENT_ID), so the page says Google isn't set up. The connect flow itself
// is covered by tests/unit/google.test.ts against a stubbed Google.
test("Settings > Google is in the admin sub-nav and says when Google isn't set up on the server", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("band-menu").click();
  await page.getByTestId("band-menu-settings").click();
  await page.getByTestId("settings-nav-google").click();
  await expect(page).toHaveURL(/\/admin\/google$/);
  await expect(page.getByTestId("page-title")).toHaveText("Google");
  await expect(page.getByTestId("google-not-configured")).toContainText("local fakes");
  await expect(page.getByTestId("settings-nav-google")).toHaveAttribute("aria-current", "page");
});

test("a Google callback that isn't signed by this server is refused", async ({ request }) => {
  const r = await request.get("/api/google/callback?code=x&state=forged.state", { maxRedirects: 0 });
  expect(r.status()).toBe(400);
});

// The seed's band folder is the fake Drive's "Ingrid Avison Band". Other specs rely on it, so this only re-saves that same folder.
test("Settings > Google shows the band folder; search finds folders, and a pasted folder link saves it", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("band-menu").click();
  await page.getByTestId("band-menu-settings").click();
  await page.getByTestId("settings-nav-google").click();
  const card = page.getByTestId("google-band-folder");
  await expect(card.getByTestId("band-folder-link")).toContainText("Ingrid Avison Band");
  await card.getByTestId("band-folder-change").click();
  await card.getByTestId("band-folder-q").fill("Charts");
  await card.getByTestId("band-folder-search").click();
  await expect(card.getByTestId("band-folder-hit-Charts")).toBeVisible();
  await card.getByTestId("band-folder-q").fill("https://drive.google.com/drive/folders/fake-band-folder?usp=sharing");
  await expect(card.getByTestId("band-folder-search")).toHaveText("Use link");
  await card.getByTestId("band-folder-search").click();
  await expect(card.getByTestId("band-folder-note")).toContainText("Band folder saved");
  await expect(card.getByTestId("band-folder-link")).toContainText("Ingrid Avison Band");
});

// The seed's band calendar is the fake Calendar's "Ingrid Avison Band". Other specs send events to it, so this doesn't change it.
test("Settings > Google shows the band calendar; Change lists your calendars (view-only ones can't be chosen); Check my access", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("band-menu").click();
  await page.getByTestId("band-menu-settings").click();
  await page.getByTestId("settings-nav-google").click();
  const card = page.getByTestId("google-calendar");
  await expect(card.getByTestId("calendar-name")).toHaveText("Ingrid Avison Band");
  await card.getByTestId("calendar-change").click();
  await expect(card.getByTestId("calendar-hit-Ingrid Avison Band").getByTestId("calendar-choose")).toHaveText("Current");
  await expect(card.getByTestId("calendar-hit-Boulder Venues (view only)")).toContainText("View only");
  await expect(card.getByTestId("calendar-hit-Boulder Venues (view only)").getByTestId("calendar-choose")).toBeDisabled();
  await expect(card.getByTestId("calendar-hit-Jeff Dean").getByTestId("calendar-choose")).toBeEnabled();
  await card.getByTestId("calendar-cancel").click();
  await card.getByTestId("calendar-check-access").click();
  await expect(card.getByTestId("calendar-check")).toContainText("can add events to Ingrid Avison Band");
});

// The seed's Charts folder is the fake Drive's "Charts" (inside the band folder). Copy to band folder copies into it.
test("Settings > Google shows the Charts folder, for lyrics and chord sheets", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("band-menu").click();
  await page.getByTestId("band-menu-settings").click();
  await page.getByTestId("settings-nav-google").click();
  const card = page.getByTestId("google-charts-folder");
  await expect(card.getByRole("heading")).toHaveText("Charts folder");
  await expect(card.getByTestId("charts-folder-link")).toContainText("Charts");
  await expect(card.getByTestId("charts-folder-status")).toContainText("Lyrics, chord sheets and other charts");
  await card.getByTestId("charts-folder-change").click();
  await card.getByTestId("charts-folder-q").fill("Charts");
  await card.getByTestId("charts-folder-search").click();
  await expect(card.getByTestId("charts-folder-hit-Charts").getByTestId("charts-folder-choose")).toHaveText("Current");
});

// The seed's Demos folder is the fake Drive's "Demos" (inside the band folder). Audio uploaded to a song goes there.
test("Settings > Google shows the Demos folder, for audio uploaded to songs", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("band-menu").click();
  await page.getByTestId("band-menu-settings").click();
  await page.getByTestId("settings-nav-google").click();
  const card = page.getByTestId("google-demos-folder");
  await expect(card.getByRole("heading")).toHaveText("Demos folder");
  await expect(card.getByTestId("demos-folder-link")).toContainText("Demos");
  await expect(card.getByTestId("demos-folder-status")).toContainText("audio uploaded to a song");
  await card.getByTestId("demos-folder-change").click();
  await card.getByTestId("demos-folder-q").fill("Demos");
  await card.getByTestId("demos-folder-search").click();
  await expect(card.getByTestId("demos-folder-hit-Demos").getByTestId("demos-folder-choose")).toHaveText("Current");
});

// The seed's Songwriting folder is the fake Drive's "Songwriting". Audio uploaded to a Writing song goes there.
test("Settings > Google shows the Songwriting folder, for audio uploaded to Writing songs", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("band-menu").click();
  await page.getByTestId("band-menu-settings").click();
  await page.getByTestId("settings-nav-google").click();
  const card = page.getByTestId("google-songwriting-folder");
  await expect(card.getByRole("heading")).toHaveText("Songwriting folder");
  await expect(card.getByTestId("songwriting-folder-link")).toContainText("Songwriting");
  await expect(card.getByTestId("songwriting-folder-status")).toContainText("Writing phase");
});

test("Settings > Google: the voice memo shortcut card makes a token (shown once), remembers it was made, and takes the Shortcut's iCloud link", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto("/artists/ingrid-avison-band/admin/google");
  const card = page.getByTestId("google-shortcut");
  await expect(card.getByTestId("shortcut-token-status")).toContainText("No token yet");
  await expect(card.getByTestId("shortcut-no-url")).toBeVisible();
  await card.getByTestId("shortcut-make-token").click();
  await expect(card.getByTestId("shortcut-token")).toContainText("rsk_");
  await expect(card.getByTestId("shortcut-recipe")).toContainText("/api/shortcut/rehearsals");
  await expect(card.getByTestId("shortcut-recipe")).toContainText("/api/shortcut/now");
  await expect(card.getByTestId("shortcut-download")).toHaveAttribute("href", /\/shortcuts\/send-to-roadie\.shortcut\?v=\d+$/);
  expect((await page.request.get("/shortcuts/send-to-roadie.shortcut")).status()).toBe(200);
  await page.reload();
  await expect(card.getByTestId("shortcut-token-status")).toContainText("You have a token");
  await expect(card.getByTestId("shortcut-token")).toHaveCount(0);

  await card.getByTestId("shortcut-url-change").click();
  await card.getByTestId("shortcut-url").fill("https://example.com/not-a-shortcut");
  await card.getByTestId("shortcut-url-save").click();
  await expect(card.getByTestId("error")).toContainText("iCloud link");
  await card.getByTestId("shortcut-url").fill("https://www.icloud.com/shortcuts/0123456789abcdef");
  await card.getByTestId("shortcut-url-save").click();
  await expect(card.getByTestId("shortcut-install")).toHaveAttribute("href", "https://www.icloud.com/shortcuts/0123456789abcdef");

  page.on("dialog", (d) => d.accept());
  await card.getByTestId("shortcut-revoke").click();
  await expect(card.getByTestId("shortcut-token-status")).toContainText("No token yet");
});
