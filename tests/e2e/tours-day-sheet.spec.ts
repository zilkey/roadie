import { test, expect, type Browser } from "@playwright/test";
import { A } from "./env";

/** Today and its neighbours in the band's zone (Denver), as YYYY-MM-DD. */
const denver = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offset * 86400000));

/** Signs in (on a phone-sized screen unless `desk`) and waits for wherever the app lands: the calendar, or a member's day sheet on a tour day. */
async function as(browser: Browser, key: string, desk = false) {
  const ctx = await browser.newContext(desk ? {} : { viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/(calendar|tours\/[^/]+\/day\/[^/]+)$/);
  return { page, close: () => ctx.close() };
}

let tourUrl = "";

// A tour that spans today only for this file: it is cancelled in the last test, so no other spec's member is sent to a day sheet.
test.describe.serial("tours: the member's day sheet", () => {
  test("admin makes a tour under way with David on it, a drive with a leave-by and a stay today", async ({ browser }) => {
    const { page, close } = await as(browser, "jeff", true); // planned at a desk: the + between entries is desktop only
    await expect(page).toHaveURL(/\/calendar$/); // admins are never sent to a sheet
    await page.goto(A("/tours/new"));
    await page.getByTestId("tour-name-input").fill("Day Sheet Run");
    await page.getByTestId("tour-start").fill(denver(-1));
    await page.getByTestId("tour-end").fill(denver(1));
    await page.getByTestId("tour-act").selectOption({ label: "Duo" });
    await page.getByTestId("tour-who-David").click();
    await expect(page.getByTestId("tour-who-David")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("create-tour").click();
    await expect(page).toHaveURL(/\/tours\/(?!new)[^/?]+$/);
    tourUrl = new URL(page.url()).pathname;

    const day = page.getByTestId(`plan-day-${denver()}`);
    await day.getByTestId(`plan-plus-${denver()}-0-actions`).click();
    await page.getByTestId(`plan-plus-${denver()}-0-menu-drive`).click();
    await page.getByTestId("entry-from").fill("2363 Champa");
    await page.getByTestId("entry-from-suggestion").first().click();
    await page.getByTestId("entry-to").fill("Fort Collins");
    await page.getByTestId("entry-to-suggestion").first().click();
    await page.getByTestId("entry-leave-by").fill("15:20");
    await page.getByTestId("entry-add").click();
    await expect(day.locator('[data-kind="drive"]')).toHaveCount(1);

    await day.getByTestId(`plan-plus-${denver()}-1-actions`).click();
    await page.getByTestId(`plan-plus-${denver()}-1-menu-stay`).click();
    await page.getByTestId("entry-name").fill("Motel 6");
    await page.getByTestId("entry-check-in").fill("16:00");
    await page.getByTestId("entry-add").click();
    await expect(day.locator('[data-kind="stay"]')).toHaveCount(1);
    await close();
  });

  test("a member opening the app on a tour day lands on the sheet; the calendar from there stays the calendar", async ({ browser }) => {
    const { page, close } = await as(browser, "david");
    await expect(page).toHaveURL(new RegExp(`/day/${denver()}$`));
    await expect(page.getByTestId("day-sheet")).toBeVisible();
    await expect(page.getByTestId("day-sheet-tour")).toHaveText("Day Sheet Run · Day 2 of 3");
    await expect(page.getByTestId("day-sheet-title")).toContainText("Today, ");
    const drive = page.getByTestId("day-sheet-drive");
    await expect(drive).toContainText("Leave by 3:20 pm");
    await expect(drive).toContainText("→");
    await expect(drive).toContainText("in the van with Ingrid and Jeff"); // the Duo and David, less David
    await expect(drive.getByTestId("day-sheet-maps")).toHaveAttribute("href", /google\.com\/maps\/dir\/\?api=1&origin=.+&destination=.+/);
    await expect(drive.getByTestId("day-sheet-maps")).toHaveAttribute("target", "_blank");
    await expect(page.getByTestId("day-sheet-stay")).toContainText("Motel 6");
    await expect(page.getByTestId("day-sheet-stay")).toContainText("check-in after 4:00 pm");
    await expect(page.getByTestId("day-sheet-expense")).toHaveText("+ Add an expense");
    await expect(page.getByTestId("day-sheet-whole-tour")).toHaveText("Whole tour");

    // Opening the calendar again (a fresh page load, so no in-app history) is not bounced back to the sheet: once a day per session.
    await page.goto(A("/calendar"));
    await expect(page).toHaveURL(/\/calendar$/);
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/\/calendar$/);

    // The tour page links to it.
    await page.goto(tourUrl);
    await page.getByTestId("tour-todays-sheet").click();
    await expect(page.getByTestId("day-sheet")).toBeVisible();
    await page.getByTestId("day-sheet-whole-tour").click();
    await expect(page.getByTestId("tour-page")).toBeVisible();
    await close();
  });

  test("an admin signing in still lands on the calendar; then the tour is cancelled", async ({ browser }) => {
    const { page, close } = await as(browser, "ingrid");
    await expect(page).toHaveURL(/\/calendar$/);
    await close();

    const jeff = await as(browser, "jeff");
    jeff.page.once("dialog", (d) => d.accept());
    await jeff.page.goto(tourUrl);
    await jeff.page.getByTestId("tour-actions").click();
    await jeff.page.getByTestId("tour-menu-cancel").click();
    await expect(jeff.page).toHaveURL(/\/tours$/);
    await jeff.close();
  });
});
