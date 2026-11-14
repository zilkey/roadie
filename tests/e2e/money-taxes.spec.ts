import { test, expect } from "@playwright/test";
import { openTab, APP, AUTH, FIRESTORE, ARTIST_SLUG } from "./env";

/** Un-assigns an income record (income.assign receivedBy: null): the tax page has no way back, and this test must leave Backer pledges unassigned for a retry. */
async function unassign(request: import("@playwright/test").APIRequestContext, incomeId: string) {
  const t = await request.post(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo`, {
    data: { postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: "dev-rudy", email: "rudy@example.com", email_verified: true, name: "Rudy" }))}&providerId=google.com`, requestUri: "http://localhost", returnIdpSignInMethod: true, returnSecureToken: true },
  });
  const token = ((await t.json()) as { idToken: string }).idToken;
  const a = await request.get(`http://${FIRESTORE}/v1/projects/demo-band-tracker/databases/(default)/documents/artists`, { headers: { authorization: "Bearer owner" } });
  const docs = ((await a.json()) as { documents: { name: string; fields: { slug?: { stringValue: string } } }[] }).documents;
  const artistId = docs.find((x) => x.fields.slug?.stringValue === ARTIST_SLUG)!.name.split("/").pop()!;
  const r = await request.post(`${APP}/api/commands/income.assign`, { data: { id: incomeId, receivedBy: null }, headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } });
  expect(r.ok(), await r.text()).toBeTruthy();
}

test("Money's sub-nav: the breakdowns are pages; an admin's tax worksheet splits cash from the rest and takes unassigned income", async ({ page, request }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-rudy").click();
  await expect(page).toHaveURL(/\/calendar$/);
  await openTab(page, "money");
  const nav = page.getByTestId("money-nav");
  await expect(nav.getByTestId("money-seg-overview")).toHaveAttribute("aria-current", "page");

  await nav.getByTestId("money-seg-years").click();
  await expect(page.getByTestId("years-table")).toContainText("2026");
  await nav.getByTestId("money-seg-people").click();
  await expect(page.getByTestId("people-all")).toContainText("Rudy");

  // Projects is its own page now, with New project on its title line
  await nav.getByTestId("money-seg-projects").click();
  await expect(page.locator(".page-actions").getByTestId("new-project")).toBeVisible();

  await nav.locator('[data-testid^="money-seg-taxes-"]', { hasText: "Rudy" }).click();
  await expect(page).toHaveURL(/\/money\/taxes\/[^/?]+/);
  await page.getByTestId("tax-year").selectOption("2026");
  await expect(page.getByTestId("tax-name")).toHaveText("Rudy");
  // The Creamery guarantee (a check) is Rudy's; the backer pledges came in with nobody down as receiving them.
  // (Earlier specs may have received more as Rudy, so the totals are checked relative to what is there.)
  const cents = async (id: string) => { const t = (await page.getByTestId(id).textContent()) ?? ""; return t === "—" ? 0 : Math.round(Number(t.replace(/[$,]/g, "")) * 100); };
  const line1 = page.getByTestId("tax-line-1");
  await expect(line1.locator('[data-testid^="tax-line-1-income-"]', { hasText: "Creamery Arts Center" })).toHaveCount(1);
  await expect(line1.locator('[data-testid^="tax-line-1-income-"]', { hasText: "Backer pledges" })).toHaveCount(0);
  // Cash is off the form by default; Include cash adds its line, switching off removes it (the arithmetic is in tests/unit/taxes.test.ts)
  await expect(page.getByTestId("tax-cash")).toHaveCount(0);
  const nonCash = await cents("tax-noncash-amount");
  expect(await cents("tax-line-1-amount")).toBe(nonCash);
  await page.getByTestId("tax-include-cash").click();
  await expect(page.getByTestId("tax-include-cash")).toBeChecked();
  await expect(page).toHaveURL(/cash=1/);
  await expect(page.getByTestId("tax-cash")).toBeVisible();
  await page.getByTestId("tax-include-cash").click();
  await expect(page.getByTestId("tax-include-cash")).not.toBeChecked();
  await expect(page).not.toHaveURL(/cash=1/);
  await expect(page.getByTestId("tax-cash")).toHaveCount(0);
  const before = await cents("tax-line-1-amount");
  expect(before).toBe(nonCash);
  const loose = page.getByTestId("tax-unassigned");
  await expect(loose).toContainText("Backer pledges");
  // Assigning consumes the seeded unassigned income, so it is put back (income.assign null) whatever happens after.
  const picker = loose.getByLabel("Who received Backer pledges");
  const incomeId = (await picker.getAttribute("data-testid"))!.replace("tax-assign-", "");
  try {
    await picker.selectOption({ label: "Rudy" });
    await expect(line1.locator('[data-testid^="tax-line-1-income-"]', { hasText: "Backer pledges" })).toHaveCount(1);
    expect(await cents("tax-line-1-amount")).toBe(before + 40000);
    await expect(loose).toHaveCount(0);
  } finally {
    await unassign(request, incomeId);
  }
  await expect(page.getByTestId("tax-line-31")).toBeVisible();
  // Hugo's $75 is under the 1099-NEC threshold: listed, no warning (the cutoff itself is in tests/unit/taxes.test.ts)
  await expect(page.locator('[data-testid^="tax-payee-"]', { hasText: "Hugo" })).toHaveCount(1);
  await expect(page.getByTestId("tax-1099-warning")).toHaveCount(0);
  // Use standard rate is on by default; off, line 9 is the gas actually spent
  await expect(page.getByTestId("tax-standard-rate")).toBeChecked();
  await expect(page.getByTestId("tax-car-note")).toContainText("standard mileage rate");
  await page.getByTestId("tax-standard-rate").click();
  await expect(page).toHaveURL(/std=0/);
  await expect(page.getByTestId("tax-standard-rate")).not.toBeChecked();
  await expect(page.getByTestId("tax-car-note")).toContainText("gas actually spent");
  await page.getByTestId("tax-standard-rate").click();
  await expect(page).not.toHaveURL(/std=0/);
});
