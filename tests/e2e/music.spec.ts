import { test, expect, type Page } from "@playwright/test";
import { DRIVE, A } from "./env";


async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
}
const idFromUrl = (page: Page, seg: string) => page.url().split(`/${seg}/`)[1].split(/[/?]/)[0];

test.beforeEach(async ({ request }) => { await request.post(`${DRIVE}/__reset`); }); // fake Drive state outlives runs

async function attachToHiDive(page: Page) {
  const value = await page.getByTestId("attach-show").locator("option", { hasText: "Hi-Dive" }).first().getAttribute("value");
  await page.getByTestId("attach-show").selectOption({ value: value! });
}

async function newSong(page: Page, title: string) {
  await page.getByTestId("tab-songs").click();
  await page.getByTestId("add-song-btn").click();
  await page.getByTestId("song-title").fill(title);
}

/** A Band Member "Foo" with an email, made through the People page (add, then edit for the email). */
async function addFoo(page: Page) {
  await page.getByTestId("people-add-open").click();
  const startOver = page.getByTestId("draft-start-over");
  if (await startOver.isVisible()) await startOver.click();
  await page.getByTestId("user-name").fill("Foo");
  await page.getByTestId("user-band-member").check();
  await page.getByTestId("user-instruments").fill("guitar");
  await page.getByTestId("user-add").click();
  const row = page.getByTestId("person-row-Foo");
  await row.getByTestId("person-actions").click();
  await page.getByTestId("person-menu-edit").click();
  await page.getByTestId("person-sheet-email").fill("foo@example.com");
  await page.getByTestId("person-sheet-save").click();
  await expect(page.getByTestId("person-sheet")).toBeHidden();
  await expect(page.getByTestId("person-row-foo@example.com").first()).toBeVisible();
}

test("add a song and attach files picked from a Drive search", async ({ page }) => {
  await signInAs(page, "jeff");
  await newSong(page, "Last Train");
  // typing the title searches Drive: audio, video, Docs and Word only (no pdf)
  await expect(page.getByTestId("hit-Last Train to Lyons demo.m4a")).toBeVisible();
  await expect(page.getByTestId("hit-Last Train to Lyons chart E.docx")).toBeVisible();
  await expect(page.getByTestId("hit-Last Train to Lyons lyrics")).toBeVisible();
  await expect(page.getByTestId(/^hit-.*\.pdf$/)).toHaveCount(0);
  await expect(page.getByTestId("hit-Last Train to Lyons demo.m4a").getByTestId("icon-audio")).toBeVisible();
  await expect(page.getByTestId("hit-Last Train to Lyons chart E.docx").getByTestId("icon-doc")).toBeVisible();

  // pick several at once; kind and key are guessed
  for (const n of ["demo.m4a", "chart E.docx", "lyrics"]) await page.getByTestId(`hit-Last Train to Lyons ${n}`).getByTestId("hit-check").check();
  await expect(page.getByTestId("hit-Last Train to Lyons chart E.docx").getByTestId("hit-kind")).toHaveValue("chart");
  await expect(page.getByTestId("hit-Last Train to Lyons chart E.docx").getByTestId("hit-key")).toHaveValue("E");
  await page.getByTestId("song-key").fill("E");
  await page.getByTestId("song-length").fill("4:17");
  await page.getByTestId("save-song").click();

  await expect(page.getByTestId("song-page")).toBeVisible();
  await expect(page.getByTestId("page-title")).toHaveText("Last Train");
  await expect(page.getByTestId("files-chart").getByTestId("file-label")).toHaveText("Chart in E");
  await expect(page.getByTestId("files-demo")).toContainText("Last Train to Lyons demo.m4a");
  await expect(page.getByTestId("files-lyrics")).toBeVisible();
  // it shows up in the list with key and length
  await page.getByTestId("back").click();
  await page.getByTestId("songs-filter").fill("last train");
  await expect(page.getByTestId("songs-list")).toContainText("E · 4:17");
});

test("fix a sharing gap: share with band, copy to band folder, run the check", async ({ page, request }) => {
  await signInAs(page, "jeff");
  await newSong(page, "Gap test song");
  await page.getByTestId("drive-q").fill("Sundial");
  await page.getByTestId("drive-search").click();
  const lyrics = page.getByTestId("hit-Sundial lyrics");
  await expect(lyrics).toBeVisible();
  await expect(lyrics.getByTestId("outside-band")).toBeVisible();
  await expect(lyrics.getByTestId("cant-open")).toContainText("David");
  await expect(lyrics.getByTestId("cant-open")).toContainText("Eric");
  await lyrics.getByTestId("hit-check").check();
  await page.getByTestId("save-song").click();

  // the gap shows on the song page
  const file = page.getByTestId("files-lyrics").getByTestId(/^file-/).first();
  await expect(file.getByTestId("cant-open")).toContainText("Can't open: David, Eric");
  await file.getByTestId("fix-share").click();
  await expect(file.getByTestId("cant-open")).toHaveCount(0);
  await expect(file).toContainText("Outside the band folder");
  const perms = await (await request.get(`${DRIVE}/files/fake-lyrics-5/permissions`)).json() as { email: string }[];
  expect(perms.map((p) => p.email)).toEqual(expect.arrayContaining(["david@example.com", "eric@example.com"]));

  await file.getByTestId("fix-copy").click();
  await expect(file.getByTestId("file-ok")).toBeVisible();
  const all = await (await request.get(`${DRIVE}/files?parent=fake-band-folder&q=Sundial lyrics`)).json() as { id: string }[];
  expect(all.length).toBe(1);

  await page.getByTestId("run-sharing-check").click();
  await expect(page.getByTestId("check-result")).toContainText(/Checked \d+ files: \d+ the band can't open/); // covers every song file, including the seeded Glass Coast chart gap
  await expect(file.getByTestId("file-ok")).toBeVisible(); // ours is still fine
  await expect(page.getByTestId("checked-at")).toBeVisible();

  // an outside change is picked up by the check: a file added with a gap shows up after "Run sharing check"
  await page.getByTestId("add-from-drive").click();
  await page.getByTestId("drive-q").fill("Weathervane");
  await page.getByTestId("drive-search").click();
  const demo = page.getByTestId("hit-Weathervane demo.m4a");
  await expect(demo.getByTestId("cant-open")).toContainText("Emma");
  await demo.getByTestId("hit-check").check();
  await expect(page.getByTestId("picker-gap")).toBeVisible();
  await page.getByTestId("picker-share").click(); // fix before attaching
  await expect(demo.getByTestId("cant-open")).toHaveCount(0);
  await page.getByTestId("attach-files").click();
  await expect(page.getByTestId("files-demo")).toContainText("Weathervane demo.m4a");
  await expect(page.getByTestId("files-demo").getByTestId("file-ok")).toBeVisible();
});

test("build a setlist with total time against the show's set length", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("tab-songs").click();
  await page.getByTestId("songs-seg-setlists").click();
  await expect(page.getByTestId("setlists-list")).toContainText("Hi-Dive 45 min");
  const original = page.getByTestId("setlists-list").getByText("Hi-Dive 45 min");
  await page.getByTestId("new-setlist-name").fill("E2E set");
  await page.getByTestId("new-setlist").click();
  await expect(page.getByTestId("setlist-page")).toBeVisible();

  const add = async (title: string) => { await page.getByTestId("add-song-select").selectOption({ label: title }); await page.getByTestId("add-song-item").click(); };
  await page.getByTestId("add-song-select").selectOption({ label: "Glass Coast · F#m" });
  await page.getByTestId("add-song-item").click();
  await add("Weathervane · D");
  await page.getByTestId("break-title").fill("Talk / tune");
  await page.getByTestId("add-break").click();
  await expect(page.getByTestId("setlist-items").getByTestId("item-title")).toHaveText(["Glass Coast", "Weathervane", "Talk / tune"]);
  await expect(page.getByTestId("total-time")).toHaveText("9:02"); // 3:52 + 4:10 + 1:00, computed by the server
  await expect(page.getByTestId("fit")).toHaveCount(0); // no show yet

  // up/down buttons
  await page.getByTestId("item-1").getByTestId("item-up").click();
  await expect(page.getByTestId("setlist-items").getByTestId("item-title")).toHaveText(["Weathervane", "Glass Coast", "Talk / tune"]);
  // drag and drop
  await page.getByTestId("item-2").dragTo(page.getByTestId("item-0"));
  await expect(page.getByTestId("setlist-items").getByTestId("item-title")).toHaveText(["Talk / tune", "Weathervane", "Glass Coast"]);
  await page.reload();
  await expect(page.getByTestId("setlist-items").getByTestId("item-title")).toHaveText(["Talk / tune", "Weathervane", "Glass Coast"]);

  // attach to the Hi-Dive show (45 min): fits, then runs over
  await attachToHiDive(page);
  await expect(page.getByTestId("total-time")).toHaveText("9:02 of 45:00");
  await expect(page.getByTestId("fit")).toHaveText("Fits");
  await expect(page.getByTestId("setlist-total")).toHaveAttribute("data-over", "0");
  await page.getByTestId("break-len").fill("40:00");
  await page.getByTestId("add-break").click();
  await expect(page.getByTestId("total-time")).toHaveText("49:02 of 45:00");
  await expect(page.getByTestId("setlist-total")).toHaveAttribute("data-over", "1");
  await expect(page.getByTestId("fit")).toHaveText("4:02 over");
  await page.getByTestId("item-3").getByTestId("item-remove").click();
  await expect(page.getByTestId("setlist-total")).toHaveAttribute("data-over", "0");

  // the show page and the /songs?setlist= link both land here
  const setlistId = idFromUrl(page, "setlists");
  await page.getByTestId("show-link").click();
  await expect(page.getByTestId("setlist-link")).toContainText("E2E set");
  await page.goto(A(`/songs?setlist=${setlistId}`));
  await expect(page).toHaveURL(new RegExp(`/songs/setlists/${setlistId}$`));

  // put the seeded setlist back on the show
  await page.getByTestId("back").click();
  await page.getByTestId("songs-seg-setlists").click();
  await original.click();
  await attachToHiDive(page);
  await expect(page.getByTestId("total-time")).toContainText("of 45:00");
});

test("a member opens a song and sees its files, with no edit controls", async ({ page }) => {
  await signInAs(page, "david");
  await page.getByTestId("tab-songs").click();
  await expect(page.getByTestId("add-song-btn")).toHaveCount(0);
  await page.getByTestId("songs-filter").fill("glass");
  await page.getByTestId("songs-list").getByText("Glass Coast").first().click();
  await expect(page.getByTestId("song-page")).toBeVisible();
  await expect(page.getByTestId("page-title")).toHaveText("Glass Coast");
  await expect(page.getByTestId("files-chart").getByTestId("file-label")).toHaveText("Chart in F#m");
  await expect(page.getByTestId("files-demo")).toContainText("Glass Coast demo v3.m4a");
  // not directly playable here, so it opens the Drive link
  const open = page.getByTestId("files-demo").getByTestId("file-open");
  await expect(open).toHaveText("Open in Drive");
  await expect(open).toHaveAttribute("href", /fake-drive-demo-1/);
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(page.getByTestId("last-rehearsed")).toContainText("Oct 18");
  for (const t of ["song-edit", "add-from-drive", "run-sharing-check", "fix-share", "fix-copy", "file-remove", "file-gap"]) await expect(page.getByTestId(t)).toHaveCount(0);

  // setlists and rehearsals are readable, read-only
  await page.goto(A("/songs"));
  await page.getByTestId("songs-seg-setlists").click();
  await expect(page.getByTestId("new-setlist")).toHaveCount(0);
  await page.getByTestId("setlists-list").getByText("Hi-Dive 45 min").click();
  await expect(page.getByTestId("setlist-items").getByTestId("item-title").first()).toHaveText("Glass Coast");
  await expect(page.getByTestId("add-song-item")).toHaveCount(0);
  await expect(page.getByTestId("item-up")).toHaveCount(0);
  await page.goto(A("/songs"));
  await page.getByTestId("songs-seg-rehearsals").click();
  await expect(page.getByTestId("log-rehearsal")).toHaveCount(0);
  await page.getByTestId("rehearsals-list").getByText("Jeff's basement").click();
  await expect(page.getByTestId("rehearsal-songs")).toContainText("Glass Coast");
  // add-a-song is admin only
  await page.goto(A("/songs/new"));
  await expect(page).toHaveURL(/\/home$/);
});

test("log a rehearsal, tick the songs run, attach the recording from Drive", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/songs/rehearsals/new"));
  await page.getByTestId("reh-date").fill("2026-10-20");
  await page.getByTestId("reh-place").fill("Studio B");
  for (const n of ["Jeff", "David"]) await page.getByTestId(`reh-who-${n}`).click();
  await page.getByTestId("reh-song-Low Light").check();
  await page.getByTestId("reh-note-Low Light").fill("Ending is loose");
  await page.getByTestId("reh-song-Sundial").check();
  await page.getByTestId("drive-q").fill("Rehearsal video");
  await page.getByTestId("drive-search").click();
  await page.getByTestId("hit-Rehearsal video Ruby Hill ending.mp4").getByTestId("hit-check").check();
  await expect(page.getByTestId("hit-Rehearsal video Ruby Hill ending.mp4").getByTestId("hit-kind")).toHaveValue("rehearsal");
  await page.getByTestId("reh-save").click();

  await expect(page).toHaveURL(/\/songs\/rehearsals\/[^/]+$/);
  await expect(page.getByTestId("reh-song-Low Light")).toBeChecked();
  await expect(page.getByTestId("reh-note-Low Light")).toHaveValue("Ending is loose");
  await expect(page.getByTestId("rehearsal-files")).toContainText("Rehearsal video Ruby Hill ending.mp4");

  // "last rehearsed" now reflects it
  await page.goto(A("/songs"));
  await page.getByTestId("songs-filter").fill("low light");
  await page.getByTestId("songs-list").getByText("Low Light").first().click();
  await expect(page.getByTestId("last-rehearsed")).toContainText("Oct 20");
});

test("a new song is a draft; an existing song autosaves with Undo", async ({ page }) => {
  await signInAs(page, "jeff");
  await newSong(page, "Draft Song");
  await page.getByTestId("song-key").fill("A");
  await expect(page.getByTestId("draft-status")).toHaveText("Draft saved");
  await page.reload();
  await expect(page.getByTestId("song-title")).toHaveValue("Draft Song");
  await expect(page.getByTestId("song-key")).toHaveValue("A");
  await expect(page.getByTestId("draft-restored")).toBeVisible();
  await page.goto(A("/home"));
  await expect(page.getByTestId("unfinished")).toContainText("New song · Draft Song");
  await page.goBack();
  await page.getByTestId("save-song").click();
  await expect(page.getByTestId("song-page")).toBeVisible();
  await page.goto(A("/songs/new"));
  await expect(page.getByTestId("song-title")).toHaveValue(""); // creating cleared the draft

  await page.goBack();
  await page.getByTestId("song-edit").click();
  await expect(page.getByTestId("song-save")).toHaveCount(0);
  await page.getByTestId("edit-key").fill("C#m");
  await page.getByTestId("edit-length").fill("3:30");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("page-title")).toHaveText("Draft Song");
  await page.getByTestId("song-edit").click();
  await expect(page.getByTestId("edit-key")).toHaveValue("C#m");
  await expect(page.getByTestId("edit-length")).toHaveValue("3:30");
  await page.getByTestId("edit-length").fill("nope");
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "error");
  await page.getByTestId("edit-length").fill("4:00");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.getByTestId("undo-button").last().click(); // saves by the same person within 2 minutes fold into one history entry
  await expect(page.getByTestId("edit-length")).not.toHaveValue("4:00");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("song-archive").click();
  await expect(page).toHaveURL(/\/songs$/);
});

test("a new rehearsal is a draft; an existing one autosaves", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/songs/rehearsals/new"));
  await page.getByTestId("reh-date").fill("2027-01-05");
  await page.getByTestId("reh-place").fill("Draft room");
  await page.getByTestId("reh-who-Jeff").click();
  await expect(page.getByTestId("draft-status")).toHaveText("Draft saved");
  await page.reload();
  await expect(page.getByTestId("reh-place")).toHaveValue("Draft room");
  await expect(page.getByTestId("reh-who-Jeff")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("draft-restored")).toBeVisible();
  await page.getByTestId("reh-save").click();
  await expect(page).toHaveURL(/\/songs\/rehearsals\/[^/]+$/);

  // existing: no Save button, fields save on their own
  await expect(page.getByTestId("reh-save")).toHaveCount(0);
  await page.getByTestId("reh-place").fill("Real room");
  await page.getByTestId("reh-song-Low Light").check();
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("reh-place")).toHaveValue("Real room");
  await expect(page.getByTestId("reh-song-Low Light")).toBeChecked();
  await page.getByTestId("reh-place").fill("Other room");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.getByTestId("undo-button").last().click(); // the form follows the record after an Undo
  await expect(page.getByTestId("reh-place")).not.toHaveValue("Other room");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("reh-archive").click();
  await expect(page).toHaveURL(/\/songs$/);
});

test("a new setlist name is a draft; the name and the item list autosave, with Undo", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("tab-songs").click();
  await page.getByTestId("songs-seg-setlists").click();
  await page.getByTestId("new-setlist-name").fill("Draft set");
  await expect(page.getByTestId("draft-status")).toHaveText("Draft saved");
  await page.reload();
  await page.getByTestId("songs-seg-setlists").click();
  await expect(page.getByTestId("new-setlist-name")).toHaveValue("Draft set");
  await page.getByTestId("new-setlist").click();
  await expect(page.getByTestId("setlist-page")).toBeVisible();

  await page.getByTestId("setlist-name").fill("Renamed set");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("page-title")).toHaveText("Renamed set");

  await page.getByTestId("add-song-select").selectOption({ label: "Glass Coast · F#m" });
  await page.getByTestId("add-song-item").click();
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await expect(page.getByTestId("setlist-items").getByTestId("item-title")).toHaveText(["Glass Coast"]);
  await expect(page.getByTestId("toast").filter({ hasText: "Saved items" })).toBeVisible();
  await page.getByTestId("undo-button").last().click();
  await expect(page.getByTestId("setlist-items").getByTestId("item-title")).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("setlist-archive").click();
  await expect(page).toHaveURL(/\/songs$/);
});

test("a musician added after seeding: attach with the gap, then share with the band", async ({ page, request }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/admin/people"));
  await addFoo(page);

  await page.getByTestId("tab-songs").click();
  await page.getByTestId("songs-filter").fill("cottonwood");
  await page.getByTestId("songs-list").getByText("Cottonwood").first().click();
  await expect(page.getByTestId("song-page")).toBeVisible();
  await page.getByTestId("add-from-drive").click();
  await page.getByTestId("drive-q").fill("Cottonwood");
  await page.getByTestId("drive-search").click();
  const demo = page.getByTestId("hit-Cottonwood demo.m4a");
  await expect(demo.getByTestId("cant-open")).toHaveText("Can't open: Foo"); // Sam has no email: never listed
  await demo.getByTestId("hit-check").check();
  await expect(page.getByTestId("picker-gap")).toBeVisible();
  await page.getByTestId("picker-share").click();
  await expect(demo.getByTestId("cant-open")).toHaveCount(0);
  await expect(page.getByTestId("picker-gap")).toHaveCount(0);
  const perms = await (await request.get(`${DRIVE}/files/fake-demo-11/permissions`)).json() as { email: string }[];
  expect(perms.map((p) => p.email)).toContain("foo@example.com");
  await page.getByTestId("attach-files").click();
  await expect(page.getByTestId("files-demo")).toContainText("Cottonwood demo.m4a");
  await expect(page.getByTestId("files-demo").getByTestId("file-ok")).toBeVisible();
});

test("a sharing gap never blocks attaching: attach first, fix later", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/admin/people"));
  await addFoo(page);
  await page.getByTestId("tab-songs").click();
  await page.getByTestId("songs-filter").fill("kerosene");
  await page.getByTestId("songs-list").getByText("Kerosene").first().click();
  await page.getByTestId("add-from-drive").click();
  await page.getByTestId("drive-q").fill("Kerosene");
  await page.getByTestId("drive-search").click();
  await page.getByTestId("hit-Kerosene demo.m4a").getByTestId("hit-check").check();
  await page.getByTestId("attach-files").click();
  const file = page.getByTestId("files-demo");
  await expect(file).toContainText("Kerosene demo.m4a");
  await expect(file.getByTestId("cant-open")).toContainText("Can't open: Foo");
  await page.getByTestId("fix-share").first().click();
  await expect(file.getByTestId("file-ok")).toBeVisible();
});
