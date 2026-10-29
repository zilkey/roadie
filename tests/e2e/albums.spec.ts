import { test, expect, type Page } from "@playwright/test";
import { A, DRIVE, openTab } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
const idFromUrl = (page: Page, seg: string) => page.url().split(`/${seg}/`)[1].split(/[/?]/)[0];

test.beforeEach(async ({ request }) => { await request.post(`${DRIVE}/__reset`); }); // fake Drive state outlives runs

// The seed has one album, Wild Hearts LP, on the album project of the same name: ten tracks in two sides, a couple of mixes on Low Light, a cover, and money.
test("Albums sits next to Songs; the index shows the seeded album with its tracks, release and money", async ({ page }) => {
  await signInAs(page, "jeff");
  await openTab(page, "albums");
  await expect(page.getByTestId("albums-page")).toBeVisible();
  const row = page.locator('[data-testid^="album-row-"]', { hasText: "Wild Hearts LP" });
  await expect(row).toContainText("Mixing");
  await expect(row).toContainText("10 · ");
  await expect(row).toContainText("Mar 6, 2027");
  // Spent = the album project's expenses (3 days tracking + mix revisions); Earned = its income, received or owed
  await expect(row).toContainText("$2,100.00");
  await expect(row).toContainText("$584.00");
  await row.getByTestId("album-title").click();
  await expect(page.getByTestId("album-page")).toBeVisible();
  await expect(page.getByTestId("page-title")).toContainText("Wild Hearts LP");
  await expect(page.getByTestId("album-meta")).toContainText("10 tracks");
  await expect(page.getByTestId("album-progress")).toHaveText(/Tracked 10\/10 · Mixed 6\/10 · Mastered 0\/10/);
  await expect(page.getByTestId("album-spent")).toContainText("$2,100.00");
  await expect(page.getByTestId("album-spent")).toContainText("$6,000.00");
  // the tracklist has two sides and the latest mix per track
  await expect(page.getByTestId("side-A")).toBeVisible();
  await expect(page.getByTestId("side-B")).toBeVisible();
  const lowLight = page.locator('[data-testid^="track-row-"]', { hasText: "Low Light" });
  await expect(lowLight.getByTestId("track-mix")).toHaveText("v2 · approved");
  await expect(lowLight.getByTestId("track-status")).toHaveText("Mixed");
});

test("a new album from a setlist template gets its own project; tracks are added, broken into sides and reordered", async ({ page }) => {
  await signInAs(page, "jeff");
  // a setlist template to start from
  await page.goto(A("/setlists"));
  await page.getByTestId("new-setlist-name").fill("Album set");
  await page.getByTestId("new-setlist").click();
  await expect(page.getByTestId("setlist-page")).toBeVisible();
  for (const title of ["Kerosene · Em", "Gold Hour · D"]) {
    await page.getByTestId("add-song-select").selectOption({ label: title });
    await page.getByTestId("add-song-item").click();
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  }

  await openTab(page, "albums");
  await page.getByTestId("add-album-btn").click();
  await expect(page.getByTestId("new-album")).toBeVisible();
  await page.getByTestId("album-title").fill("Night Shift EP");
  await page.getByTestId("album-kind-ep").check();
  await page.getByTestId("album-status").selectOption("recording");
  await page.getByTestId("album-budget").fill("1500");
  await page.getByTestId("start-setlist").check();
  await page.getByTestId("start-setlist-select").selectOption({ label: "Album set" });
  await page.getByTestId("create-album").click();
  await expect(page.getByTestId("album-page")).toBeVisible();
  const albumId = idFromUrl(page, "albums");
  await expect(page.getByTestId("page-title")).toContainText("Night Shift EP");
  await expect(page.getByTestId("album-status-select")).toHaveValue("recording");
  const rows = page.locator('[data-testid^="track-row-"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Kerosene");
  await expect(rows.nth(1)).toContainText("Gold Hour");

  // add two more songs; Glass Coast is on the other album too (an album is per record, so it's offered)
  await page.getByTestId("add-tracks-btn").click();
  await expect(page.getByTestId("add-tracks-dialog")).toBeVisible();
  await page.getByTestId("song-search").fill("coast");
  await page.locator('[data-testid^="pick-song-"]:visible').first().check();
  await page.getByTestId("song-search").fill("cotton");
  await page.locator('[data-testid^="pick-song-"]:visible').first().check();
  await page.getByTestId("add-tracks-submit").click();
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(2)).toContainText("Glass Coast");
  await expect(rows.nth(3)).toContainText("Cottonwood");

  // Side B starts at track 3
  await page.getByTestId("side-break-btn").click();
  await page.getByTestId("side-break-at").selectOption({ index: 1 });
  await page.getByTestId("side-break-submit").click();
  await expect(page.getByTestId("side-A")).toBeVisible();
  await expect(page.getByTestId("side-B")).toBeVisible();

  // the album's project is on the Money page, and the album is reachable from it
  await openTab(page, "money");
  await page.getByTestId("money-tab-projects").click();
  const prow = page.getByTestId("projects-table").locator("tr", { hasText: "Night Shift EP" });
  await expect(prow).toContainText("Album");
  await prow.locator('[data-testid^="project-album-"]').click();
  await expect(page).toHaveURL(new RegExp(`/albums/${albumId}$`));

  // rename in place: the project follows
  await page.getByTestId("field-title").click();
  await page.getByTestId("field-title-input").fill("Night Shift");
  await page.getByTestId("field-title-input").press("Enter");
  await expect(page.getByTestId("page-title")).toContainText("Night Shift");
  await openTab(page, "money");
  await page.getByTestId("money-tab-projects").click();
  await expect(page.getByTestId("projects-table")).toContainText("Night Shift");
  await expect(page.getByTestId("projects-table")).not.toContainText("Night Shift EP");
});

test("a track's page: status steps, a mix added from Drive becomes v3, approving it; credits and ISRC; costs on the track", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/albums"));
  await page.locator('[data-testid^="album-row-"]', { hasText: "Wild Hearts LP" }).getByTestId("album-title").click();
  await page.locator('[data-testid^="track-row-"]', { hasText: "Low Light" }).getByTestId("track-title").click();
  await expect(page.getByTestId("track-page")).toBeVisible();
  await expect(page.getByTestId("track-pos")).toHaveText("Track 3 of 10 · Side A");
  await expect(page.getByTestId("page-title")).toContainText("Low Light");
  // mixes newest first, the approved one marked, with Jeff's note on v1
  const mixes = page.getByTestId("mixes").locator('.sg-row[data-testid^="file-"]');
  await expect(mixes).toHaveCount(2);
  await expect(mixes.nth(0)).toContainText("v2");
  await expect(mixes.nth(0).locator('[data-testid^="approved-"]')).toBeVisible();
  await expect(mixes.nth(1)).toContainText("Guitar solo a touch quieter.");
  // the costs pinned to this track
  await expect(page.getByTestId("track-costs")).toContainText("Mix v2 revisions");
  await expect(page.getByTestId("track-costs")).toContainText("$300.00");

  // a new mix from the album folder in Drive: v3 from its name, then approve it
  await page.getByTestId("add-mix-from-drive").click();
  await page.getByTestId("drive-q").fill("Low Light v3");
  await page.getByTestId("drive-search").click();
  await page.getByTestId("hit-Low Light v3 mix.wav").getByTestId("hit-check").check();
  await page.getByTestId("attach-mix").click();
  await expect(mixes).toHaveCount(3);
  await expect(mixes.nth(0)).toContainText("v3");
  await mixes.nth(0).locator('[data-testid^="approve-"]').click();
  await expect(mixes.nth(0).locator('[data-testid^="approved-"]')).toBeVisible();
  // a note on it
  const v3 = mixes.nth(0);
  await v3.locator('[data-testid^="note-input-"]').fill("Vocal up a hair in the last chorus.");
  await v3.locator('[data-testid^="note-submit-"]').click();
  await expect(v3).toContainText("Vocal up a hair in the last chorus.");

  // mastered by tapping the step
  await page.getByTestId("track-step-mastered").click();
  await expect(page.getByTestId("track-step-mastered")).toHaveClass(/\bok\b/);
  // credits and release details
  await expect(page.getByTestId("credits")).toContainText("Lead vocals, acoustic guitar");
  await page.getByTestId("credit-who").fill("Sam");
  await page.getByTestId("credit-role").fill("Drums");
  await page.getByTestId("credit-add").click();
  await expect(page.getByTestId("credits")).toContainText("Drums");
  await page.getByTestId("field-isrc").click();
  await page.getByTestId("field-isrc-input").fill("USX9P2600003");
  await page.getByTestId("field-isrc-input").press("Enter");
  await expect(page.getByTestId("field-isrc")).toContainText("USX9P2600003");
  // from the song: its own demo and chart are listed, and the song page links back
  await expect(page.getByTestId("from-song")).toContainText("Low Light demo");
  await page.getByTestId("open-song").click();
  await expect(page.getByTestId("song-page")).toBeVisible();
  await expect(page.getByTestId("on-albums")).toContainText("Wild Hearts LP · Track 3");

  // back on the album the track reads mastered
  await page.locator('[data-testid^="on-album-"]').first().click();
  await expect(page.getByTestId("track-page")).toBeVisible();
  await page.getByTestId("back").click();
  await expect(page.locator('[data-testid^="track-row-"]', { hasText: "Low Light" }).getByTestId("track-status")).toHaveText("Mastered");
  await expect(page.getByTestId("album-progress")).toHaveText(/Mastered 1\/10/);
});

test("the Money tab: budget, spent, earned and net, lines with their track, income added with a record category; Files: artwork and an upload", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/albums"));
  await page.locator('[data-testid^="album-row-"]', { hasText: "Wild Hearts LP" }).getByTestId("album-title").click();
  await page.getByTestId("album-tab-money").click();
  await expect(page.getByTestId("album-money")).toBeVisible();
  await expect(page.getByTestId("album-budget")).toContainText("$6,000.00");
  await expect(page.getByTestId("album-spent-amount")).toHaveText("$2,100.00");
  await expect(page.getByTestId("tile-earned")).toContainText("$584.00");
  await expect(page.getByTestId("tile-net")).toContainText("−$1,516.00");
  await expect(page.getByTestId("budget-left")).toContainText("35% of budget spent");
  const lines = page.getByTestId("album-lines");
  await expect(lines.locator('[data-testid^="line-expense-"]', { hasText: "Mix v2 revisions" })).toContainText("3 · Low Light");
  await page.getByTestId("lines-filter").selectOption("income");
  await expect(lines.locator('[data-testid^="line-expense-"]')).toHaveCount(0);
  await expect(lines.locator('[data-testid^="line-income-"]')).toHaveCount(2);
  // + Add income opens Money in on the album's project with the record kinds
  await page.getByTestId("add-income-btn").click();
  await expect(page.getByTestId("money-in-modal")).toBeVisible();
  await expect(page.getByTestId("mi-project")).toHaveValue(/./);
  await expect(page.getByTestId("mi-project").locator("option:checked")).toHaveText("Wild Hearts LP");
  await page.getByTestId("mi-got").check();
  await page.getByTestId("mi-cat-preorders").click();
  await page.getByTestId("mi-from").fill("Pre-order sales");
  await page.getByTestId("mi-amount").fill("780");
  await page.getByTestId("mi-method").selectOption("bank");
  await page.getByTestId("mi-save").click();
  await expect(page.getByTestId("money-in-modal")).toBeHidden();
  await expect(lines.locator('[data-testid^="line-income-"]', { hasText: "Pre-order sales" })).toContainText("Pre-orders");
  await expect(page.getByTestId("tile-earned")).toContainText("$1,364.00");
  // the budget edits in place
  await page.getByTestId("album-budget").click();
  await page.getByTestId("album-budget-input").fill("7000");
  await page.getByTestId("album-budget-input").press("Enter");
  await expect(page.getByTestId("album-budget")).toContainText("$7,000.00");
  await expect(page.getByTestId("budget-left")).toContainText("30% of budget spent");

  // Files: the cover sits under Artwork; an upload lands in the album folder
  await page.getByTestId("album-tab-files").click();
  await expect(page.getByTestId("album-files")).toBeVisible();
  await expect(page.getByTestId("files-group-artwork")).toContainText("Wild Hearts cover 3000px.png");
  await page.getByTestId("album-upload-promo-input").setInputFiles({ name: "One-sheet.pdf", mimeType: "application/pdf", buffer: Buffer.from("not really a pdf") });
  await expect(page.getByTestId("album-upload-promo-done")).toHaveText("Uploaded to Wild Hearts LP.");
  await expect(page.getByTestId("files-group-promo")).toContainText("One-sheet.pdf");
  await expect(page.getByTestId("track-files-list")).toContainText("3 · Low Light");
});

test("a member is sent to the Calendar from every album page", async ({ page }) => {
  await signInAs(page, "david");
  for (const path of ["/albums", "/albums/new"]) {
    await page.goto(A(path));
    await expect(page).toHaveURL(/\/calendar$/);
  }
  await page.getByTestId("more-toggle").click();
  await expect(page.getByTestId("more-albums")).toHaveCount(0);
  await expect(page.getByTestId("tab-albums")).toHaveCount(0);
});
