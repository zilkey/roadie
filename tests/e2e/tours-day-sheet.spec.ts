import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { APP, AUTH, FIRESTORE, A, ARTIST_SLUG } from "./env";

/** Today and its neighbours in the band's zone (Denver), as YYYY-MM-DD. Read once at load: the tour below is built from these and
 * checked against them, so a run that crosses Denver midnight still reads its own data consistently. (What the app then calls
 * "today" moves on, so a run that crosses midnight between tests 1 and 2 fails test 2 at the day-sheet redirect: the sheet is for the new day.) */
const NOW = Date.now();
const denver = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(NOW + offset * 86400000));
const YESTERDAY = denver(-1), TODAY = denver(), TOMORROW = denver(1);

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

// The tour is removed through the command API in afterAll, so a group that fails (or is retried) never leaves a tour spanning today:
// a member signing in later in the shard would be sent to its day sheet instead of the calendar.
let api: APIRequestContext;
let token: string;
let artistId: string;
test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext();
  const res = await api.post(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo`, {
    data: {
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: "dev-rudy", email: "rudy@example.com", email_verified: true, name: "Rudy" }))}&providerId=google.com`,
      requestUri: "http://localhost", returnIdpSignInMethod: true, returnSecureToken: true,
    },
  });
  expect(res.ok()).toBeTruthy();
  token = ((await res.json()) as { idToken: string }).idToken;
  const artists = await api.get(`http://${FIRESTORE}/v1/projects/demo-band-tracker/databases/(default)/documents/artists`, { headers: { authorization: "Bearer owner" } });
  const docs = ((await artists.json()) as { documents: { name: string; fields: { slug?: { stringValue: string } } }[] }).documents;
  artistId = docs.find((d) => d.fields.slug?.stringValue === ARTIST_SLUG)!.name.split("/").pop()!;
});
test.afterAll(async () => {
  if (tourUrl) await api.post(`${APP}/api/commands/tours.remove`, { data: { id: tourUrl.split("/").pop() }, headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } });
  await api.dispose();
});

// A tour that spans today only for this file: afterAll removes it, so no other spec's member is sent to a day sheet.
test.describe.serial("tours: the member's day sheet", () => {
  test("admin makes a tour under way with Hugo on it, a drive with a leave-by and a stay today", async ({ browser }) => {
    const { page, close } = await as(browser, "rudy", true); // planned at a desk: the + between entries is desktop only
    await expect(page).toHaveURL(/\/calendar$/); // admins are never sent to a sheet
    await page.goto(A("/tours/new"));
    await page.getByTestId("tour-name-input").fill("Day Sheet Run");
    await page.getByTestId("tour-start").fill(YESTERDAY);
    await page.getByTestId("tour-end").fill(TOMORROW);
    await page.getByTestId("tour-act").selectOption({ label: "Duo" });
    await page.getByTestId("tour-who-Hugo").click();
    await expect(page.getByTestId("tour-who-Hugo")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("create-tour").click();
    await expect(page).toHaveURL(/\/tours\/(?!new)[^/?]+$/);
    tourUrl = new URL(page.url()).pathname;

    const day = page.getByTestId(`plan-day-${TODAY}`);
    await day.getByTestId(`plan-plus-${TODAY}-0-actions`).click();
    await page.getByTestId(`plan-plus-${TODAY}-0-menu-drive`).click();
    await page.getByTestId("entry-from").fill("2363 Alder");
    await page.getByTestId("entry-from-suggestion").first().click();
    await page.getByTestId("entry-to").fill("Fort Collins");
    await page.getByTestId("entry-to-suggestion").first().click();
    await page.getByTestId("entry-leave-by").fill("15:20");
    await page.getByTestId("entry-add").click();
    await expect(day.locator('[data-kind="drive"]')).toHaveCount(1);

    await day.getByTestId(`plan-plus-${TODAY}-1-actions`).click();
    await page.getByTestId(`plan-plus-${TODAY}-1-menu-stay`).click();
    await page.getByTestId("entry-name").fill("Motel 6");
    await page.getByTestId("entry-check-in").fill("16:00");
    await page.getByTestId("entry-add").click();
    await expect(day.locator('[data-kind="stay"]')).toHaveCount(1);
    await close();
  });

  test("a member opening the app on a tour day lands on the sheet; the calendar from there stays the calendar", async ({ browser }) => {
    const { page, close } = await as(browser, "hugo");
    await expect(page).toHaveURL(new RegExp(`/day/${TODAY}$`));
    await expect(page.getByTestId("day-sheet")).toBeVisible();
    await expect(page.getByTestId("day-sheet-tour")).toHaveText("Day Sheet Run · Day 2 of 3");
    await expect(page.getByTestId("day-sheet-title")).toContainText("Today, ");
    const drive = page.getByTestId("day-sheet-drive");
    await expect(drive).toContainText("Leave by 3:20 pm");
    await expect(drive).toContainText("→");
    await expect(drive).toContainText("in the van with Nora and Rudy"); // the Duo and Hugo, less Hugo
    await expect(drive.getByTestId("day-sheet-maps")).toHaveAttribute("href", /google\.com\/maps\/dir\/\?api=1&origin=.+&destination=.+/);
    await expect(drive.getByTestId("day-sheet-maps")).toHaveAttribute("target", "_blank");
    await expect(page.getByTestId("day-sheet-stay")).toContainText("Motel 6");
    await expect(page.getByTestId("day-sheet-stay")).toContainText("check-in after 4:00 pm");
    await expect(page.getByTestId("day-sheet-expense")).toHaveText("+ New expense");
    await expect(page.getByTestId("day-sheet-whole-tour")).toHaveText("Whole tour");

    // Opening the calendar again (a fresh page load, so no in-app history) is not bounced back to the sheet: once a day per session.
    await page.goto(A("/calendar"));
    await expect(page.getByTestId("calendar-page")).toBeVisible(); // loaded, so a redirect would have had its tours by now
    await expect(page).toHaveURL(/\/calendar$/);

    // The tour page links to it.
    await page.goto(tourUrl);
    await page.getByTestId("tour-todays-sheet").click();
    await expect(page.getByTestId("day-sheet")).toBeVisible();
    await page.getByTestId("day-sheet-whole-tour").click();
    await expect(page.getByTestId("tour-page")).toBeVisible();
    await close();
  });
});
