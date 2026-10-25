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

/** Opens a rehearsal from the rehearsal list, by its date label or name. */
async function openRehearsal(page: Page, label: string) {
  await page.goto(A("/rehearsals"));
  await page.getByTestId("rehearsals-list").getByText(label).first().click();
  await expect(page).toHaveURL(/\/rehearsals\/[^/]+$/);
  await expect(page.getByTestId("reh-add-expense")).toBeVisible();
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

  await expect(page).toHaveURL(/\/rehearsals\/[^/]+$/);
  await expect(page.getByTestId("reh-expenses-card").getByTestId("reh-expense-row").filter({ hasText: "36.8 mi round trip" }).first()).toBeVisible();
  await close();
});

/** Your profile: the admin's driving values are shown, and a changed MPG survives a reload. */
test("your profile: the driving and gas card shows the seeded values and an MPG change sticks", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-jeff").click();
  await expect(page).toHaveURL(/\/home$/);
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
