import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { APP, AUTH, FIRESTORE, A, ARTIST_SLUG } from "./env";
import { day } from "./dates";
import { dayLabel } from "../../src/lib/tours";

async function as(browser: Browser, key: string, phone = false) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 } } : {});
  const page = await ctx.newPage();
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
  return { page, close: () => ctx.close() };
}

// Its own tour and its own venue (no pitch), so the file runs in any order.
let tourUrl = "";
const venueName = `Phone Venue ${Date.now()}`;
// Far enough out to clear the seed's dates and tours.spec's tour (days 115-126).
const D1 = day(300), D2 = day(301), D3 = day(302);

// The tour is removed through the command API in afterAll as well as by the last test, so a failed or retried group leaves none behind
// (tours.spec.ts starts by expecting an empty Upcoming list).
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
  // (already gone when the last test ran: the call then just says not found)
  if (tourUrl) await api.post(`${APP}/api/commands/tours.remove`, { data: { id: tourUrl.split("/").pop() }, headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } });
  await api.dispose();
});

test.describe.serial("tours on a phone", () => {
  test("setup: an unpitched venue and a tour", async ({ browser }) => {
    const { page, close } = await as(browser, "rudy");
    await page.goto(A("/booking"));
    await page.getByTestId("booking-add-actions").click();
    await page.getByTestId("add-venue").click();
    await page.getByTestId("new-venue-name").fill(venueName);
    await page.getByTestId("new-venue-city").fill("Boulder");
    await page.getByTestId("new-venue-submit").click();
    await expect(page.getByTestId("venue-page")).toBeVisible();

    await page.goto(A("/tours/new"));
    await page.getByTestId("tour-name-input").fill("Phone Run");
    await page.getByTestId("tour-start").fill(D1);
    await page.getByTestId("tour-end").fill(D3);
    await page.getByTestId("tour-act").selectOption({ label: "Duo" });
    await page.getByTestId("create-tour").click();
    await expect(page).toHaveURL(/\/tours\/(?!new)[^/?]+$/);
    tourUrl = new URL(page.url()).pathname;
    await close();
  });

  test("at phone width: Plan, Info and Money tabs, no Sheet tab, no tray", async ({ browser }) => {
    const { page, close } = await as(browser, "rudy", true);
    await page.goto(tourUrl);
    await expect(page.getByTestId("tour-plan")).toBeVisible();
    await expect(page.getByTestId("tour-tab-plan")).toBeVisible();
    await expect(page.getByTestId("tour-tab-info")).toBeVisible();
    await expect(page.getByTestId("tour-tab-money")).toBeVisible();
    await expect(page.getByTestId("tour-tab-sheet")).toBeHidden();
    await expect(page.getByTestId("tour-tray")).toBeHidden();
    await expect(page.getByTestId(`plan-day-add-${D1}`)).toBeVisible();
    await expect(page.getByTestId(`plan-plus-${D1}-0-actions`)).toBeHidden();
    await close();
  });

  test("a day's + opens the sheet; Venues adds a not-pitched venue for that date", async ({ browser }) => {
    const { page, close } = await as(browser, "rudy", true);
    await page.goto(tourUrl);
    await page.getByTestId(`plan-day-add-${D2}`).click();
    const sheet = page.getByTestId("add-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading")).toHaveText(new RegExp(`Add to .*${dayLabel(D2)}`));
    await expect(sheet.getByTestId("add-sheet-tab-venues")).toBeChecked();
    // The day has no town: every venue with no pitch yet, searchable.
    await sheet.getByTestId("add-sheet-search").fill(venueName);
    const row = sheet.getByTestId("add-sheet-venues").locator("li").filter({ hasText: venueName });
    await expect(row).toContainText("Boulder");
    await row.getByRole("button", { name: "Add" }).click();
    await expect(row).toHaveCount(0); // it has a pitch now
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId(`plan-day-${D2}`).locator('[data-kind="option"]')).toContainText(venueName);
    await close();
  });

  test("Travel → Note opens the note modal and lands on the day", async ({ browser }) => {
    const { page, close } = await as(browser, "rudy", true);
    await page.goto(tourUrl);
    await page.getByTestId(`plan-day-add-${D1}`).click();
    await page.getByTestId("add-sheet-tab-travel").click();
    await page.getByTestId("add-sheet-travel-note").click();
    await expect(page.getByTestId("add-sheet")).toBeHidden();
    await page.getByTestId("entry-text").fill("Phone note");
    await page.getByTestId("entry-add").click();
    await expect(page.getByTestId(`plan-day-${D1}`).getByTestId("plan-entry")).toHaveText([/Phone note/]);
    await close();
  });

  test("cleanup: cancel the tour", async ({ browser }) => {
    const { page, close } = await as(browser, "rudy");
    page.on("dialog", (d) => void d.accept());
    await page.goto(tourUrl);
    await page.getByTestId("tour-actions").click();
    await page.getByTestId("tour-menu-cancel").click();
    await expect(page).toHaveURL(/\/tours$/);
    await close();
  });
});
