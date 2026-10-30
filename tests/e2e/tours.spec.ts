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
});
