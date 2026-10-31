import { test, expect, type Page } from "@playwright/test";
import { A, DRIVE, openTab } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
const idFromUrl = (page: Page, seg: string) => page.url().split(`/${seg}/`)[1].split(/[/?]/)[0];

test.beforeEach(async ({ request }) => { await request.post(`${DRIVE}/__reset`); }); // fake Drive state outlives runs

// The seed has one release, Wild Hearts LP, on the release project of the same name: ten tracks in two sides, a couple of mixes on Low Light, a cover, and money.
test("Releases sits next to Songs; the index shows the seeded release with its tracks, release and money", async ({ page }) => {
  await signInAs(page, "jeff");
  await openTab(page, "releases");
  await expect(page.getByTestId("releases-page")).toBeVisible();
  const row = page.locator('[data-testid^="release-row-"]', { hasText: "Wild Hearts LP" });
  await expect(row.getByTestId("release-progress")).toHaveText(/Tracked 10\/10 · Mixed \d+\/10 · Mastered 0\/10/);
  await expect(row).toContainText("10 · ");
  await expect(row).toContainText("Mar 6, 2027");
  // Spent = the release project's expenses (3 days tracking + mix revisions); Earned = its income, received or owed
  await expect(row).toContainText("$2,100.00");
  await expect(row).toContainText("$584.00");
  await row.getByTestId("release-title").click();
  await expect(page.getByTestId("release-page")).toBeVisible();
  await expect(page.getByTestId("page-title")).toContainText("Wild Hearts LP");
  await expect(page.getByTestId("release-meta")).toContainText("10 tracks");
  await expect(page.getByTestId("release-progress")).toHaveText(/Tracked 10\/10 · Mixed 6\/10 · Mastered 0\/10/);
  await expect(page.getByTestId("release-spent")).toContainText("$2,100.00");
  // the tracklist has two sides and the latest mix per track
  await expect(page.getByTestId("side-A")).toBeVisible();
  await expect(page.getByTestId("side-B")).toBeVisible();
  const lowLight = page.locator('[data-testid^="track-row-"]', { hasText: "Low Light" });
  await expect(lowLight.getByTestId("track-mix")).toHaveText("v2 · approved");
  await expect(lowLight.getByTestId("track-status")).toHaveText("Mixed");
});

test("a new release from a setlist template gets its own project; tracks are added, broken into sides and reordered", async ({ page }) => {
  await signInAs(page, "jeff");
  // a setlist template to start from
  await page.goto(A("/setlists"));
  await page.getByTestId("new-setlist-name").fill("Release set");
  await page.getByTestId("new-setlist").click();
  await expect(page.getByTestId("setlist-page")).toBeVisible();
  for (const title of ["Kerosene · Em", "Gold Hour · D"]) {
    await page.getByTestId("add-song-select").selectOption({ label: title });
    await page.getByTestId("add-song-item").click();
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  }

  await openTab(page, "releases");
  await page.getByTestId("add-release-btn").click();
  await expect(page.getByTestId("new-release")).toBeVisible();
  await page.getByTestId("release-title").fill("Night Shift EP");
  await page.getByTestId("release-kind-ep").check();
  // the release folder is picked right here, from anywhere in Drive: by name, with Change / Clear, or by pasting a link
  await page.getByTestId("release-folder-q").fill("Rehearsal");
  await page.getByTestId("release-folder-search").click();
  await page.getByTestId("release-folder-hit-Rehearsal recordings").getByTestId("release-folder-choose").click();
  await expect(page.getByTestId("release-folder-picked")).toContainText("Rehearsal recordings");
  await page.getByTestId("release-folder-change").click();
  await page.getByTestId("release-folder-q").fill("https://drive.google.com/drive/folders/fake-folder-demos?usp=sharing");
  await page.getByTestId("release-folder-search").click();
  await expect(page.getByTestId("release-folder-picked")).toContainText("Demos");
  await page.getByTestId("create-release").click();
  await expect(page.getByTestId("release-page")).toBeVisible();
  const releaseId = idFromUrl(page, "releases");
  await expect(page.getByTestId("page-title")).toContainText("Night Shift EP");
  // no status of its own, no tracks yet; the folder is the one picked
  await expect(page.getByTestId("release-status-select")).toHaveCount(0);
  await expect(page.getByTestId("tracklist")).toContainText("No tracks yet");
  await expect(page.getByTestId("release-folder-link")).toContainText("Demos");

  // the tracklist comes after creating: from the setlist, in its order
  const rows = page.locator('[data-testid^="track-row-"]');
  await page.getByTestId("add-setlist-btn").click();
  await expect(page.getByTestId("add-tracks-dialog")).toBeVisible();
  await page.getByTestId("pick-setlist").selectOption({ label: "Release set" });
  await page.getByTestId("add-tracks-submit").click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Kerosene");
  await expect(rows.nth(1)).toContainText("Gold Hour");

  // add two more songs; Glass Coast is on the other release too (a release is per record, so it's offered)
  await page.getByTestId("track-song-search").fill("coast");
  await page.getByTestId("song-search-option").filter({ hasText: "Glass Coast" }).click();
  await expect(rows).toHaveCount(3);
  await page.getByTestId("track-song-search").fill("cotton");
  await page.getByTestId("track-song-search").press("Enter");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(2)).toContainText("Glass Coast");
  await expect(rows.nth(3)).toContainText("Cottonwood");

  // Side B starts at track 3
  await page.getByTestId("side-break-btn").click();
  await page.getByTestId("side-break-at").selectOption({ index: 1 });
  await page.getByTestId("side-break-submit").click();
  await expect(page.getByTestId("side-A")).toBeVisible();
  await expect(page.getByTestId("side-B")).toBeVisible();

  // the release's project is on the Money page, and the release is reachable from it
  await openTab(page, "money");
  await page.getByTestId("money-tab-projects").click();
  const prow = page.getByTestId("projects-table").locator("tr", { hasText: "Night Shift EP" });
  await expect(prow).toContainText("Release");
  await prow.locator('[data-testid^="project-release-"]').click();
  await expect(page).toHaveURL(new RegExp(`/releases/${releaseId}$`));

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
  await page.goto(A("/releases"));
  await page.locator('[data-testid^="release-row-"]', { hasText: "Wild Hearts LP" }).getByTestId("release-title").click();
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
  await expect(page.getByTestId("track-costs").getByTestId("paid-out")).toContainText("Mix v2 revisions");
  await expect(page.getByTestId("track-costs").getByTestId("paid-out")).toContainText("$300.00");

  // a new mix from the release folder in Drive: v3 from its name, then approve it
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
  await expect(page.getByTestId("on-releases")).toContainText("Wild Hearts LP · Track 3");

  // back on the release the track reads mastered
  await page.locator('[data-testid^="on-release-"]').first().click();
  await expect(page.getByTestId("track-page")).toBeVisible();
  await page.getByTestId("back").click();
  await expect(page.locator('[data-testid^="track-row-"]', { hasText: "Low Light" }).getByTestId("track-status")).toHaveText("Mastered");
  await expect(page.getByTestId("release-progress")).toHaveText(/Mastered 1\/10/);
});

test("the Money tab: spent, earned and net, the Money in and Money out cards (lines tagged with their track), adding to the whole release; Files: artwork and an upload", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/releases"));
  await page.locator('[data-testid^="release-row-"]', { hasText: "Wild Hearts LP" }).getByTestId("release-title").click();
  // the tabs sit above the cover card, which belongs to Tracks
  await expect(page.getByTestId("release-cover")).toBeVisible();
  expect((await page.getByTestId("release-tab").boundingBox())!.y).toBeLessThan((await page.getByTestId("release-cover").boundingBox())!.y);
  await page.getByTestId("release-tab-money").click();
  await expect(page.getByTestId("release-money")).toBeVisible();
  await expect(page.getByTestId("release-cover")).toHaveCount(0);
  await expect(page.getByTestId("tile-budget")).toHaveCount(0);
  await expect(page.getByTestId("release-spent-amount")).toHaveText("$2,100.00");
  await expect(page.getByTestId("tile-earned")).toContainText("$584.00");
  await expect(page.getByTestId("tile-net")).toContainText("−$1,516.00");
  const moneyIn = page.getByTestId("income");
  const moneyOut = page.getByTestId("paid-out");
  const mixRow = moneyOut.locator('[data-testid^="expense-row-"]', { hasText: "Mix v2 revisions" });
  await expect(mixRow).toContainText("3 · Low Light");
  // notes sit in small text under the title
  await expect(mixRow.locator('[data-testid^="expense-notes-"]')).toHaveText("Vocal up a hair in the last chorus");
  // Spent by song: every track in order, the mix revisions on Low Light, the studio days on the whole release
  const bySong = page.getByTestId("spent-by-song");
  await expect(bySong.locator('[data-testid^="spent-by-song-"]')).toHaveCount(11);
  await expect(bySong.locator('[data-testid^="spent-by-song-"]', { hasText: "3 · Low Light" })).toContainText("$300.00");
  await expect(page.getByTestId("spent-by-song-release")).toContainText("$1,800.00");
  await expect(moneyIn.locator('[data-testid^="income-row-"]')).toHaveCount(2);
  // + Money in is the Money page's form on the release's project
  await moneyIn.getByTestId("money-in-open").click();
  await expect(page.getByTestId("money-in-modal")).toBeVisible();
  await page.getByTestId("mi-got").check();
  await page.getByTestId("mi-cat").selectOption("sync");
  await page.getByTestId("mi-from").fill("Netflix sync");
  await page.getByTestId("mi-amount").fill("780");
  await expect(page.getByTestId("mi-project")).toHaveCount(0); // the release decides project and track
  await expect(page.getByTestId("mi-track")).toHaveCount(0);
  await page.getByTestId("mi-method").selectOption("bank");
  await page.getByTestId("mi-save").click();
  await expect(page.getByTestId("money-in-modal")).toBeHidden();
  await expect(moneyIn.locator('[data-testid^="income-row-"]', { hasText: "Netflix sync" })).toBeVisible();
  await expect(page.getByTestId("tile-earned")).toContainText("$1,364.00");
  // + Money out: a session player's pay on the whole release
  await moneyOut.getByTestId("money-out-open").click();
  const out = page.getByTestId("money-out-modal");
  await expect(out).toBeVisible();
  await out.getByTestId("mo-kind").selectOption("pay");
  await out.getByTestId("mo-who-input").fill("Ava Strings");
  await out.getByTestId("mo-who-other").click();
  await out.getByTestId("mo-amount").fill("200");
  await out.getByTestId("mo-what").fill("cello on Low Light");
  await expect(out.getByTestId("mo-project")).toHaveCount(0); // whole release: no Project or Track pickers
  await expect(out.getByTestId("mo-track")).toHaveCount(0);
  await out.getByTestId("mo-save").click();
  await expect(out).toBeHidden();
  await expect(moneyOut.locator('[data-testid^="payout-row-"]', { hasText: "Ava Strings" })).toBeVisible();
  await expect(page.getByTestId("release-spent-amount")).toHaveText("$2,300.00");
  await expect(page.getByTestId("spent-by-song-release")).toContainText("$2,000.00");

  // Files: the cover sits under Artwork; an upload lands in the release folder
  await page.getByTestId("release-tab-files").click();
  await expect(page.getByTestId("release-files")).toBeVisible();
  await expect(page.getByTestId("files-group-artwork")).toContainText("Wild Hearts cover 3000px.png");
  await page.getByTestId("release-upload-promo-input").setInputFiles({ name: "One-sheet.pdf", mimeType: "application/pdf", buffer: Buffer.from("not really a pdf") });
  await expect(page.getByTestId("release-upload-promo-done")).toHaveText("Uploaded to Wild Hearts LP.");
  await expect(page.getByTestId("files-group-promo")).toContainText("One-sheet.pdf");
  await expect(page.getByTestId("track-files-list")).toContainText("3 · Low Light");
});

test("a member is sent to the Calendar from every release page", async ({ page }) => {
  await signInAs(page, "david");
  for (const path of ["/releases", "/releases/new"]) {
    await page.goto(A(path));
    await expect(page).toHaveURL(/\/calendar$/);
  }
  await page.getByTestId("more-toggle").click();
  await expect(page.getByTestId("more-releases")).toHaveCount(0);
  await expect(page.getByTestId("tab-releases")).toHaveCount(0);
});
