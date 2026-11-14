import { test, expect, type Page } from "@playwright/test";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

// Dev and e2e run against the fakes (no GOOGLE_OAUTH_CLIENT_ID), so the page says Google isn't set up. The connect flow itself
// is covered by tests/unit/google.test.ts against a stubbed Google, and the forged-callback state check by its "state: signed" test.
// One visit to Settings > Google checks every read-only card. The seed's band folder is the fake Drive's "Nora Quill Band" and other
// specs rely on it, so the folder test only re-saves that same folder; the band calendar is the fake Calendar's "Nora Quill Band", which
// other specs send events to, so it is not changed. (Choosing and refusing folders and calendars is in tests/emulator/music.test.ts and google.test.ts.)
test("Settings > Google is in the admin sub-nav; it shows the band folder, calendar and the Charts, Demos, Shows and Songwriting folders", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.getByTestId("band-menu").click();
  await page.getByTestId("band-menu-settings").click();
  await page.getByTestId("settings-nav-google").click();
  await expect(page).toHaveURL(/\/admin\/google$/);
  await expect(page.getByTestId("page-title")).toHaveText("Google");
  await expect(page.getByTestId("google-not-configured")).toContainText("local fakes");
  await expect(page.getByTestId("settings-nav-google")).toHaveAttribute("aria-current", "page");

  // the band folder: search finds folders, and a pasted folder link saves it
  const folder = page.getByTestId("google-band-folder");
  await expect(folder.getByTestId("band-folder-link")).toContainText("Nora Quill Band");
  await folder.getByTestId("band-folder-change").click();
  await folder.getByTestId("band-folder-q").fill("Charts");
  await folder.getByTestId("band-folder-search").click();
  await expect(folder.getByTestId("band-folder-hit-Charts")).toBeVisible();
  await folder.getByTestId("band-folder-q").fill("https://drive.google.com/drive/folders/fake-band-folder?usp=sharing");
  await expect(folder.getByTestId("band-folder-search")).toHaveText("Use link");
  await folder.getByTestId("band-folder-search").click();
  await expect(folder.getByTestId("band-folder-note")).toContainText("Band folder saved");
  await expect(folder.getByTestId("band-folder-link")).toContainText("Nora Quill Band");

  // the band calendar: Change lists your calendars (view-only ones can't be chosen); Check my access
  const card = page.getByTestId("google-calendar");
  await expect(card.getByTestId("calendar-name")).toHaveText("Nora Quill Band");
  await card.getByTestId("calendar-change").click();
  await expect(card.getByTestId("calendar-hit-Nora Quill Band").getByTestId("calendar-choose")).toHaveText("Current");
  await expect(card.getByTestId("calendar-hit-Boulder Venues (view only)")).toContainText("View only");
  await expect(card.getByTestId("calendar-hit-Boulder Venues (view only)").getByTestId("calendar-choose")).toBeDisabled();
  await expect(card.getByTestId("calendar-hit-Rudy Pike").getByTestId("calendar-choose")).toBeEnabled();
  await card.getByTestId("calendar-cancel").click();
  await card.getByTestId("calendar-check-access").click();
  await expect(card.getByTestId("calendar-check")).toContainText("can add events to Nora Quill Band");

  // the Charts, Demos, Shows and Songwriting folders, each with what it is for (read-only)
  const folders = [
    { key: "charts", name: "Charts", heading: "Charts folder", status: "Lyrics, chord sheets and other charts" },
    { key: "demos", name: "Demos", heading: "Demos folder", status: "audio uploaded to a song" },
    { key: "shows", name: "Shows", heading: "Shows folder", status: "Posters uploaded on a show go here" },
  ];
  for (const f of folders) {
    const c = page.getByTestId(`google-${f.key}-folder`);
    await expect(c.getByRole("heading")).toHaveText(f.heading);
    await expect(c.getByTestId(`${f.key}-folder-link`)).toContainText(f.name);
    await expect(c.getByTestId(`${f.key}-folder-status`)).toContainText(f.status);
    await c.getByTestId(`${f.key}-folder-change`).click();
    await c.getByTestId(`${f.key}-folder-q`).fill(f.name);
    await c.getByTestId(`${f.key}-folder-search`).click();
    await expect(c.getByTestId(`${f.key}-folder-hit-${f.name}`).getByTestId(`${f.key}-folder-choose`)).toHaveText("Current");
  }
  const writing = page.getByTestId("google-songwriting-folder");
  await expect(writing.getByRole("heading")).toHaveText("Songwriting folder");
  await expect(writing.getByTestId("songwriting-folder-link")).toContainText("Songwriting");
  await expect(writing.getByTestId("songwriting-folder-status")).toContainText("Writing phase");
});

test("Settings > Google: the voice memo shortcut card makes a token (shown once), remembers it was made, and takes the Shortcut's iCloud link", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto("/artists/nora-quill-band/admin/google");
  const card = page.getByTestId("google-shortcut");
  // A retry starts clean: revoke a token an earlier try left.
  page.on("dialog", (d) => d.accept());
  await expect(card.getByTestId("shortcut-token-status")).toBeVisible();
  if (await card.getByTestId("shortcut-revoke").count()) {
    await card.getByTestId("shortcut-revoke").click();
  }
  await expect(card.getByTestId("shortcut-token-status")).toContainText("No token yet");
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

  await card.getByTestId("shortcut-revoke").click();
  await expect(card.getByTestId("shortcut-token-status")).toContainText("No token yet");
});

// No browser, but the only test of the route's answer: the signing itself is in tests/unit/google.test.ts.
test("a Google callback that isn't signed by this server is refused", async ({ request }) => {
  const r = await request.get("/api/google/callback?code=x&state=forged.state", { maxRedirects: 0 });
  expect(r.status()).toBe(400);
});
