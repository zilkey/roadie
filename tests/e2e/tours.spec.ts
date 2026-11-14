import fs from "node:fs";
import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { APP, AUTH, FIRESTORE, A, ARTIST_SLUG } from "./env";
import { SEED, fmtLongYear, fmtPitchDate, mmmD, monthOf } from "./dates";
import { addDays } from "../../src/lib/shows";
import { dayLabel, fmtTourDates } from "../../src/lib/tours";

// The tour runs from three days before the Creamery pitch's first date to the day after its second, whatever today is.
// Every day below is derived from START; the span can cross a month or a year, so nothing here assumes one calendar month.
const START = addDays(SEED.creamery1, -3);
const END = addDays(SEED.creamery2, 1);
const END_EDITED = addDays(END, 1);
const D_STAY = addDays(START, 1); // the notes and the stay (2 nights)
const D_NIGHT2 = addDays(START, 2);
const D_SWALLOW = addDays(SEED.creamery1, 2); // the Swallow Hill option
const CREAMERY = SEED.creamery1;

async function as(browser: Browser, key: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
  return { page, close: () => ctx.close() };
}

// One tour, made in the first test and read by the others (the suite runs in order on one seeded database).
let tourUrl = "";

// The tour is removed through the command API in afterAll, so a rerun (or a retry) starts without it and the Tours list is not left with it.
let api: APIRequestContext;
test.beforeAll(async ({ playwright }) => { api = await playwright.request.newContext(); });
test.afterAll(async () => {
  if (tourUrl) {
    const auth = await api.post(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo`, {
      data: {
        postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: "dev-rudy", email: "rudy@example.com", email_verified: true, name: "Rudy" }))}&providerId=google.com`,
        requestUri: "http://localhost", returnIdpSignInMethod: true, returnSecureToken: true,
      },
    });
    const token = ((await auth.json()) as { idToken: string }).idToken;
    const artists = await api.get(`http://${FIRESTORE}/v1/projects/demo-band-tracker/databases/(default)/documents/artists`, { headers: { authorization: "Bearer owner" } });
    const docs = ((await artists.json()) as { documents: { name: string; fields: { slug?: { stringValue: string } } }[] }).documents;
    const artistId = docs.find((d) => d.fields.slug?.stringValue === ARTIST_SLUG)!.name.split("/").pop()!;
    await api.post(`${APP}/api/commands/tours.remove`, { data: { id: tourUrl.split("/").pop() }, headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } });
  }
  await api.dispose();
});

test.describe.serial("tours", () => {
  /** The seeded Creamery Arts Center pitch offers SEED.creamery1 and creamery2; the Duo act's project is Duo. */
  test("admin creates a tour from a draft: nothing is made until Create Tour, and the pitch in range comes along", async ({ browser }) => {
    const { page, close } = await as(browser, "rudy");
    await page.goto(A("/tours"));
    await page.getByTestId("new-tour").click();
    await expect(page).toHaveURL(/\/tours\/new$/);

    await page.getByTestId("tour-name-input").fill("Mountain West");
    await page.getByTestId("tour-start").fill(START);
    await page.getByTestId("tour-end").fill(END);
    await page.getByTestId("tour-act").selectOption({ label: "Duo" });
    await expect(page.getByTestId("tour-project").locator("option:checked")).toHaveText("Duo");
    await expect(page.getByTestId("tour-who-Rudy")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("tour-who-Hugo")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("tour-pitch-Creamery Arts Center")).toContainText(fmtPitchDate(CREAMERY));
    await expect(page.getByTestId("draft-status")).toHaveText("Draft saved");

    // A draft, not a tour: leaving and coming back finds the values, and the list is still empty.
    await page.goto(A("/tours"));
    await expect(page.getByTestId("tours-list").locator('[data-testid^="tour-row-"]').filter({ hasText: "Mountain West" })).toHaveCount(0);
    await page.goto(A("/tours/new"));
    await expect(page.getByTestId("tour-name-input")).toHaveValue("Mountain West");
    await expect(page.getByTestId("draft-restored")).toBeVisible();

    await page.getByTestId("create-tour").click();
    await expect(page).toHaveURL(/\/tours\/(?!new)[^/?]+$/);
    tourUrl = new URL(page.url()).pathname;
    await expect(page.getByTestId("tour-title")).toContainText("Mountain West");
    await expect(page.getByTestId("tour-status-pill")).toHaveText("Planning");
    await expect(page.getByTestId("tour-meta")).toHaveText(`${fmtTourDates(START, END)} · Duo`);
    await expect(page.getByTestId("tour-tab-plan")).toHaveAttribute("aria-selected", "true");

    await page.getByTestId("back").click();
    const row = page.getByTestId("tours-list").locator('[data-testid^="tour-row-"]').filter({ hasText: "Mountain West" });
    await expect(row).toContainText("Duo · 2 people");
    await expect(row.getByTestId("tour-pitches")).toHaveText("1");
    await expect(row.getByTestId("tour-net")).toHaveText("$0.00");
    await close();
  });

  test("admin edits a detail in place on the Info tab, then undoes it", async ({ browser }) => {
    const { page, close } = await as(browser, "rudy");
    await page.goto(`${tourUrl}?tab=info`);
    await expect(page.getByTestId("tour-end")).toHaveText(fmtLongYear(END));
    await page.getByTestId("tour-end").click();
    await page.getByTestId("tour-end-input").fill(END_EDITED);
    await page.getByTestId("tour-end-input").press("Enter");
    await expect(page.getByTestId("tour-end")).toHaveText(fmtLongYear(END_EDITED));
    await expect(page.getByTestId("tour-meta")).toHaveText(`${fmtTourDates(START, END_EDITED)} · Duo`);

    await page.getByTestId("toast").filter({ hasText: "endDate" }).getByTestId("undo-button").click();
    await expect(page.getByTestId("tour-end")).toHaveText(fmtLongYear(END));
    await expect(page.getByTestId("tour-meta")).toHaveText(`${fmtTourDates(START, END)} · Duo`);
    await close();
  });

  test("a member reads the tour without the Money tab, even by URL, and without Net on the list", async ({ browser }) => {
    const { page, close } = await as(browser, "hugo");
    await page.goto(A("/tours"));
    await expect(page.getByTestId("new-tour")).toHaveCount(0);
    const row = page.getByTestId("tours-list").locator('[data-testid^="tour-row-"]').filter({ hasText: "Mountain West" });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("tour-net")).toHaveCount(0);
    await expect(row.getByTestId("tour-pitches")).toHaveCount(0);

    await page.goto(`${tourUrl}?tab=money`);
    await expect(page.getByTestId("tour-tab-plan")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("tour-tab-money")).toHaveCount(0);
    await expect(page.getByTestId("tour-money")).toHaveCount(0);
    await expect(page.getByTestId("page-title")).toHaveText("Mountain West");

    await page.getByTestId("tour-tab-info").click();
    await expect(page.getByTestId("tour-end")).toHaveText(fmtLongYear(END));
    await expect(page.getByRole("button", { name: "Edit Ends" })).toHaveCount(0);
    await expect(page.getByTestId("tour-coming-Rudy")).toBeDisabled();
    await close();
  });

  // The Plan tab. The tour runs START to END, with the Creamery Arts Center pitch as options on its two dates.
  test("plan: + between two entries adds there, and the order holds after a reload", async ({ browser }) => {
    const { page, close } = await as(browser, "rudy");
    await page.goto(tourUrl);
    const day = page.getByTestId(`plan-day-${D_STAY}`);
    await expect(page.getByTestId(`plan-day-${CREAMERY}`).locator('[data-kind="option"]')).toContainText("Creamery Arts Center");

    // An empty day: + Add → Note….
    await day.getByTestId(`plan-plus-${D_STAY}-0-actions`).click();
    await page.getByTestId(`plan-plus-${D_STAY}-0-menu-note`).click();
    await page.getByTestId("entry-text").fill("Load the van");
    await page.getByTestId("entry-add").click();
    await expect(day.getByTestId("plan-entry")).toHaveText([/Load the van/]);

    // After the note: a stay, with an explicit Add.
    await day.getByTestId(`plan-plus-${D_STAY}-1-actions`).click();
    await page.getByTestId(`plan-plus-${D_STAY}-1-menu-stay`).click();
    await expect(page.getByTestId("entry-new-stay")).toBeVisible();
    await page.getByTestId("entry-name").fill("The van");
    await page.getByTestId("entry-add").click();
    await expect(day.getByTestId("plan-entry")).toHaveCount(2);

    // Between the two: another note lands in the middle.
    await day.getByTestId(`plan-plus-${D_STAY}-1-actions`).click();
    await page.getByTestId(`plan-plus-${D_STAY}-1-menu-note`).click();
    await page.getByTestId("entry-text").fill("Gas up");
    await page.getByTestId("entry-add").click();
    const order = [/Load the van/, /Gas up/, /Stay · The van/];
    await expect(day.getByTestId("plan-entry")).toHaveText(order);
    await page.reload();
    await expect(page.getByTestId(`plan-day-${D_STAY}`).getByTestId("plan-entry")).toHaveText(order);

    // The night of the 10th is covered now; the 9th still asks for one.
    await expect(page.getByTestId(`plan-day-${D_STAY}`).getByTestId("plan-no-stay")).toHaveCount(0);
    await expect(page.getByTestId(`plan-day-${START}`).getByTestId("plan-no-stay")).toContainText("No stay tonight.");
    await close();
  });

  test("plan: clicking a stay opens it autosaving, with one Done", async ({ browser }) => {
    const { page, close } = await as(browser, "rudy");
    await page.goto(tourUrl);
    const day = page.getByTestId(`plan-day-${D_STAY}`);
    await day.locator('[data-kind="stay"]').getByTestId("plan-entry-open").click();
    await expect(page.getByTestId("entry-edit-stay")).toBeVisible();
    await expect(page.getByTestId("entry-add")).toHaveCount(0);
    await page.getByTestId("entry-name").fill("Motel 6");
    await page.getByTestId("entry-nights").fill("2");
    await page.getByTestId("entry-nights").press("Enter");
    await expect(page.getByTestId("entry-edit-stay").getByTestId("save-status")).toContainText("Saved");
    await page.getByTestId("entry-done").click();
    await expect(page.getByTestId("entry-modal")).toBeHidden();
    await expect(day.locator('[data-kind="stay"]')).toContainText("Stay · Motel 6");
    await expect(day.locator('[data-kind="stay"]')).toContainText("2 nights");
    // Two nights cover the 11th too.
    await expect(page.getByTestId(`plan-day-${D_NIGHT2}`).getByTestId("plan-no-stay")).toHaveCount(0);
    await close();
  });

  test("plan: dragging a venue onto a day pitches it for that date", async ({ browser }) => {
    const { page, close } = await as(browser, "rudy");
    await page.goto(tourUrl);
    await page.getByTestId("tray-search").fill("Swallow Hill");
    const item = page.getByTestId("tray-items").locator("li").filter({ hasText: "Swallow Hill Music" });
    // (An earlier spec may have pitched it already; then its open pitch gets the date.)
    await expect(item).toBeVisible();
    const day = page.getByTestId(`plan-day-${D_SWALLOW}`);
    // The tray is sticky, so it stays beside the day while the day scrolls into view.
    await day.scrollIntoViewIfNeeded();
    await item.dragTo(day.locator(".tp-dlist"));
    await expect(day.locator('[data-kind="option"]')).toContainText("Swallow Hill Music");
    await close();
  });

  test("plan: a member sees the band's entries only, with nothing to change", async ({ browser }) => {
    const { page, close } = await as(browser, "hugo");
    await page.goto(tourUrl);
    await expect(page.getByTestId(`plan-day-${D_STAY}`).getByTestId("plan-entry")).toHaveText([/Load the van/, /Gas up/, /Stay · Motel 6/]);
    await expect(page.getByTestId("tour-tray")).toHaveCount(0);
    await expect(page.getByTestId("plan-bucket")).toHaveCount(0);
    await expect(page.locator('[data-kind="option"]')).toHaveCount(0);
    await expect(page.getByTestId("plan-entry-x")).toHaveCount(0);
    await expect(page.getByTestId("plan-entry-open")).toHaveCount(0);
    await expect(page.getByTestId(`plan-plus-${D_STAY}-0-actions`)).toHaveCount(0);
    await expect(page.getByTestId("plan-stat-open")).toHaveCount(0);
    await close();
  });
  // Money. The tour has a drive on its first day (no places), and the stay "Motel 6" on the next two nights. (The tour totals, by day and
  // pinned to a stay, are covered by tests/emulator/tours.test.ts and tests/unit/tours.test.ts.)
  test("money: a drive on the first day for the expense test to pin to", async ({ browser }) => {
    const { page, close } = await as(browser, "rudy");
    await page.goto(tourUrl);
    const day = page.getByTestId(`plan-day-${START}`);
    await day.getByTestId(`plan-plus-${START}-0-actions`).click();
    await page.getByTestId(`plan-plus-${START}-0-menu-drive`).click();
    await page.getByTestId("entry-add").click();
    await expect(day.locator('[data-kind="drive"]')).toHaveCount(1);
    await close();
  });

  test("money: a member adds an expense from the tour on a drive; it lands back on the tour tagged to the drive", async ({ browser }) => {
    const WHAT = `Gas to the first show ${Date.now()}`;
    const { page, close } = await as(browser, "hugo");
    await page.goto(tourUrl);
    await page.getByTestId("tour-add-expense").click();
    await expect(page).toHaveURL(/\/money\/expense\?tourId=/);
    await expect(page.getByTestId("expense-on")).toBeVisible();
    const drive = await page.getByTestId("expense-on").locator("option", { hasText: "Drive" }).getAttribute("value");
    await page.getByTestId("expense-on").selectOption(drive!);
    await page.getByTestId("exp-cat").fill("gas");
    await page.getByTestId("exp-cat-opt-gas").click();
    await page.getByTestId("exp-amount").fill("38.50");
    await page.getByTestId("expense-what").fill(WHAT);
    await page.getByTestId("exp-save").click();
    await expect(page).toHaveURL(new RegExp(`${tourUrl}$`));
    await close();

    const admin = await as(browser, "rudy");
    await admin.page.goto(`${tourUrl}?tab=money`);
    const row = admin.page.getByTestId("paid-out").locator('[data-testid^="expense-row-"]', { hasText: WHAT });
    await expect(row).toContainText("Hugo paid");
    await expect(row).toContainText(mmmD(START));
    await expect(row).toContainText("Drive");
    await expect(admin.page.getByTestId("tour-spent-amount")).toHaveText("$38.50");
    await admin.page.getByTestId(`tour-day-${START}`).click();
    await expect(admin.page.getByTestId("paid-out")).toContainText(WHAT);
    await admin.close();
  });
  // Booking (#45). Creamery Arts Center is an option on its two dates since the first test.
  test("booking: Book on an option with another option that night; the other waits in No date yet and we land on the show", async ({ browser }) => {
    const { page, close } = await as(browser, "rudy");
    await page.goto(tourUrl);
    const day = page.getByTestId(`plan-day-${CREAMERY}`);
    await page.getByTestId("tray-search").fill("Marisol");
    const item = page.getByTestId("tray-items").locator("li").filter({ hasText: "Marisol' Other Side" });
    await day.scrollIntoViewIfNeeded();
    await item.dragTo(day.locator(".tp-dlist"));
    await expect(day.locator('[data-kind="option"]')).toHaveCount(2);

    await day.locator('[data-kind="option"]').filter({ hasText: "Creamery Arts Center" }).getByTestId("plan-book").click();
    const dialog = page.getByTestId("book-dialog");
    await expect(dialog).toContainText("Book Creamery Arts Center");
    await expect(dialog.getByTestId(`book-date-${CREAMERY}`)).toBeChecked();
    await expect(dialog.getByTestId(`book-date-${SEED.creamery2}`)).not.toBeChecked();
    const other = dialog.locator('fieldset[data-testid^="book-other-"]');
    await expect(other).toHaveCount(1);
    await expect(other).toContainText("Marisol' Other Side");
    await expect(other.locator('input[data-testid$="-drop"]')).toBeChecked();
    await expect(dialog.getByTestId("book-stay")).toBeChecked();
    await dialog.getByTestId("book-submit").click();

    await expect(page).toHaveURL(/\/shows\/[^/?]+$/);
    await expect(page.getByTestId("where-tour")).toContainText(/Mountain West · day \d+ of \d+/);

    await page.goto(tourUrl);
    const booked = page.getByTestId(`plan-day-${CREAMERY}`);
    await expect(booked.locator('[data-kind="show"]')).toContainText("Creamery Arts Center");
    await expect(booked.locator('[data-kind="option"]')).toHaveCount(0);
    await expect(booked.locator('[data-kind="stay"]')).toHaveCount(1);
    await expect(page.getByTestId(`plan-day-${SEED.creamery2}`).locator('[data-kind="option"]')).toHaveCount(0);
    await expect(page.getByTestId("plan-bucket")).toContainText("Marisol' Other Side");
    await close();
  });

  test("booking: a pitch's tour changes from the pitch page, and its option follows", async ({ browser }) => {
    const { page, close } = await as(browser, "rudy");
    await page.goto(tourUrl);
    // Swallow Hill Music is an option on D_SWALLOW since the drag test.
    await page.getByTestId(`plan-day-${D_SWALLOW}`).locator('[data-kind="option"]').filter({ hasText: "Swallow Hill Music" }).locator("a").click();
    await expect(page).toHaveURL(/\/booking\/pitches\//);
    const card = page.getByTestId("pitch-tour-card");
    await expect(card.getByTestId("pitch-tour")).toContainText("Mountain West");
    await expect(card.getByTestId("pitch-tour-plan")).toContainText(dayLabel(D_SWALLOW));

    await card.getByTestId("pitch-tour").click();
    await card.getByTestId("pitch-tour-input").selectOption({ value: "" });
    await expect(card.getByTestId("pitch-tour")).toContainText("No tour");
    await expect(card.getByTestId("pitch-tour-open")).toHaveCount(0);
    await page.goto(tourUrl);
    await expect(page.getByTestId(`plan-day-${D_SWALLOW}`).locator('[data-kind="option"]')).toHaveCount(0);
    await page.goBack();

    await page.getByTestId("pitch-tour").click();
    await page.getByTestId("pitch-tour-input").selectOption({ label: "Mountain West" });
    await expect(page.getByTestId("pitch-tour-plan")).toContainText(dayLabel(D_SWALLOW));
    await page.getByTestId("pitch-tour-open").click();
    await expect(page.getByTestId(`plan-day-${D_SWALLOW}`).locator('[data-kind="option"]')).toContainText("Swallow Hill Music");
    await close();
  });
  test("calendar: the Tours switch lays the tour over its days, and stays on for that person", async ({ browser }) => {
    const tourId = tourUrl.split("/").pop()!;
    const { page, close } = await as(browser, "rudy");
    await page.goto(A(`/calendar?m=${monthOf(D_STAY)}`));
    const toggle = page.getByTestId("calendar-tours-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId(`tour-bar-${tourId}`)).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`tour-bar-${tourId}`)).toContainText("Mountain West");
    await expect(page.getByTestId(`day-${D_STAY}`).getByTestId("tour-chip").filter({ hasText: "Motel 6" })).toHaveCount(1);
    await page.getByTestId(`day-${D_STAY}`).click();
    await expect(page.getByTestId("tour-panel")).toContainText("Mountain West");

    await page.reload();
    await expect(page.getByTestId("calendar-tours-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`tour-bar-${tourId}`)).toBeVisible();
    await page.getByTestId("calendar-tours-toggle").click();
    await expect(page.getByTestId(`tour-bar-${tourId}`)).toHaveCount(0);
    await close();

    // Another person's calendar never had it on.
    const hugo = await as(browser, "hugo");
    await hugo.page.goto(A(`/calendar?m=${monthOf(D_STAY)}`));
    await expect(hugo.page.getByTestId("calendar-tours-toggle")).toHaveAttribute("aria-pressed", "false");
    await hugo.close();
  });
  test("a Done tour reads as history: no tray or No date yet, full-width days, Who came; back to Planning restores them", async ({ browser }) => {
    const { page, close } = await as(browser, "rudy");
    await page.goto(`${tourUrl}?tab=info`);
    // The label sits on the click-to-edit value's line.
    const label = await page.getByTestId("tour-details-card").locator("dt", { hasText: "Ends" }).boundingBox();
    const value = await page.getByTestId("tour-end").boundingBox();
    expect(Math.abs((label!.y + label!.height / 2) - (value!.y + value!.height / 2))).toBeLessThan(2);

    await page.getByTestId("tour-status").click();
    await page.getByTestId("tour-status-input").selectOption("done");
    await expect(page.getByTestId("tour-status-pill")).toHaveText("Done");
    const who = page.getByTestId("tour-who-card");
    await expect(who.locator("h2")).toHaveText("Who came");
    await expect(who.getByTestId("tour-member-row")).toHaveCount(2);
    await expect(who).toContainText("Rudy");
    await expect(who).not.toContainText("Hugo");
    await expect(who.locator("input")).toHaveCount(0);

    await page.getByTestId("tour-tab-plan").click();
    await expect(page.getByTestId("plan-days")).toBeVisible();
    await expect(page.getByTestId("tour-tray")).toHaveCount(0);
    await expect(page.getByTestId("plan-bucket")).toHaveCount(0);
    const plan = await page.getByTestId("tour-plan").boundingBox();
    const days = await page.getByTestId("plan-days").boundingBox();
    expect(days!.width).toBeGreaterThan(plan!.width - 2);

    await page.getByTestId("tour-tab-info").click();
    await page.getByTestId("tour-status").click();
    await page.getByTestId("tour-status-input").selectOption("planning");
    await expect(page.getByTestId("tour-who-card").locator("h2")).toHaveText("Who's going");
    await expect(page.getByTestId("tour-coming-Rudy")).toBeChecked();
    await page.getByTestId("tour-tab-plan").click();
    await expect(page.getByTestId("tour-tray")).toBeVisible();
    await expect(page.getByTestId("plan-bucket")).toBeVisible();
    await close();
  });

  // The Sheet tab (#52), on the plan the tests above built: D_STAY has Load the van, Gas up and Motel 6 for 2 nights, the Creamery day the
  // booked Creamery Arts Center, D_SWALLOW a Swallow Hill option, and Marisol waits in No date yet.
  // (A member's sheet has no options, bucket or Copy: tests/unit/tours-sheet.test.ts and tests/emulator/tours-sheet.test.ts.)
  test("sheet: admin reads a row per day with options, downloads the CSV, then copies to Google Sheets and updates it", async ({ browser }) => {
    const { page, close } = await as(browser, "rudy");
    await page.goto(`${tourUrl}?tab=sheet`);
    await expect(page.getByTestId("tour-tab-sheet")).toHaveAttribute("aria-selected", "true");
    const mar10 = page.getByTestId(`sheet-row-${D_STAY}`);
    await expect(mar10).toContainText("Load the van");
    await expect(mar10.getByTestId("sheet-stay")).toContainText("Motel 6");
    await expect(page.getByTestId(`sheet-row-${D_NIGHT2}`).getByTestId("sheet-stay")).toContainText("night 2 of 2");
    await expect(page.getByTestId(`sheet-row-${CREAMERY}`).getByTestId("sheet-show")).toContainText("Creamery Arts Center");
    const mar14 = page.getByTestId(`sheet-row-${D_SWALLOW}`);
    await expect(mar14.getByTestId("sheet-open-day")).toBeVisible();
    await expect(mar14.getByTestId("sheet-option")).toContainText("Swallow Hill Music");
    await expect(page.getByTestId("sheet-bucket")).toContainText("Marisol' Other Side");

    await mar10.getByTestId("sheet-entry").filter({ hasText: "Load the van" }).click();
    await expect(page.getByTestId("entry-modal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("entry-modal")).toBeHidden();

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sheet-csv").click()]);
    expect(download.suggestedFilename()).toBe("Mountain West.csv");
    const csv = fs.readFileSync((await download.path())!, "utf8");
    expect(csv.split("\r\n")[0]).toBe("Date,Day,Town,Drive,Show,Times,Set,Sound,Contact,Stay,Notes");
    expect(csv).toContain("Swallow Hill Music");

    await expect(page.getByTestId("sheet-open")).toHaveCount(0);
    await expect(page.getByTestId("sheet-copy")).toHaveText("Copy to Google Sheets");
    await page.getByTestId("sheet-copy").click();
    await expect(page.getByTestId("sheet-linked")).toContainText("by Rudy");
    await expect(page.getByTestId("sheet-open")).toHaveAttribute("href", /\/files\/fake-new-\d+$/);
    const href = await page.getByTestId("sheet-open").getAttribute("href");
    await expect(page.getByTestId("sheet-copy")).toHaveText("Update sheet");
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("sheet-copy").click();
    await expect(page.getByText("Updated the Google Sheet")).toBeVisible();
    await expect(page.getByTestId("sheet-open")).toHaveAttribute("href", href!);
    await close();
  });
});
