import { test, expect, type Page } from "@playwright/test";
import { DRIVE, A } from "./env";


async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
const idFromUrl = (page: Page, seg: string) => page.url().split(`/${seg}/`)[1].split(/[/?]/)[0];

test.beforeEach(async ({ request }) => { await request.post(`${DRIVE}/__reset`); }); // fake Drive state outlives runs

async function newSong(page: Page, title: string) {
  await page.getByTestId("tab-songs").click();
  await page.getByTestId("add-song-btn").click();
  await page.getByTestId("song-title").fill(title);
}

// Songs still being written live on the last tab, Writing. Their audio uploads go to the Songwriting folder, not Demos.
test("Writing tab: add a song in the Writing phase and upload audio to the Songwriting folder", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("tab-songs").click();
  const seg = page.getByTestId("songs-seg");
  await expect(seg.getByRole("tab").last()).toContainText("Writing");
  await page.getByTestId("songs-seg-writing").click();
  await expect(page.getByTestId("songs-list")).toContainText("Halfway Home"); // seeded
  await expect(page.getByTestId("songs-list")).not.toContainText("Glass Coast");

  await page.getByTestId("add-song-btn").click();
  await page.getByTestId("song-title").fill("Porch Light");
  await page.getByTestId("save-song").click();
  await expect(page.getByTestId("song-page")).toBeVisible();
  await expect(page.getByTestId("song-status-select")).toHaveValue("writing");
  await expect(page.getByTestId("song-upload-demo")).toContainText("Upload audio");
  await page.getByTestId("song-upload-demo-input").setInputFiles({ name: "Porch Light work tape.m4a", mimeType: "audio/mp4", buffer: Buffer.from("not really audio") });
  await expect(page.getByTestId("song-upload-demo-done")).toHaveText("Uploaded to Songwriting.");
  await expect(page.getByTestId("files-demo")).toContainText("Porch Light work tape.m4a");

  // back lands on the Writing tab, and the song isn't counted as Unlinked
  await page.getByTestId("back").click();
  await expect(page.getByTestId("songs-list")).toContainText("Porch Light");
  await expect(page.getByTestId("songs-seg-writing")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("songs-seg-unlinked").click();
  await expect(page.getByTestId("songs-list")).not.toContainText("Halfway Home");
});

test("a song moving from Writing into Learning is celebrated", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("tab-songs").click();
  await page.getByTestId("songs-seg-writing").click();
  await page.getByTestId("add-song-btn").click();
  await page.getByTestId("song-title").fill("Night Shift");
  await page.getByTestId("save-song").click();
  await expect(page.getByTestId("song-status-select")).toHaveValue("writing");
  await expect(page.getByTestId("celebration")).toHaveCount(0);

  // the status dropdown sits at the top right, outside Edit, and lists no Ideas
  await expect(page.getByTestId("song-status-select").locator("option")).toHaveText(["Playing", "Learning", "Writing", "Retired"]);
  await page.getByTestId("song-status-select").selectOption("learning");
  await expect(page.getByTestId("song-status-select")).toHaveValue("learning");
  await expect(page.getByTestId("celebration-title")).toHaveText("Out of the writing room!");
  await expect(page.getByTestId("celebration-text")).toHaveText("Night Shift is now Learning");
});

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
  // Upload a demo puts it in the Demos folder (Settings > Google) under its own name and lists it under Demos
  await page.getByTestId("song-upload-demo-input").setInputFiles({ name: "Last Train voice memo.m4a", mimeType: "audio/mp4", buffer: Buffer.from("not really audio") });
  await expect(page.getByTestId("song-upload-demo-done")).toHaveText("Uploaded to Demos.");
  await expect(page.getByTestId("files-demo")).toContainText("Last Train voice memo.m4a");
  // it shows up in the list with its key and length in their own columns
  await page.getByTestId("back").click();
  await page.getByTestId("songs-filter").fill("last train");
  const row = page.getByTestId("songs-list").locator("tbody tr").filter({ hasText: "Last Train" }).first();
  await expect(row).toContainText("E");
  await expect(row).toContainText("4:17");

  // archive from the song's actions menu
  await row.getByRole("link").first().click();
  await expect(page.getByTestId("song-page")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("song-actions").click();
  await page.getByTestId("song-menu-archive").click();
  await expect(page).toHaveURL(/\/songs$/);
});

test("build a setlist template, then seed a show's setlist from it against the set length", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/setlists"));
  await page.getByTestId("new-setlist-name").fill("E2E set");
  await page.getByTestId("new-setlist").click();
  await expect(page.getByTestId("setlist-page")).toBeVisible();
  const templateId = idFromUrl(page, "setlists");

  const titles = page.getByTestId("setlist-items").getByTestId("item-title");
  const add = async (title: string) => { await page.getByTestId("add-song-select").selectOption({ label: title }); await page.getByTestId("add-song-item").click(); await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved"); }; // let each add's save echo back before the next, or the echo resets the list and drops it
  await add("Glass Coast · F#m");
  await add("Weathervane · D");
  await expect(page.getByTestId("break-title")).toHaveValue("Break"); // a new break is "Break", 15:00
  await expect(page.getByTestId("break-len")).toHaveValue("15:00");
  await page.getByTestId("add-break").click();
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  await expect(titles).toHaveText(["Glass Coast", "Weathervane", "Break"]);
  await expect(page.getByTestId("total-time")).toHaveText("23:32"); // 3:52 + 0:30 transition + 4:10 + 15:00; a template counts 30s
  // the break's name and length are click-to-edit on its row
  await page.getByTestId("item-2").getByTestId("item-title").click();
  await page.getByTestId("item-2").getByTestId("item-title-input").fill("Talk / tune");
  await page.getByTestId("item-2").getByTestId("item-title-input").press("Enter");
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  await expect(titles).toHaveText(["Glass Coast", "Weathervane", "Talk / tune"]);
  await page.getByTestId("item-2").getByTestId("item-len").click();
  await page.getByTestId("item-2").getByTestId("item-len-input").fill("1:00");
  await page.getByTestId("item-2").getByTestId("item-len-input").press("Enter");
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  await expect(page.getByTestId("item-2").getByTestId("item-len")).toHaveText("1:00");
  await expect(page.getByTestId("total-time")).toHaveText("9:32");
  await expect(page.getByTestId("total-parts")).toHaveText("2 songs · 1 transition of 30s");
  await expect(page.getByTestId("item-2")).toHaveAttribute("data-kind", "break");
  await expect(page.getByTestId("fit")).toHaveCount(0); // a template has no show

  await expect(page.getByTestId("item-up")).toHaveCount(0); // drag is the only way to reorder
  await expect(page.getByTestId("item-2").getByTestId("item-alt")).toHaveCount(0); // a break has no alternates

  // Alt pins an alternate under Glass Coast; it adds no time
  await page.getByTestId("item-0").getByTestId("item-alt").click();
  await expect(page.getByTestId("alt-dialog")).toBeVisible();
  await page.getByTestId("alt-search").fill("weather");
  await page.getByTestId("alt-dialog").getByTestId("song-search-option").filter({ hasText: "Weathervane" }).click();
  await expect(page.getByTestId("alt-dialog")).toBeHidden();
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  await expect(page.getByTestId("item-0").getByTestId("alt-title")).toHaveText(["Weathervane"]);
  await expect(page.getByTestId("total-time")).toHaveText("9:32");

  // the alternate drags with its song
  await page.getByTestId("item-1").dragTo(page.getByTestId("item-0"));
  await expect(titles).toHaveText(["Weathervane", "Glass Coast", "Talk / tune"]);
  await expect(page.getByTestId("item-1").getByTestId("alt-title")).toHaveText(["Weathervane"]);
  await page.getByTestId("item-2").dragTo(page.getByTestId("item-0"));
  await expect(titles).toHaveText(["Talk / tune", "Weathervane", "Glass Coast"]);
  await page.reload();
  await expect(titles).toHaveText(["Talk / tune", "Weathervane", "Glass Coast"]);
  await expect(page.getByTestId("item-2").getByTestId("alt-title")).toHaveText(["Weathervane"]);

  // open the seeded Hi-Dive show (Nov 14; other tests add more Hi-Dive shows) and seed its Setlist tab from the template
  await page.goto(A("/shows"));
  await page.locator("tr").filter({ hasText: "Hi-Dive" }).filter({ hasText: "Nov 14" }).first().locator("td.date a").click();
  await page.getByTestId("show-tab-setlist").click();
  await expect(page.getByTestId("setlist-tab")).toBeVisible();
  await page.getByTestId("seed-template-actions").click();
  await page.getByTestId(`seed-template-menu-${templateId}`).click();
  await page.getByTestId("seed-mode-replace").click(); // the seeded show already has a setlist
  await page.getByTestId("seed-confirm").click();
  await expect(page.getByTestId("seed-dialog")).toBeHidden();
  await expect(page.getByTestId("setlist-items").getByTestId("item-title")).toHaveText(["Talk / tune", "Weathervane", "Glass Coast"]);
  await expect(page.getByTestId("item-2").getByTestId("alt-title")).toHaveText(["Weathervane"]); // seeding brings the alternate
  await expect(page.getByTestId("total-time")).toHaveText("9:32 of 45:00");
  await expect(page.getByTestId("fit")).toHaveText("Fits");
  await expect(page.getByTestId("setlist-total")).toHaveAttribute("data-over", "0");
  await page.getByTestId("item-2").getByTestId("alt-remove").click();
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  await expect(page.getByTestId("alt")).toHaveCount(0);

  // the show's average transition is saved on the show and counted between the two songs
  await expect(page.getByTestId("transition")).toHaveValue("30");
  await page.getByTestId("transition").selectOption("60");
  await expect(page.getByTestId("total-time")).toHaveText("10:02 of 45:00");
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  await page.reload();
  await expect(page.getByTestId("transition")).toHaveValue("60");
  await expect(page.getByTestId("total-parts")).toContainText("1 transition of 1m");

  // a 40-minute break runs it over; removing it fits again
  await page.getByTestId("break-len").fill("40:00");
  await page.getByTestId("add-break").click();
  await expect(page.getByTestId("total-time")).toHaveText("50:02 of 45:00");
  await expect(page.getByTestId("setlist-total")).toHaveAttribute("data-over", "1");
  await expect(page.getByTestId("fit")).toHaveText("5:02 over");
  await page.getByTestId("item-3").getByTestId("item-remove").click();
  await expect(page.getByTestId("setlist-total")).toHaveAttribute("data-over", "0");
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
  await expect(open).toHaveText(/^Open/);
  await expect(open).toHaveAttribute("href", /fake-drive-demo-1/);
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(page.getByTestId("last-rehearsed")).toContainText("Oct 18");
  for (const t of ["song-edit", "add-from-drive", "song-upload-demo", "run-sharing-check", "fix-share", "fix-copy", "file-remove", "file-gap"]) await expect(page.getByTestId(t)).toHaveCount(0);

  // setlists and rehearsals are readable, read-only
  await page.goto(A("/setlists"));
  await expect(page.getByTestId("new-setlist")).toHaveCount(0);
  await expect(page.getByTestId("setlists-list")).toBeVisible();
  await page.goto(A("/rehearsals"));
  await expect(page.getByTestId("log-rehearsal")).toHaveCount(0);
  // the table shows who was there as initials (seeded Oct 18: Ingrid, Jeff, David, Eric; title = full name)
  const who = page.getByTestId("rehearsals-list").locator("tr", { hasText: "Jeff's basement" }).getByTestId("rehearsal-who");
  for (const [initial, name] of [["I", "Ingrid"], ["J", "Jeff"], ["D", "David"], ["E", "Eric"]]) await expect(who.locator(`[title="${name}"]`)).toHaveText(initial);
  await page.getByTestId("rehearsals-list").getByText("Jeff's basement").click();
  await expect(page.getByTestId("rehearsal-songs")).toContainText("Glass Coast");
  // add-a-song is admin only
  await page.goto(A("/songs/new"));
  await expect(page).toHaveURL(/\/calendar$/);
});

test("create a rehearsal, add songs from the search, attach the recording from Drive", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/rehearsals/new"));
  await page.getByTestId("reh-date").fill("2026-10-20");
  await page.getByTestId("reh-location-input").fill("2363 Champa");
  await page.getByTestId("reh-location-suggestion").first().click();
  for (const n of ["Jeff", "David"]) await page.getByTestId(`reh-who-${n}`).click();
  await page.getByTestId("song-search").fill("low li");
  await page.getByTestId("song-search-option").filter({ hasText: "Low Light" }).click();
  await page.getByTestId("reh-note-Low Light").fill("Ending is loose");
  await page.getByTestId("song-search").fill("Sundial");
  await page.getByTestId("song-search").press("Enter");
  await expect(page.getByTestId("reh-song-Sundial")).toBeVisible();
  await page.getByTestId("drive-q").fill("Rehearsal video");
  await page.getByTestId("drive-search").click();
  await page.getByTestId("hit-Rehearsal video Ruby Hill ending.mp4").getByTestId("hit-check").check();
  await expect(page.getByTestId("hit-Rehearsal video Ruby Hill ending.mp4").getByTestId("hit-kind")).toHaveValue("rehearsal");
  await page.getByTestId("reh-save").click();

  await expect(page).toHaveURL(/\/rehearsals\/[^/]+$/);
  await expect(page.getByTestId("rehearsal-songs")).toContainText("Low Light");
  await expect(page.getByTestId("rehearsal-songs")).toContainText("Ending is loose");
  await expect(page.getByTestId("rehearsal-files")).toContainText("Rehearsal video Ruby Hill ending.mp4");
  await expect(page.getByTestId("reh-songs-card").getByText("Edit", { exact: true })).toHaveCount(0);

  // a song's chevron opens it at this rehearsal: notes autosave and show on the rehearsal, a recording uploads to Drive
  await page.getByTestId("reh-song-row-Low Light").getByTestId("reh-song-open").click();
  await expect(page).toHaveURL(/\/rehearsals\/[^/]+\/songs\/[^/]+$/);
  await expect(page.getByTestId("reh-song-notes")).toHaveValue("Ending is loose");
  await page.getByTestId("reh-song-notes").fill("Ending is loose\nTry a ritard into the last chorus");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  // a trailing space survives the save landing while the box has focus; the song's other files are one tap away
  await page.getByTestId("reh-song-notes").pressSequentially(" ");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await expect(page.getByTestId("reh-song-notes")).toHaveValue("Ending is loose\nTry a ritard into the last chorus ");
  await expect(page.getByTestId("reh-song-refs")).toContainText("Low Light demo");
  await page.getByTestId("reh-song-upload-input").setInputFiles({ name: "New Recording 4.m4a", mimeType: "audio/mp4", buffer: Buffer.from("not really audio") });
  await expect(page.getByTestId("reh-song-upload-done")).toContainText("2026-10-20 Rehearsal");
  await expect(page.getByTestId("reh-song-files")).toContainText("Low Light - 2026-10-20 Rehearsal.m4a");
  await page.getByTestId("back").click();
  await expect(page.getByTestId("rehearsal-songs")).toContainText("Try a ritard");
  await expect(page.getByTestId("rehearsal-files")).toContainText("Low Light - 2026-10-20 Rehearsal.m4a");

  // a voice memo shared into the rehearsal's Drive folder by hand shows up under Check Drive folder; attaching it to a song names it like an upload
  const folders = (await (await fetch(`${DRIVE}/files?parent=fake-folder-rehearsals&mimeType=application/vnd.google-apps.folder`)).json()) as { id: string; name: string }[];
  const folder = folders.find((f) => f.name.includes("2026-10-20"))!;
  await fetch(`${DRIVE}/files`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "New Recording 7.m4a", mimeType: "audio/mp4", parents: [folder.id], ownerEmail: "david@example.com" }) });
  await page.getByTestId("reh-check-folder").click();
  await expect(page.getByTestId("reh-folder-open")).toContainText("2026-10-20 Rehearsal");
  const memo = page.getByTestId("reh-new-New Recording 7.m4a");
  await expect(memo).toBeVisible();
  await expect(memo.getByTestId("reh-new-attach")).toBeDisabled();
  await memo.getByTestId("reh-new-song").selectOption({ label: "Sundial" });
  await memo.getByTestId("reh-new-attach").click();
  await expect(page.getByTestId("reh-new-none")).toContainText("Nothing new in 2026-10-20 Rehearsal");
  await expect(page.getByTestId("rehearsal-files")).toContainText("Sundial - 2026-10-20 Rehearsal.m4a");

  // audio plays inline: Play opens the row into a waveform that fills in as it plays, Hide closes it; video has no Play
  const files = page.getByTestId("rehearsal-files");
  await expect(files.locator('[data-testid^="file-"]').filter({ hasText: "Ruby Hill ending.mp4" }).getByTestId("file-play")).toHaveCount(0);
  const take = files.locator('[data-testid^="file-"]').filter({ hasText: "Low Light - 2026-10-20 Rehearsal.m4a" });
  await take.getByTestId("file-play").click();
  const panel = take.getByTestId("audio-panel");
  await expect(panel.getByTestId("audio-wave").locator("rect").first()).toBeAttached();
  await expect(panel).toHaveAttribute("data-state", "playing");
  await expect(panel.getByTestId("audio-time")).toContainText("/ 0:04");
  await expect(panel.getByTestId("audio-time")).not.toHaveText(/^0:00/);
  await panel.getByTestId("audio-toggle").click();
  await expect(panel).toHaveAttribute("data-state", "paused");
  await take.getByTestId("file-play").click();
  await expect(take.getByTestId("audio-panel")).toHaveCount(0);

  // a song can be added on the rehearsal itself, and taken off again
  await page.getByTestId("reh-song-search").fill("Ruby");
  await page.getByTestId("song-search-option").filter({ hasText: "Ruby Hill" }).click();
  await expect(page.getByTestId("reh-song-row-Ruby Hill")).toBeVisible();
  await page.getByTestId("reh-song-row-Ruby Hill").getByTestId("reh-song-remove").click();
  await expect(page.getByTestId("reh-song-row-Ruby Hill")).toHaveCount(0);

  // "last rehearsed" now reflects it, and the upload is in the song's files
  await page.goto(A("/songs"));
  await page.getByTestId("songs-filter").fill("low light");
  await page.getByTestId("songs-list").getByText("Low Light").first().click();
  await expect(page.getByTestId("last-rehearsed")).toContainText("Oct 20");
  await expect(page.getByTestId("files-rehearsal")).toContainText("Low Light - 2026-10-20 Rehearsal.m4a");
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
  await page.getByTestId("edit-length").fill("4:00");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.getByTestId("undo-button").last().click(); // saves by the same person within 2 minutes fold into one history entry
  await expect(page.getByTestId("edit-length")).not.toHaveValue("4:00");
});
