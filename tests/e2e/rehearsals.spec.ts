import { test, expect, type Browser, type Page } from "@playwright/test";
import { A } from "./env";

async function as(browser: Browser, key: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
  return { page, close: () => ctx.close() };
}

/** Opens a rehearsal from the Songs tab's rehearsal list, by its date label or name. */
async function openRehearsal(page: Page, label: string) {
  await page.goto(A("/songs"));
  await page.getByTestId("songs-seg-rehearsals").click();
  await page.getByTestId("rehearsals-list").getByText(label).first().click();
  await expect(page).toHaveURL(/\/songs\/rehearsals\/[^/]+$/);
  await expect(page.getByTestId("reh-add-expense")).toBeVisible();
}

/** Starts a gas expense from the rehearsal page and answers the MPG and From questions if they are asked. */
async function logGasAnswering(page: Page) {
  await page.getByTestId("reh-add-expense").click();
  await page.getByTestId("exp-cat-gas").click();
  if (await page.getByTestId("exp-mpg-inline").isVisible()) await page.getByTestId("exp-mpg-inline").fill("34");
  if (await page.getByTestId("exp-save-home").isVisible()) { // only shown while From is being asked for
    await page.getByTestId("exp-from").fill("742 Evergreen");
    await page.getByTestId("exp-from-suggestion").filter({ hasText: "742 Evergreen Terrace" }).first().click();
  }
}

/** The seeded Oct 29 rehearsal at The Loft. The seeded admin has home, 28 MPG and regular gas. */
test("admin logs gas from the rehearsal: round trip estimate, toggle one way, save shows in the table", async ({ browser }) => {
  const { page, close } = await as(browser, "jeff");
  await openRehearsal(page, "Oct 29");

  await page.getByTestId("reh-add-expense").click();
  await expect(page.getByText(/^Rehearsal · /)).toContainText("Oct 29"); // the rehearsal is preselected
  await page.getByTestId("exp-cat-gas").click();
  await expect(page.getByTestId("exp-estimate")).toContainText("Denver-area average");
  await expect(page.getByTestId("exp-estimate-cost")).toHaveText("$4.98"); // 36.8 mi at 28 MPG and $3.79/gal
  await expect(page.getByTestId("exp-mpg-inline")).toHaveCount(0); // settings are saved, so no questions
  await expect(page.getByTestId("exp-from-suggestion")).toHaveCount(0);

  await page.getByTestId("exp-roundtrip").click(); // one way
  await expect(page.getByTestId("exp-estimate-cost")).toHaveText("$2.49");
  await page.getByTestId("exp-roundtrip").click(); // back to round trip, what gets saved
  await expect(page.getByTestId("exp-estimate-cost")).toHaveText("$4.98");
  await page.getByTestId("exp-save").click();

  await expect(page).toHaveURL(/\/songs\/rehearsals\/[^/]+$/);
  await expect(page.getByTestId("reh-expenses-card").getByTestId("reh-expense-row").filter({ hasText: "36.8 mi round trip" }).first()).toBeVisible();
  await close();
});

/** A member with no driving settings is asked for MPG and From once; saving them skips the questions after. */
test("a member with no driving settings is asked for MPG and From once, then not again", async ({ browser }) => {
  const { page, close } = await as(browser, "david");
  await openRehearsal(page, "Oct 29");

  await page.getByTestId("reh-add-expense").click();
  await page.getByTestId("exp-cat-gas").click();
  await page.getByTestId("exp-mpg-inline").fill("34");
  await expect(page.getByTestId("exp-save-mpg")).toBeChecked(); // save to settings, left ticked
  await page.getByTestId("exp-from").fill("742 Evergreen");
  await page.getByTestId("exp-from-suggestion").filter({ hasText: "742 Evergreen Terrace" }).first().click();
  await expect(page.getByTestId("exp-save-home")).toBeChecked(); // save as home, left ticked
  await expect(page.getByTestId("exp-estimate-cost")).toHaveText("$4.10"); // 36.8 mi at 34 MPG
  await page.getByTestId("exp-save").click();
  await expect(page).toHaveURL(/\/songs\/rehearsals\/[^/]+$/);

  // the second gas expense: MPG and home were saved, so nothing is asked
  await page.getByTestId("reh-add-expense").click();
  await page.getByTestId("exp-cat-gas").click();
  await expect(page.getByTestId("exp-mpg-inline")).toHaveCount(0);
  await expect(page.getByTestId("exp-from-suggestion")).toHaveCount(0);
  await expect(page.getByTestId("exp-estimate-cost")).toHaveText("$4.10");
  await close();
});

/** Jeff's basement has only a name, so the gas expense needs a typed To, and can set the rehearsal's address. */
test("a rehearsal with no address: gas needs a To, and can set the rehearsal location", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-jeff").click();
  await expect(page).toHaveURL(/\/home$/);
  await openRehearsal(page, "Jeff's basement");
  await expect(page.getByTestId("reh-location-name")).toContainText("Jeff's basement");
  await expect(page.getByTestId("reh-location-address")).toHaveCount(0);

  await page.getByTestId("reh-add-expense").click();
  await page.getByTestId("exp-cat-gas").click();
  await expect(page.getByTestId("exp-estimate-cost")).toHaveText("—"); // no To yet, so no estimate
  await page.getByTestId("exp-to").fill("2363 Champa");
  await page.getByTestId("exp-to-suggestion").filter({ hasText: "2363 Champa St" }).first().click();
  await expect(page.getByTestId("exp-estimate-cost")).toBeVisible();
  await page.getByTestId("exp-set-rehearsal-location").check();
  await page.getByTestId("exp-save").click();

  await expect(page).toHaveURL(/\/songs\/rehearsals\/[^/]+$/);
  await expect(page.getByTestId("reh-location-card").getByTestId("reh-location-address")).toContainText("2363 Champa St");
});

/** Members see only their own rehearsal expenses under "My expenses"; admins see everyone, with a For column. */
test("the rehearsal expenses card: member sees only their own, admin sees everyone with For", async ({ browser }) => {
  const admin = await as(browser, "jeff");
  await openRehearsal(admin.page, "Oct 29");
  await expect(admin.page.getByRole("columnheader", { name: "For" })).toBeVisible();
  await logGasAnswering(admin.page); // the admin's own gas, under Jeff
  await admin.page.getByTestId("exp-save").click();
  await expect(admin.page).toHaveURL(/\/songs\/rehearsals\/[^/]+$/);
  await expect(admin.page.getByTestId("reh-expense-row").filter({ hasText: "Jeff" }).first()).toBeVisible();
  await admin.close();

  const member = await as(browser, "david");
  await openRehearsal(member.page, "Oct 29");
  await expect(member.page.getByTestId("reh-expenses-card")).toContainText("My expenses");
  await expect(member.page.getByRole("columnheader", { name: "For" })).toHaveCount(0);
  await expect(member.page.getByTestId("reh-expense-row").filter({ hasText: "Jeff" })).toHaveCount(0);
  await logGasAnswering(member.page); // the member's own gas
  await member.page.getByTestId("exp-save").click();
  await expect(member.page).toHaveURL(/\/songs\/rehearsals\/[^/]+$/);
  await expect(member.page.getByTestId("reh-expense-row").first()).toBeVisible();
  await expect(member.page.getByTestId("reh-expense-row").filter({ hasText: "Jeff" })).toHaveCount(0);
  await member.close();
});

/** Import from setlist: Replace swaps the rehearsal's songs for the ticked ones; Append adds to the end.
 *  The page shows one row per distinct song, so the test picks non-overlapping slices of the setlist. */
test("import from setlist: replace takes the ticked songs, then append adds more", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-jeff").click();
  await expect(page).toHaveURL(/\/home$/);
  await openRehearsal(page, "Oct 29");

  const songs = page.getByTestId("rehearsal-songs").getByRole("listitem");
  // replace with only the first three ticked
  await page.getByTestId("reh-import-setlist").click();
  await expect(page.getByTestId("imp-dialog")).toBeVisible();
  await expect(page.getByTestId("imp-setlist")).toBeVisible();
  const rows = page.getByTestId("imp-song");
  const total = await rows.count();
  expect(total).toBeGreaterThan(5);
  for (let i = 3; i < total; i++) await rows.nth(i).uncheck();
  await page.getByTestId("imp-mode-replace").click();
  await page.getByTestId("imp-confirm").click();
  await expect(page.getByTestId("imp-dialog")).toBeHidden();
  await expect(songs).toHaveCount(3);

  // append the last three: they land after what is there
  await page.reload();
  await page.getByTestId("reh-import-setlist").click();
  await expect(page.getByTestId("imp-dialog")).toBeVisible();
  for (let i = 0; i < total - 3; i++) await page.getByTestId("imp-song").nth(i).uncheck();
  await page.getByTestId("imp-mode-append").click();
  await page.getByTestId("imp-confirm").click();
  await expect(page.getByTestId("imp-dialog")).toBeHidden();
  await expect(page.getByTestId("rehearsal-songs").getByRole("listitem")).toHaveCount(6);
});

/** My settings: the admin's driving values are shown, and a changed MPG survives a reload. */
test("my settings: the driving and gas card shows the seeded values and an MPG change sticks", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-jeff").click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByTestId("account-menu").click();
  await page.getByRole("menuitem", { name: "My settings" }).click();
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
