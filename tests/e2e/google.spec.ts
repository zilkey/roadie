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
