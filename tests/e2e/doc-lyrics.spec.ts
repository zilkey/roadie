import { test, expect, type Browser, type Page } from "@playwright/test";
import { A, DRIVE } from "./env";

// #18: a song's Google Docs (lyrics, charts) read inline at the bottom of the song page and the rehearsal song page.
// The seed puts "Glass Coast lyrics" (fake Drive fake-lyrics-1, a Google Doc with chords over the words) on Glass Coast;
// its chart is a .docx, which stays a link. "Weathervane - D - Band Version" (fake-band-weathervane) on Weathervane has two
// tabs, Concert D and Drums, each a two-column table with bold section names and italic notes.

async function as(browser: Browser, key: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
  return { page, close: () => ctx.close() };
}

async function openSong(page: Page, title: string) {
  await page.goto(A("/songs"));
  await page.getByTestId("songs-filter").fill(title.toLowerCase());
  await page.getByTestId("songs-list").getByText(title).first().click();
  await expect(page.getByTestId("song-page")).toBeVisible();
}
const openGlassCoast = (page: Page) => openSong(page, "Glass Coast");

const setDoc = (body: { text?: string; noAccess?: boolean }) =>
  fetch(`${DRIVE}/files/fake-lyrics-1/__doc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("the song page shows its Google Doc lyrics at the bottom, chords kept over the words; the Word chart stays a link", async ({ browser }) => {
  const { page, close } = await as(browser, "hugo"); // a member sees it too
  await openGlassCoast(page);
  const card = page.getByTestId("doc-card");
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("doc-title")).toHaveText("Glass Coast lyrics");
  const text = card.getByTestId("doc-text");
  await expect(text).toContainText("Salt on the window, the tide coming in");
  // the spaces that put each chord over its word survive
  expect(await text.textContent()).toContain("F#m          D            A\nSalt on the window");
  await expect(card.getByTestId("doc-open")).toHaveAttribute("href", /fake-lyrics-1/);
  // a doc without tabs has no tab bar
  await expect(card.getByTestId("doc-tabs")).toHaveCount(0);
  // at the bottom: the last section on the page
  await expect(page.locator('[data-testid="song-page"] > section').last()).toHaveAttribute("data-testid", "doc-card");
  // the .docx chart is still only a row with its link
  await expect(page.getByTestId("files-chart").getByTestId("file-open")).toHaveAttribute("href", /fake-drive-chart-1/);
  await expect(page.getByTestId("doc-card").filter({ hasText: "chart" })).toHaveCount(0);
  await close();
});

test("the rehearsal song page shows the lyrics at the bottom too", async ({ browser }) => {
  const { page, close } = await as(browser, "rudy");
  await page.goto(A("/rehearsals"));
  await page.getByTestId("rehearsals-list").getByText("Oct 18").first().click();
  await page.getByTestId("reh-song-row-Glass Coast").getByTestId("reh-song-open").click();
  await expect(page.getByTestId("rehearsal-song-page")).toBeVisible();
  const card = page.getByTestId("doc-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Glass Coast lyrics");
  await expect(card.getByTestId("doc-text")).toContainText("Oh the glass coast, the glass coast");
  await expect(page.locator(".d-card").last()).toHaveAttribute("data-testid", "doc-card");
  // the chart is listed as a link, not read inline
  await expect(page.getByTestId("reh-song-docs-chart")).toContainText("Glass Coast chart F#m.docx");
  await close();
});

test("an edited doc shows its new text; a doc the band account can't read says so with Share with band and Open in Drive", async ({ browser }) => {
  const { page, close } = await as(browser, "rudy");
  // noAccess hides the file from GET, so take its text from the test hook (an empty body changes nothing).
  const original = ((await (await setDoc({})).json()) as { text: string }).text;
  try {
    await openGlassCoast(page);
    await expect(page.getByTestId("doc-text")).toContainText("Salt on the window");
    expect((await setDoc({ text: "Glass Coast\n\nNew verse\nD    A\nWaves on the glass" })).ok).toBe(true);
    await page.reload();
    await expect(page.getByTestId("doc-text")).toContainText("Waves on the glass");
    await expect(page.getByTestId("doc-text")).not.toContainText("Salt on the window");

    await setDoc({ noAccess: true });
    await page.reload();
    const none = page.getByTestId("doc-no-access");
    await expect(none).toContainText("Roadie can't read this doc");
    await expect(none.getByTestId("doc-share")).toBeVisible();
    await expect(none.getByTestId("doc-open")).toHaveAttribute("href", /fake-lyrics-1/);
    await expect(page.getByTestId("doc-text")).toHaveCount(0);
    await expect(page.getByTestId("doc-card").getByTestId("error")).toHaveCount(0);
  } finally {
    await setDoc({ text: original, noAccess: false });
    await close();
  }
});

test("a doc with tabs gets a tab bar opening on the first tab; its table is side by side on a wide screen and stacked, left-aligned, on a phone", async ({ browser }) => {
  const { page, close } = await as(browser, "hugo");
  await openSong(page, "Weathervane");
  const card = page.getByTestId("doc-card").filter({ hasText: "Weathervane - D - Band Version" });
  await expect(card).toHaveCount(1);
  const tabs = card.getByTestId("doc-tabs").getByRole("tab");
  await expect(tabs).toHaveText(["Concert D", "Drums"]);
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  const text = card.getByTestId("doc-text");
  await expect(text).toContainText("Wind on the barn roof");
  await expect(text).not.toContainText("Closed hat");
  // bold and italic carry over
  await expect(text.locator("strong").first()).toHaveText("Weathervane");
  await expect(text.locator("strong em, em strong").first()).toHaveText("(2x)");

  // the table: section names right-aligned beside the words
  const first = card.getByTestId("doc-table").locator("tr").nth(1).locator("td");
  await expect(first.nth(0)).toContainText("Verse 1");
  await expect(first.nth(0)).toHaveCSS("text-align", "right");
  const [l, r] = [await first.nth(0).boundingBox(), await first.nth(1).boundingBox()];
  expect(Math.abs(l!.y - r!.y)).toBeLessThan(2);
  expect(r!.x).toBeGreaterThan(l!.x + l!.width - 1);
  // chords stay over the words inside a cell
  expect(await first.nth(1).textContent()).toContain("D            G\nWind on the barn roof");

  // the second tab
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(text).toContainText("Closed hat");
  await expect(text).not.toContainText("Oh the weathervane");
  await expect(text.locator("em").filter({ hasText: "Add kick drum" })).toHaveCount(1);

  // a phone: each label above its words, both at the left edge
  await page.setViewportSize({ width: 390, height: 844 });
  const row = card.getByTestId("doc-table").locator("tr").nth(1).locator("td");
  await expect(row.nth(0)).toHaveCSS("text-align", "left");
  await expect(row.nth(1)).toHaveCSS("text-align", "left");
  const [a, b] = [await row.nth(0).boundingBox(), await row.nth(1).boundingBox()];
  expect(b!.y).toBeGreaterThanOrEqual(a!.y + a!.height - 1);
  expect(Math.abs(a!.x - b!.x)).toBeLessThan(2);
  await close();
});
