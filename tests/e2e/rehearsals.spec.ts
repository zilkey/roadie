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
  await expect(page.getByTestId("reh-add-expense")).toBeVisible();
}


/** The seeded Oct 29 rehearsal at The Loft. The seeded admin has home, 28 MPG and regular gas. */
test("admin logs gas from the rehearsal: round trip estimate, toggle one way, save shows in the expenses card", async ({ browser }) => {
  const { page, close } = await as(browser, "jeff");
  await openRehearsal(page, "Oct 29");

  await page.getByTestId("reh-add-expense").click();
  await expect(page.getByText(/^Rehearsal · /)).toContainText("Oct 29"); // the rehearsal is preselected
  await page.getByTestId("exp-cat-travel").click();
  await expect(page.getByTestId("exp-estimate")).toContainText("Denver-area average");
  await expect(page.getByTestId("exp-estimate-cost")).toHaveText("$4.98"); // 36.8 mi at 28 MPG and $3.79/gal
  await expect(page.getByTestId("exp-mpg-inline")).toHaveCount(0); // settings are saved, so no questions
  await expect(page.getByTestId("exp-from-suggestion")).toHaveCount(0);

  await page.getByTestId("exp-roundtrip").click(); // one way
  await expect(page.getByTestId("exp-estimate-cost")).toHaveText("$2.49");
  await page.getByTestId("exp-roundtrip").click(); // back to round trip, what gets saved
  await expect(page.getByTestId("exp-estimate-cost")).toHaveText("$4.98");
  await page.getByTestId("exp-save").click();

  await expect(page).toHaveURL(/\/rehearsals\/[^/]+$/);
  await expect(page.getByTestId("expenses").getByTestId("expense-row").filter({ hasText: "36.8 mi round trip" }).first()).toBeVisible();
  await close();
});

/** The expenses card links to the full form too, with the rehearsal preselected and gas the default. */
test("the rehearsal expenses card opens the full expense form for that rehearsal", async ({ browser }) => {
  const { page, close } = await as(browser, "david");
  await openRehearsal(page, "Oct 29");
  await page.getByTestId("reh-tab-money").click();
  await page.getByTestId("expenses").getByTestId("expenses-full-form").click();
  await expect(page).toHaveURL(/\/money\/expense\?rehearsalId=/);
  await expect(page.getByText(/^Rehearsal · /)).toContainText("Oct 29");
  await page.getByTestId("back").click();
  await expect(page).toHaveURL(/\/rehearsals\/[^/]+\?tab=money$/);
  await close();
});

/** Members add their own expense on a rehearsal through the shared card's full form; an admin sees it with who paid. */
test("a member adds an expense on a rehearsal and an admin sees it", async ({ browser }) => {
  const david = await as(browser, "david");
  await openRehearsal(david.page, "Oct 29");
  await david.page.getByTestId("reh-tab-money").click();
  const card = david.page.getByTestId("expenses");
  await card.getByTestId("expenses-full-form").click();
  await david.page.getByTestId("exp-cat-space").click();
  await david.page.getByTestId("exp-amount").fill("25");
  await david.page.getByTestId("expense-what").fill("Room rental split");
  await david.page.getByTestId("exp-save").click();
  await expect(david.page).toHaveURL(/\/rehearsals\/[^/]+$/);
  await expect(card.getByTestId("expense-row").filter({ hasText: "Room rental split" })).toBeVisible();
  await david.close();

  const jeff = await as(browser, "jeff");
  await openRehearsal(jeff.page, "Oct 29");
  await jeff.page.getByTestId("reh-tab-money").click();
  await expect(jeff.page.getByTestId("expenses").getByTestId("expense-row").filter({ hasText: "Room rental split" })).toBeVisible();
  await jeff.close();
});

/** Your profile: the admin's driving values are shown, and a changed MPG survives a reload. */
test("your profile: the driving and gas card shows the seeded values and an MPG change sticks", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-jeff").click();
  await expect(page).toHaveURL(/\/calendar$/);
  await page.getByTestId("account-menu").click();
  await page.getByRole("menuitem", { name: "Your profile" }).click();
  await expect(page.getByTestId("me-driving-card")).toBeVisible();
  await expect(page.getByTestId("me-mpg-value")).toHaveText("28");
  await expect(page.getByTestId("me-car-value")).toBeVisible();

  // saved settings edit field-by-field behind Edit; MPG saves on blur
  const setMpg = async (v: string) => {
    await page.getByTestId("me-edit").click();
    await page.getByTestId("me-mpg").fill(v);
    await page.getByTestId("me-mpg").blur();
    await page.getByTestId("me-done").click();
    await expect(page.getByTestId("me-mpg-value")).toHaveText(v);
  };
  try {
    await setMpg("30");
    await page.reload();
    await expect(page.getByTestId("me-mpg-value")).toHaveText("30");
  } finally {
    // put the seeded value back, so the rehearsal expense checks above see 28 MPG
    await setMpg("28");
  }
});

/** The seeded Oct 29 rehearsal at The Loft. Saving never sends; the calendar button previews, then sends; Remove takes it off again. */
test("a rehearsal goes on the band calendar only from its button, after a preview", async ({ browser, request }) => {
  const { page, close } = await as(browser, "jeff");
  await openRehearsal(page, "Oct 29");
  const line = page.getByTestId("reh-calendar");
  await expect(line).toContainText("Not on the band calendar");
  await page.getByTestId("reh-calendar-open").click();
  const dlg = page.getByTestId("reh-calendar-dialog");
  await expect(dlg.getByTestId("cal-preview-calendar")).toHaveText("Ingrid Avison Band");
  await expect(dlg.getByTestId("cal-preview-title")).toHaveText(/rehearsal at The Loft$/);
  await expect(dlg.getByTestId("cal-preview-when")).toContainText("Oct 29");
  await expect(dlg.getByTestId("cal-preview-where")).toContainText("The Loft");
  await dlg.getByTestId("cal-send").click();
  await expect(line).toContainText("On the band calendar");
  const events = (await (await request.get(`${CAL}/events?calendarId=fake-band-calendar`)).json()) as { title: string }[];
  expect(events.some((e) => /rehearsal at The Loft$/.test(e.title))).toBe(true);

  await page.getByTestId("reh-calendar-open").click();
  await dlg.getByTestId("cal-remove").click();
  await expect(line).toContainText("Not on the band calendar");
  await close();
});

/** Someone already put Oct 29 on the band calendar by hand: the preview offers it, and linking sends nothing. */
test("a rehearsal links to an event already on the band calendar instead of adding another", async ({ browser, request }) => {
  const made = (await (await request.post(`${CAL}/events`, { data: { calendarId: "fake-band-calendar", title: "IAB Rehearsal", start: "2026-10-29T18:00:00", end: "2026-10-29T20:30:00", location: "The Loft" } })).json()) as { id: string };
  // Not a rehearsal by its title, so not offered
  const dentist = (await (await request.post(`${CAL}/events`, { data: { calendarId: "fake-band-calendar", title: "Dentist", start: "2026-10-29T09:00:00", end: "2026-10-29T10:00:00" } })).json()) as { id: string };
  const { page, close } = await as(browser, "jeff");
  await openRehearsal(page, "Oct 29");
  const line = page.getByTestId("reh-calendar");
  await expect(line).toContainText("Not on the band calendar");
  await page.getByTestId("reh-calendar-open").click();
  const dlg = page.getByTestId("reh-calendar-dialog");
  const ev = dlg.getByTestId("cal-existing-event");
  await expect(ev).toHaveCount(1);
  await expect(ev).toContainText("IAB Rehearsal");
  await expect(ev).toContainText("6:00 pm – 8:30 pm");
  await expect(dlg.getByTestId("cal-send")).toHaveText("Add a new event");
  await ev.getByTestId("cal-link").click();
  await expect(line).toContainText("On the band calendar");
  await expect(page.getByTestId("reh-calendar-note")).toContainText("Linked");
  const events = (await (await request.get(`${CAL}/events?calendarId=fake-band-calendar`)).json()) as { title: string; start: string }[];
  expect(events.filter((e) => e.start.startsWith("2026-10-29")).map((e) => e.title)).toEqual(["Dentist", "IAB Rehearsal"]);

  // Update now shows the app's version, and Remove takes it off
  await page.getByTestId("reh-calendar-open").click();
  await expect(dlg.getByTestId("cal-send")).toHaveText("Update event");
  await dlg.getByTestId("cal-remove").click();
  await expect(line).toContainText("Not on the band calendar");
  expect((await request.get(`${CAL}/events/${made.id}`)).status()).toBe(404);
  await request.delete(`${CAL}/events/${dentist.id}`);
  await close();
});

/** The seed has Oct 18 (Jeff's basement) and Oct 29 (The Loft); the clock is pinned between them. */
test("rehearsals page splits into Upcoming and Past tables", async ({ browser }) => {
  const { page, close } = await as(browser, "jeff");
  await page.clock.setFixedTime(new Date("2026-10-26T12:00:00-06:00"));
  await page.goto(A("/rehearsals"));
  const upcoming = page.getByTestId("rehearsals-upcoming");
  const past = page.getByTestId("rehearsals-past");
  await expect(upcoming.getByRole("heading", { name: "Upcoming" })).toBeVisible();
  await expect(past.getByRole("heading", { name: "Past" })).toBeVisible();
  await expect(upcoming.getByText("The Loft")).toBeVisible();
  await expect(upcoming.getByText("Jeff's basement")).toHaveCount(0);
  await expect(past.getByText("Jeff's basement")).toBeVisible();
  await expect(past.getByText("The Loft")).toHaveCount(0);
  await close();
});

/** The Notes card edits in place: an admin taps the text, types, leaves it, and it saves; a member reads plain text. */
test("rehearsal notes edit in place for an admin and read as plain text for a member", async ({ browser }) => {
  const note = `Run the new ending twice ${Date.now()}`;
  const { page, close } = await as(browser, "jeff");
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

  const david = await as(browser, "david");
  await openRehearsal(david.page, "Oct 29");
  await expect(david.page.getByTestId("reh-notes-card")).toContainText(note);
  await expect(david.page.getByTestId("reh-notes")).toHaveCount(0);
  await expect(david.page.getByTestId("reh-notes-card").getByRole("button")).toHaveCount(0);
  await david.close();
});
