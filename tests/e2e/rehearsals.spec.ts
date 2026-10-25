import { test, expect, type Browser, type Page } from "@playwright/test";
import { A } from "./env";

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

  await expect(page).toHaveURL(/\/rehearsals\/[^/]+$/);
  await expect(page.getByTestId("expenses").getByTestId("expense-row").filter({ hasText: "36.8 mi round trip" }).first()).toBeVisible();
  await close();
});

/** The expenses card links to the full form too, with the rehearsal preselected and gas the default. */
test("the rehearsal expenses card opens the full expense form for that rehearsal", async ({ browser }) => {
  const { page, close } = await as(browser, "david");
  await openRehearsal(page, "Oct 29");
  await page.getByTestId("expenses").getByTestId("expenses-full-form").click();
  await expect(page).toHaveURL(/\/money\/expense\?rehearsalId=/);
  await expect(page.getByText(/^Rehearsal · /)).toContainText("Oct 29");
  await page.getByTestId("back").click();
  await expect(page).toHaveURL(/\/rehearsals\/[^/]+$/);
  await close();
});

/** Members add their own expense on a rehearsal through the shared card; an admin sees it with who paid. */
test("a member adds an expense on a rehearsal and an admin sees it", async ({ browser }) => {
  const david = await as(browser, "david");
  await openRehearsal(david.page, "Oct 29");
  const card = david.page.getByTestId("expenses");
  await card.getByTestId("expenses-add").or(card.getByTestId("expenses-edit")).first().click();
  const line = david.page.getByTestId("expense-line-0");
  await line.getByTestId("expense-what").fill("Room rental split");
  await line.getByTestId("expense-amount").fill("25");
  await david.page.getByTestId("expenses-save").click();
  await expect(card.getByTestId("expense-row").filter({ hasText: "Room rental split" })).toBeVisible();
  await david.close();

  const jeff = await as(browser, "jeff");
  await openRehearsal(jeff.page, "Oct 29");
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
