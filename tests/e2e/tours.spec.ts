import { test, expect, type Browser } from "@playwright/test";
import { A } from "./env";

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

test.describe.serial("tours", () => {
  /** The seeded Dairy Arts Center pitch offers Mar 12 and 19, 2027; the Duo act's project is Duo. */
  test("admin creates a tour from a draft: nothing is made until Create Tour, and the pitch in range comes along", async ({ browser }) => {
    const { page, close } = await as(browser, "jeff");
    await page.goto(A("/tours"));
    await page.getByTestId("new-tour").click();
    await expect(page).toHaveURL(/\/tours\/new$/);

    await page.getByTestId("tour-name-input").fill("Mountain West");
    await page.getByTestId("tour-start").fill("2027-03-09");
    await page.getByTestId("tour-end").fill("2027-03-20");
    await page.getByTestId("tour-act").selectOption({ label: "Duo" });
    await expect(page.getByTestId("tour-project").locator("option:checked")).toHaveText("Duo");
    await expect(page.getByTestId("tour-who-Jeff")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("tour-who-David")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("tour-pitch-Dairy Arts Center")).toContainText("Mar 12");
    await expect(page.getByTestId("draft-status")).toHaveText("Draft saved");

    // A draft, not a tour: leaving and coming back finds the values, and the list is still empty.
    await page.goto(A("/tours"));
    await expect(page.getByTestId("tours-empty")).toBeVisible();
    await page.goto(A("/tours/new"));
    await expect(page.getByTestId("tour-name-input")).toHaveValue("Mountain West");
    await expect(page.getByTestId("draft-restored")).toBeVisible();

    await page.getByTestId("create-tour").click();
    await expect(page).toHaveURL(/\/tours\/(?!new)[^/?]+$/);
    tourUrl = new URL(page.url()).pathname;
    await expect(page.getByTestId("tour-title")).toContainText("Mountain West");
    await expect(page.getByTestId("tour-status-pill")).toHaveText("Planning");
    await expect(page.getByTestId("tour-meta")).toHaveText("Mar 9–20, 2027 · Duo");
    await expect(page.getByTestId("tour-tab-plan")).toHaveAttribute("aria-selected", "true");

    await page.getByTestId("back").click();
    const row = page.getByTestId("tours-list").locator('[data-testid^="tour-row-"]').filter({ hasText: "Mountain West" });
    await expect(row).toContainText("Duo · 2 people");
    await expect(row.getByTestId("tour-pitches")).toHaveText("1");
    await expect(row.getByTestId("tour-net")).toHaveText("$0.00");
    await close();
  });

  test("admin edits a detail in place on the Info tab, then undoes it", async ({ browser }) => {
    const { page, close } = await as(browser, "jeff");
    await page.goto(`${tourUrl}?tab=info`);
    await expect(page.getByTestId("tour-end")).toHaveText("Sat, Mar 20, 2027");
    await page.getByTestId("tour-end").click();
    await page.getByTestId("tour-end-input").fill("2027-03-21");
    await page.getByTestId("tour-end-input").press("Enter");
    await expect(page.getByTestId("tour-end")).toHaveText("Sun, Mar 21, 2027");
    await expect(page.getByTestId("tour-meta")).toHaveText("Mar 9–21, 2027 · Duo");

    await page.getByTestId("toast").filter({ hasText: "endDate" }).getByTestId("undo-button").click();
    await expect(page.getByTestId("tour-end")).toHaveText("Sat, Mar 20, 2027");
    await expect(page.getByTestId("tour-meta")).toHaveText("Mar 9–20, 2027 · Duo");
    await close();
  });

  test("a member reads the tour without the Money tab, even by URL, and without Net on the list", async ({ browser }) => {
    const { page, close } = await as(browser, "david");
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
    await expect(page.getByTestId("tour-end")).toHaveText("Sat, Mar 20, 2027");
    await expect(page.getByRole("button", { name: "Edit Ends" })).toHaveCount(0);
    await expect(page.getByTestId("tour-coming-Jeff")).toBeDisabled();
    await close();
  });

  // The Plan tab. The tour is Mar 9–20, 2027, with the Dairy Arts Center pitch as options on Mar 12 and 19.
  test("plan: + between two entries adds there, and the order holds after a reload", async ({ browser }) => {
    const { page, close } = await as(browser, "jeff");
    await page.goto(tourUrl);
    const day = page.getByTestId("plan-day-2027-03-10");
    await expect(page.getByTestId("plan-day-2027-03-12").locator('[data-kind="option"]')).toContainText("Dairy Arts Center");

    // An empty day: + Add → Note….
    await day.getByTestId("plan-plus-2027-03-10-0-actions").click();
    await page.getByTestId("plan-plus-2027-03-10-0-menu-note").click();
    await page.getByTestId("entry-text").fill("Load the van");
    await page.getByTestId("entry-add").click();
    await expect(day.getByTestId("plan-entry")).toHaveText([/Load the van/]);

    // After the note: a stay, with an explicit Add.
    await day.getByTestId("plan-plus-2027-03-10-1-actions").click();
    await page.getByTestId("plan-plus-2027-03-10-1-menu-stay").click();
    await expect(page.getByTestId("entry-new-stay")).toBeVisible();
    await page.getByTestId("entry-name").fill("The van");
    await page.getByTestId("entry-add").click();
    await expect(day.getByTestId("plan-entry")).toHaveCount(2);

    // Between the two: another note lands in the middle.
    await day.getByTestId("plan-plus-2027-03-10-1-actions").click();
    await page.getByTestId("plan-plus-2027-03-10-1-menu-note").click();
    await page.getByTestId("entry-text").fill("Gas up");
    await page.getByTestId("entry-add").click();
    const order = [/Load the van/, /Gas up/, /Stay · The van/];
    await expect(day.getByTestId("plan-entry")).toHaveText(order);
    await page.reload();
    await expect(page.getByTestId("plan-day-2027-03-10").getByTestId("plan-entry")).toHaveText(order);

    // The night of the 10th is covered now; the 9th still asks for one.
    await expect(page.getByTestId("plan-day-2027-03-10").getByTestId("plan-no-stay")).toHaveCount(0);
    await expect(page.getByTestId("plan-day-2027-03-09").getByTestId("plan-no-stay")).toContainText("No stay tonight.");
    await close();
  });

  test("plan: clicking a stay opens it autosaving, with one Done", async ({ browser }) => {
    const { page, close } = await as(browser, "jeff");
    await page.goto(tourUrl);
    const day = page.getByTestId("plan-day-2027-03-10");
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
    await expect(page.getByTestId("plan-day-2027-03-11").getByTestId("plan-no-stay")).toHaveCount(0);
    await close();
  });

  test("plan: dragging a venue onto a day pitches it for that date", async ({ browser }) => {
    const { page, close } = await as(browser, "jeff");
    await page.goto(tourUrl);
    await page.getByTestId("tray-search").fill("Swallow Hill");
    const item = page.getByTestId("tray-items").locator("li").filter({ hasText: "Swallow Hill Music" });
    // (An earlier spec may have pitched it already; then its open pitch gets the date.)
    await expect(item).toBeVisible();
    const day = page.getByTestId("plan-day-2027-03-14");
    // The tray is sticky, so it stays beside the day while the day scrolls into view.
    await day.scrollIntoViewIfNeeded();
    await item.dragTo(day.locator(".tp-dlist"));
    await expect(day.locator('[data-kind="option"]')).toContainText("Swallow Hill Music");
    await close();
  });

  test("plan: a member sees the band's entries only, with nothing to change", async ({ browser }) => {
    const { page, close } = await as(browser, "david");
    await page.goto(tourUrl);
    await expect(page.getByTestId("plan-day-2027-03-10").getByTestId("plan-entry")).toHaveText([/Load the van/, /Gas up/, /Stay · Motel 6/]);
    await expect(page.getByTestId("tour-tray")).toHaveCount(0);
    await expect(page.getByTestId("plan-bucket")).toHaveCount(0);
    await expect(page.locator('[data-kind="option"]')).toHaveCount(0);
    await expect(page.getByTestId("plan-entry-x")).toHaveCount(0);
    await expect(page.getByTestId("plan-entry-open")).toHaveCount(0);
    await expect(page.getByTestId("plan-plus-2027-03-10-0-actions")).toHaveCount(0);
    await expect(page.getByTestId("plan-stat-open")).toHaveCount(0);
    await close();
  });
  // Money. The tour has a drive on Mar 9 (no places), and the stay "Motel 6" on Mar 10-11.
  test("money: a drive on Mar 9 for the money tests to pin to", async ({ browser }) => {
    const { page, close } = await as(browser, "jeff");
    await page.goto(tourUrl);
    const day = page.getByTestId("plan-day-2027-03-09");
    await day.getByTestId("plan-plus-2027-03-09-0-actions").click();
    await page.getByTestId("plan-plus-2027-03-09-0-menu-drive").click();
    await page.getByTestId("entry-add").click();
    await expect(day.locator('[data-kind="drive"]')).toHaveCount(1);
    await close();
  });

  test("money: admin logs a bill on the stay from the Money tab, marks it paid, and sees it under that day", async ({ browser }) => {
    const VENDOR = `Motel Co ${Date.now()}`;
    const BILL = `Two nights ${Date.now()}`;
    const { page, close } = await as(browser, "jeff");
    await page.goto(`${tourUrl}?tab=money`);
    await expect(page.getByTestId("tour-money")).toBeVisible();
    await expect(page.getByTestId("tour-spent-amount")).toHaveText("$0.00");

    await page.getByTestId("money-out-open").click();
    const modal = page.getByTestId("money-out-modal");
    await expect(modal).toBeVisible();
    await modal.getByTestId("mo-owe").check();
    await modal.getByTestId("mo-kind").selectOption("expense");
    await modal.getByTestId("mo-cat").fill("gear");
    await modal.getByTestId("mo-cat-opt-gear").click();
    await modal.getByTestId("mo-who-input").fill(VENDOR);
    await modal.getByTestId("mo-who-other").click();
    await modal.getByTestId("mo-amount").fill("120");
    await modal.getByTestId("mo-what").fill(BILL);
    const stay = await modal.getByTestId("mo-on").locator("option", { hasText: "Motel 6" }).getAttribute("value");
    await modal.getByTestId("mo-on").selectOption(stay!);
    await modal.getByTestId("mo-save").click();
    await expect(modal).toBeHidden();

    const out = page.getByTestId("paid-out");
    const row = out.locator('[data-testid^="expense-row-"]', { hasText: BILL });
    await expect(row).toContainText("Mar 10");
    await expect(row).toContainText("Motel 6");
    await expect(row).toContainText("we owe");
    await expect(page.getByTestId("tour-spent-amount")).toHaveText("$120.00");
    await expect(page.getByTestId("tour-day-2027-03-10")).toBeVisible();

    await row.locator('[data-testid^="expense-mark-paid-"]').click();
    const dialog = page.getByTestId("money-out-modal");
    await expect(dialog.getByTestId("mark-paid-form")).toBeVisible();
    await dialog.getByTestId("mp-save").click();
    await expect(dialog).toBeHidden();
    await expect(row).not.toContainText("we owe");
    await expect(page.getByTestId("tour-spent-amount")).toHaveText("$120.00");
    await expect(page.getByTestId("tour-net-amount")).toContainText("120.00");

    // Clicking the day narrows the Money out card to it; another day shows none of it; Show all clears.
    await page.getByTestId("tour-day-2027-03-10").click();
    await expect(out).toContainText(BILL);
    await page.getByTestId("tour-day-2027-03-09").click();
    await expect(out).not.toContainText(BILL);
    await expect(page.getByTestId("paid-out-empty")).toBeVisible();
    await page.getByTestId("tour-day-whole").click();
    await expect(out).not.toContainText(BILL);
    await page.getByTestId("tour-day-clear").click();
    await expect(out).toContainText(BILL);
    await expect(page.getByTestId("tour-day-total")).toContainText("$120.00");
    await close();
  });

  test("money: + Money out in a stay's modal pins the expense to it; it shows there and on the Money tab", async ({ browser }) => {
    const WHAT = `Parking ${Date.now()}`;
    const { page, close } = await as(browser, "jeff");
    await page.goto(tourUrl);
    await page.getByTestId("plan-day-2027-03-10").locator('[data-kind="stay"]').getByTestId("plan-entry-open").click();
    await expect(page.getByTestId("entry-edit-stay")).toBeVisible();
    await page.getByTestId("entry-money-out").click();
    const modal = page.getByTestId("money-out-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId("mo-on").locator("option:checked")).toContainText("Motel 6");
    await modal.getByTestId("mo-paid").check();
    await modal.getByTestId("mo-kind").selectOption("expense");
    await modal.getByTestId("mo-cat").fill("gear");
    await modal.getByTestId("mo-cat-opt-gear").click();
    await modal.getByTestId("mo-who-input").fill("City Garage");
    await modal.getByTestId("mo-who-other").click();
    await modal.getByTestId("mo-amount").fill("15");
    await modal.getByTestId("mo-what").fill(WHAT);
    await modal.getByTestId("mo-save").click();
    await expect(modal).toBeHidden();
    await expect(page.getByTestId("entry-money-row").filter({ hasText: WHAT })).toContainText("$15.00");
    await page.getByTestId("entry-done").click();

    await page.goto(`${tourUrl}?tab=money`);
    const row = page.getByTestId("paid-out").locator('[data-testid^="expense-row-"]', { hasText: WHAT });
    await expect(row).toContainText("Mar 10");
    await expect(row).toContainText("Motel 6");
    await expect(page.getByTestId("tour-spent-amount")).toHaveText("$135.00");
    await close();
  });

  test("money: a member adds an expense from the tour on a drive; it lands back on the tour tagged to the drive", async ({ browser }) => {
    const WHAT = `Gas to the first show ${Date.now()}`;
    const { page, close } = await as(browser, "david");
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

    const admin = await as(browser, "jeff");
    await admin.page.goto(`${tourUrl}?tab=money`);
    const row = admin.page.getByTestId("paid-out").locator('[data-testid^="expense-row-"]', { hasText: WHAT });
    await expect(row).toContainText("David paid");
    await expect(row).toContainText("Mar 9");
    await expect(row).toContainText("Drive");
    await expect(admin.page.getByTestId("tour-spent-amount")).toHaveText("$173.50");
    await admin.page.getByTestId("tour-day-2027-03-09").click();
    await expect(admin.page.getByTestId("paid-out")).toContainText(WHAT);
    await admin.close();
  });
  // Booking (#45). Dairy Arts Center is an option on Mar 12 and 19 since the first test.
  test("booking: Book on an option with another option that night; the other waits in No date yet and we land on the show", async ({ browser }) => {
    const { page, close } = await as(browser, "jeff");
    await page.goto(tourUrl);
    const day = page.getByTestId("plan-day-2027-03-12");
    await page.getByTestId("tray-search").fill("Cervantes");
    const item = page.getByTestId("tray-items").locator("li").filter({ hasText: "Cervantes' Other Side" });
    await day.scrollIntoViewIfNeeded();
    await item.dragTo(day.locator(".tp-dlist"));
    await expect(day.locator('[data-kind="option"]')).toHaveCount(2);

    await day.locator('[data-kind="option"]').filter({ hasText: "Dairy Arts Center" }).getByTestId("plan-book").click();
    const dialog = page.getByTestId("book-dialog");
    await expect(dialog).toContainText("Book Dairy Arts Center");
    await expect(dialog.getByTestId("book-date-2027-03-12")).toBeChecked();
    await expect(dialog.getByTestId("book-date-2027-03-19")).not.toBeChecked();
    const other = dialog.locator('fieldset[data-testid^="book-other-"]');
    await expect(other).toHaveCount(1);
    await expect(other).toContainText("Cervantes' Other Side");
    await expect(other.locator('input[data-testid$="-drop"]')).toBeChecked();
    await expect(dialog.getByTestId("book-stay")).toBeChecked();
    await dialog.getByTestId("book-submit").click();

    await expect(page).toHaveURL(/\/shows\/[^/?]+$/);
    await expect(page.getByTestId("where-tour")).toContainText(/Mountain West · day \d+ of \d+/);

    await page.goto(tourUrl);
    const booked = page.getByTestId("plan-day-2027-03-12");
    await expect(booked.locator('[data-kind="show"]')).toContainText("Dairy Arts Center");
    await expect(booked.locator('[data-kind="option"]')).toHaveCount(0);
    await expect(booked.locator('[data-kind="stay"]')).toHaveCount(1);
    await expect(page.getByTestId("plan-day-2027-03-19").locator('[data-kind="option"]')).toHaveCount(0);
    await expect(page.getByTestId("plan-bucket")).toContainText("Cervantes' Other Side");
    await close();
  });

  test("booking: a pitch's tour changes from the pitch page, and its option follows", async ({ browser }) => {
    const { page, close } = await as(browser, "jeff");
    await page.goto(tourUrl);
    // Swallow Hill Music is an option on Mar 14 since the drag test.
    await page.getByTestId("plan-day-2027-03-14").locator('[data-kind="option"]').filter({ hasText: "Swallow Hill Music" }).locator("a").click();
    await expect(page).toHaveURL(/\/booking\/pitches\//);
    const card = page.getByTestId("pitch-tour-card");
    await expect(card.getByTestId("pitch-tour")).toContainText("Mountain West");
    await expect(card.getByTestId("pitch-tour-plan")).toContainText("Sun Mar 14");

    await card.getByTestId("pitch-tour").click();
    await card.getByTestId("pitch-tour-input").selectOption({ value: "" });
    await expect(card.getByTestId("pitch-tour")).toContainText("No tour");
    await expect(card.getByTestId("pitch-tour-open")).toHaveCount(0);
    await page.goto(tourUrl);
    await expect(page.getByTestId("plan-day-2027-03-14").locator('[data-kind="option"]')).toHaveCount(0);
    await page.goBack();

    await page.getByTestId("pitch-tour").click();
    await page.getByTestId("pitch-tour-input").selectOption({ label: "Mountain West" });
    await expect(page.getByTestId("pitch-tour-plan")).toContainText("Sun Mar 14");
    await page.getByTestId("pitch-tour-open").click();
    await expect(page.getByTestId("plan-day-2027-03-14").locator('[data-kind="option"]')).toContainText("Swallow Hill Music");
    await close();
  });
  test("calendar: the Tours switch lays the tour over its days, and stays on for that person", async ({ browser }) => {
    const tourId = tourUrl.split("/").pop()!;
    const { page, close } = await as(browser, "jeff");
    await page.goto(A("/calendar?m=2027-03"));
    const toggle = page.getByTestId("calendar-tours-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId(`tour-bar-${tourId}`)).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`tour-bar-${tourId}`)).toContainText("Mountain West");
    await expect(page.getByTestId("day-2027-03-10").getByTestId("tour-chip").filter({ hasText: "Motel 6" })).toHaveCount(1);
    await page.getByTestId("day-2027-03-12").click();
    await expect(page.getByTestId("tour-panel")).toContainText("Mountain West");

    await page.reload();
    await expect(page.getByTestId("calendar-tours-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`tour-bar-${tourId}`)).toBeVisible();
    await page.getByTestId("calendar-tours-toggle").click();
    await expect(page.getByTestId(`tour-bar-${tourId}`)).toHaveCount(0);
    await close();

    // Another person's calendar never had it on.
    const david = await as(browser, "david");
    await david.page.goto(A("/calendar?m=2027-03"));
    await expect(david.page.getByTestId("calendar-tours-toggle")).toHaveAttribute("aria-pressed", "false");
    await david.close();
  });
});
