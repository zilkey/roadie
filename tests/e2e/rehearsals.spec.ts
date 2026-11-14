import { test, expect, type Browser, type Page } from "@playwright/test";
import { A, CAL } from "./env";

async function as(browser: Browser, key: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
  return { page, close: () => ctx.close() };
}

/** Opens a rehearsal from the rehearsal list, by its date label or name. */
async function openRehearsal(page: Page, label: string) {
  await page.goto(A("/rehearsals"));
  await page.getByTestId("rehearsals-list").getByText(label).first().click();
  await expect(page).toHaveURL(/\/rehearsals\/[^/]+$/);
  await expect(page.getByTestId("rehearsal-page")).toBeVisible();
}


/** The seeded Oct 29 rehearsal at The Attic. The seeded admin has home, 28 MPG and regular gas. */
test("admin logs gas from the rehearsal's Money tab: round trip estimate, the line shows in Money out", async ({ browser }) => {
  const { page, close } = await as(browser, "rudy");
  await openRehearsal(page, "Oct 29");
  await page.getByTestId("reh-tab-money").click();
  await page.getByTestId("money-out-open").click();
  const modal = page.getByTestId("money-out-modal");
  await expect(modal.getByTestId("mo-cat")).toHaveValue("Gas"); // from a rehearsal, gas is preselected

  await modal.getByTestId("mo-gas-driver").selectOption({ label: "Rudy" });
  await expect(modal.getByTestId("mo-gas-from-home")).toContainText("home"); // never the address
  await expect(modal.getByTestId("mo-gas-to-rehearsal")).toContainText("The Attic");
  await expect(modal.getByTestId("mo-gas-mpg")).toHaveCount(0); // settings are saved, so no questions
  await expect(modal.getByTestId("mo-gas-estimate")).toContainText("$3.79/gal Denver");
  await expect(modal.getByTestId("mo-gas-estimate")).toContainText("$4.98"); // 36.8 mi at 28 MPG and $3.79/gal

  await modal.getByTestId("mo-save").click();
  await expect(modal).toBeHidden();

  const row = page.getByTestId("paid-out").locator('[data-testid^="expense-row-"]').filter({ hasText: "$4.98" });
  await expect(row.first()).toBeVisible();
  await expect(row.first()).toContainText("Gas");
  await close();
});

/** Members add their own expense on a rehearsal through the shared card's full form; an admin sees it with who paid. */
test("a member adds an expense on a rehearsal (the card links to the full form) and an admin sees it", async ({ browser }) => {
  const what = `Room rental split ${Date.now().toString(36)}`; // stamped: a retry never meets a first attempt's line
  const hugo = await as(browser, "hugo");
  await openRehearsal(hugo.page, "Oct 29");
  await hugo.page.getByTestId("reh-tab-money").click();
  const card = hugo.page.getByTestId("expenses");
  await card.getByTestId("expenses-full-form").click();
  // the full form opens for this rehearsal, gas the default; Back returns to its Money tab
  await expect(hugo.page).toHaveURL(/\/money\/expense\?rehearsalId=/);
  await expect(hugo.page.getByText(/^Rehearsal · /)).toContainText("Oct 29");
  await hugo.page.getByTestId("back").click();
  await expect(hugo.page).toHaveURL(/\/rehearsals\/[^/]+\?tab=money$/);
  await card.getByTestId("expenses-full-form").click();
  await hugo.page.getByTestId("exp-cat").click();
  await hugo.page.getByTestId("exp-cat-opt-space").click();
  await hugo.page.getByTestId("exp-amount").fill("25");
  await hugo.page.getByTestId("expense-what").fill(what);
  await hugo.page.getByTestId("exp-save").click();
  await expect(hugo.page).toHaveURL(/\/rehearsals\/[^/]+$/);
  await expect(card.getByTestId("expense-row").filter({ hasText: what })).toBeVisible();
  await hugo.close();

  const rudy = await as(browser, "rudy");
  await openRehearsal(rudy.page, "Oct 29");
  await rudy.page.getByTestId("reh-tab-money").click();
  // admins have no Expenses card: the member's expense is a line in Money out
  await expect(rudy.page.getByTestId("expenses")).toHaveCount(0);
  await expect(rudy.page.getByTestId("paid-out").locator('[data-testid^="expense-row-"]').filter({ hasText: what })).toBeVisible();
  await rudy.close();
});

/** Your profile: the admin's driving values are shown, and a changed MPG survives a reload. */
test("your profile: the driving and gas card shows the seeded values and an MPG change sticks", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-rudy").click();
  await expect(page).toHaveURL(/\/calendar$/);
  await page.getByTestId("account-menu").click();
  await page.getByRole("menuitem", { name: "Your profile" }).click();
  await expect(page.getByTestId("me-driving-card")).toBeVisible();
  await expect(page.getByTestId("me-home-value")).toContainText("Evergreen");
  await expect(page.getByTestId("me-car-value-0")).toHaveText("Subaru Outback · 28 MPG · Regular");

  // saved settings edit behind Edit; a car's MPG saves on blur
  const setMpg = async (v: string) => {
    await page.getByTestId("me-edit").click();
    await page.getByTestId("me-car-mpg-0").fill(v);
    await page.getByTestId("me-car-mpg-0").blur();
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
    await page.getByTestId("me-done").click();
    await expect(page.getByTestId("me-car-value-0")).toContainText(`${v} MPG`);
  };
  try {
    await setMpg("30");
    await page.reload();
    await expect(page.getByTestId("me-car-value-0")).toContainText("30 MPG");
  } finally {
    // put the seeded value back, so the rehearsal expense checks above see 28 MPG
    await setMpg("28");
  }
});

/**
 * The seeded Oct 29 rehearsal at The Attic: the preview opens, Send puts it on the band calendar, Remove takes it off.
 * The rest (a deleted event staying deleted until "Put it back", linking an event already on the calendar) is
 * tests/emulator/shows.test.ts ("Rehearsals: preview and send...", "Calendar: an event deleted in Google...", "Calendar: an event already on...").
 */
test("a rehearsal goes on the band calendar only from its button, after a preview", async ({ browser, request }) => {
  const { page, close } = await as(browser, "rudy");
  await openRehearsal(page, "Oct 29");
  const line = page.getByTestId("reh-calendar");
  const dlg = page.getByTestId("reh-calendar-dialog");
  // A retry may meet the event the first attempt sent: take it off first.
  await expect(line).toContainText(/band calendar/);
  if ((await line.textContent())?.includes("On the band calendar")) {
    await page.getByTestId("reh-calendar-open").click();
    await dlg.getByTestId("cal-remove").click();
  }
  await expect(line).toContainText("Not on the band calendar");
  await page.getByTestId("reh-calendar-open").click();
  await expect(dlg.getByTestId("cal-preview-calendar")).toHaveText("Nora Quill Band");
  await expect(dlg.getByTestId("cal-preview-title")).toHaveText(/rehearsal at The Attic$/);
  await expect(dlg.getByTestId("cal-preview-when")).toContainText("Oct 29");
  await expect(dlg.getByTestId("cal-preview-where")).toContainText("The Attic");
  await dlg.getByTestId("cal-send").click();
  await expect(line).toContainText("On the band calendar");
  const events = (await (await request.get(`${CAL}/events?calendarId=fake-band-calendar`)).json()) as { title: string }[];
  expect(events.some((e) => /rehearsal at The Attic$/.test(e.title))).toBeTruthy();

  await page.getByTestId("reh-calendar-open").click();
  await dlg.getByTestId("cal-remove").click();
  await expect(line).toContainText("Not on the band calendar");
  await close();
});

/** The seed has Oct 18 (Rudy's basement) and Oct 29 (The Attic); the clock is pinned between them. */
test("rehearsals page splits into Upcoming and Past tables", async ({ browser }) => {
  const { page, close } = await as(browser, "rudy");
  await page.clock.setFixedTime(new Date("2026-10-26T12:00:00-06:00"));
  await page.goto(A("/rehearsals"));
  const upcoming = page.getByTestId("rehearsals-upcoming");
  const past = page.getByTestId("rehearsals-past");
  await expect(upcoming.getByRole("heading", { name: "Upcoming" })).toBeVisible();
  await expect(past.getByRole("heading", { name: "Past" })).toBeVisible();
  await expect(upcoming.getByText("The Attic")).toBeVisible();
  await expect(upcoming.getByText("Rudy's basement")).toHaveCount(0);
  await expect(past.getByText("Rudy's basement")).toBeVisible();
  await expect(past.getByText("The Attic")).toHaveCount(0);
  await close();
});

/** The Notes card edits in place: an admin taps the text, types, leaves it, and it saves; a member reads plain text. */
test("rehearsal notes edit in place for an admin and read as plain text for a member", async ({ browser }) => {
  const note = `Run the new ending twice ${Date.now()}`;
  const { page, close } = await as(browser, "rudy");
  await openRehearsal(page, "Oct 29");
  const card = page.getByTestId("reh-notes-card");
  await expect(card.getByTestId("reh-edit")).toHaveCount(0); // no flip, no Done
  await card.getByTestId("reh-notes").click();
  await page.getByTestId("reh-notes-input").fill(note);
  await page.getByTestId("reh-notes-input").blur();
  await expect(page.getByTestId("reh-notes-saved")).toBeVisible();
  await expect(card.getByTestId("reh-notes")).toContainText(note);
  await page.reload();
  await expect(page.getByTestId("reh-notes-card")).toContainText(note);
  await close();

  const hugo = await as(browser, "hugo");
  await openRehearsal(hugo.page, "Oct 29");
  await expect(hugo.page.getByTestId("reh-notes-card")).toContainText(note);
  await expect(hugo.page.getByTestId("reh-notes")).toHaveCount(0);
  await expect(hugo.page.getByTestId("reh-notes-card").getByRole("button")).toHaveCount(0);
  await hugo.close();
});

/** A song opened from a rehearsal shows its chart and lyrics; its note shows on the rehearsal list; a typed trailing space stays. */
test("the rehearsal song page lists the song's chart, shows its note on the rehearsal, and keeps a trailing space while typing", async ({ browser }) => {
  const { page, close } = await as(browser, "rudy");
  await openRehearsal(page, "Oct 18");
  const row = page.getByTestId("reh-song-row-Glass Coast");
  await expect(row.getByTestId("reh-song-note")).toContainText("Tighten the bridge");
  await row.getByTestId("reh-song-open").click();
  await expect(page.getByTestId("rehearsal-song-page")).toBeVisible();
  await expect(page.getByTestId("reh-song-docs-chart")).toContainText("Glass Coast chart F#m.docx");
  await expect(page.getByTestId("reh-song-docs-chart").getByTestId("file-open")).toHaveAttribute("href", /fake-drive-chart-1/);

  const notes = page.getByTestId("reh-song-notes");
  await notes.click();
  await notes.press("Control+End");
  await notes.pressSequentially(" hello ");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await expect(notes).toBeFocused();
  expect(await notes.inputValue()).toMatch(/hello $/);
  await notes.blur();
  expect(await notes.inputValue()).toMatch(/hello$/);
  await page.getByTestId("back").click();
  await expect(page.getByTestId("reh-song-row-Glass Coast").getByTestId("reh-song-note")).toContainText("Tighten the bridge");
  await close();
});

/** Back goes where you came from: rehearsal -> its song -> the song page, Back lands on the rehearsal's song, not "All songs". */
test("Back on the song page returns to the rehearsal song it was opened from", async ({ browser }) => {
  const { page, close } = await as(browser, "rudy");
  await openRehearsal(page, "Oct 18");
  await page.getByTestId("reh-song-row-Glass Coast").getByTestId("reh-song-open").click();
  await expect(page.getByTestId("rehearsal-song-page")).toBeVisible();
  await page.getByTestId("open-song").click();
  await expect(page.getByTestId("song-page")).toBeVisible();
  await expect(page.getByTestId("back")).toHaveText("← Back");
  await page.getByTestId("back").click();
  await expect(page.getByTestId("rehearsal-song-page")).toBeVisible();
  await expect(page).toHaveURL(/\/rehearsals\/[^/]+\/songs\/[^/]+$/);
  await close();
});

/** The metronome plays the song's BPM from the rehearsal's song list, keeps going onto that song's page, and a second tap stops it. */
test("a rehearsal song's metronome starts from the list and stops from the song page", async ({ browser }) => {
  const { page, close } = await as(browser, "rudy");
  await openRehearsal(page, "Oct 18");
  const tick = page.getByTestId("reh-song-row-Glass Coast").getByTestId("metronome");
  await expect(tick).toHaveAttribute("data-bpm", "96");
  await tick.click();
  await expect(tick).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/\/rehearsals\/[^/]+$/); // the tap plays; it doesn't open the song
  await page.getByTestId("reh-song-row-Glass Coast").getByTestId("reh-song-open").click();
  const onPage = page.getByTestId("rehearsal-song-page").getByTestId("metronome");
  await expect(onPage).toHaveAttribute("aria-pressed", "true");
  await onPage.click();
  await expect(onPage).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("open-song").click();
  const onSong = page.getByTestId("song-page").getByTestId("metronome");
  await expect(onSong).toHaveAttribute("data-bpm", "96");
  await onSong.click();
  await expect(onSong).toHaveAttribute("aria-pressed", "true");
  await onSong.click();
  await expect(onSong).toHaveAttribute("aria-pressed", "false");
  await close();
});

/** People: an admin gives a bandmate a home and two cars in their Edit sheet; logging their gas then asks which car. */
test("an admin sets a bandmate's home and cars on People; the gas form asks which car and uses its MPG", async ({ browser }) => {
  const { page, close } = await as(browser, "rudy");
  const openFelix = async () => {
    await page.goto(A("/admin/people"));
    await page.getByTestId("person-row-felix@example.com").getByTestId("person-actions").click();
    await page.getByTestId("person-menu-edit").click();
    await expect(page.getByTestId("person-sheet-driving")).toBeVisible();
  };
  await openFelix();
  const sheet = page.getByTestId("person-sheet");
  await sheet.getByTestId("person-sheet-home").fill("742 Evergreen");
  await sheet.getByTestId("person-sheet-home-suggestion").first().click();
  await sheet.getByTestId("person-sheet-car-add").click();
  await sheet.getByTestId("person-sheet-car-name-0").fill("Outback");
  await sheet.getByTestId("person-sheet-car-mpg-0").fill("28");
  await sheet.getByTestId("person-sheet-car-add").click();
  await sheet.getByTestId("person-sheet-car-name-1").fill("Truck");
  await sheet.getByTestId("person-sheet-car-mpg-1").fill("abc");
  await sheet.getByTestId("person-sheet-save").click();
  await expect(sheet.getByTestId("person-sheet-car-mpg-error-1")).toHaveText("Enter a number above 0"); // nothing saved yet
  await sheet.getByTestId("person-sheet-car-mpg-1").fill("14");
  await sheet.getByTestId("person-sheet-save").click();
  await expect(sheet).toBeHidden();

  try {
    await openRehearsal(page, "Oct 29");
    await page.getByTestId("reh-tab-money").click();
    await page.getByTestId("money-out-open").click();
    const modal = page.getByTestId("money-out-modal");
    await modal.getByTestId("mo-gas-driver").selectOption({ label: "Felix" });
    await expect(modal.getByTestId("mo-gas-from-home")).toContainText("home");
    await expect(modal.getByTestId("mo-gas-estimate")).toContainText("needs a car");
    await modal.getByTestId("mo-gas-car").selectOption({ label: "Outback · 28 MPG" });
    await expect(modal.getByTestId("mo-gas-estimate")).toContainText("Outback, 28 mpg"); // the miles-and-price math is tests/emulator/gas.test.ts
    await modal.getByTestId("mo-gas-car").selectOption({ label: "Truck · 14 MPG" });
    await expect(modal.getByTestId("mo-gas-estimate")).toContainText("Truck, 14 mpg");
  } finally {
    // leave Felix as seeded (no home, no car) for the other specs
    await openFelix();
    await sheet.getByTestId("person-sheet-home").fill("");
    await sheet.getByTestId("person-sheet-car-remove-1").click();
    await sheet.getByTestId("person-sheet-car-remove-0").click();
    await sheet.getByTestId("person-sheet-save").click();
    await expect(sheet).toBeHidden();
    await openFelix();
    await expect(sheet.getByTestId("person-sheet-car-name-0")).toHaveCount(0);
    await expect(sheet.getByTestId("person-sheet-home")).toHaveValue("");
    await close();
  }
});
