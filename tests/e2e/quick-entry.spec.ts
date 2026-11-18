import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { A, APP, AUTH, FIRESTORE, ARTIST_SLUG } from "./env";

// The show Quick entry template (Settings › Money) and its card on a show's Money tab. Every test works on a show made here
// (no other spec counts its money lines) and the template is set at the start of each, so the tests don't depend on order.
test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
let token: string;
let artistId: string;
let showId: string;

async function tokenFor(key: string, name: string) {
  const res = await api.post(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo`, {
    data: {
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: `dev-${key}`, email: `${key}@example.com`, email_verified: true, name }))}&providerId=google.com`,
      requestUri: "http://localhost", returnIdpSignInMethod: true, returnSecureToken: true,
    },
  });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { idToken: string }).idToken;
}

async function artistIdOf(slug: string) {
  const res = await api.get(`http://${FIRESTORE}/v1/projects/demo-band-tracker/databases/(default)/documents/artists`, { headers: { authorization: "Bearer owner" } });
  const docs = ((await res.json()) as { documents: { name: string; fields: { slug?: { stringValue: string } } }[] }).documents;
  const d = docs.find((x) => x.fields.slug?.stringValue === slug);
  expect(d).toBeTruthy();
  return d!.name.split("/").pop()!;
}

async function cmd<T = Record<string, any>>(name: string, input: unknown): Promise<T> {
  const res = await api.post(`${APP}/api/commands/${name}`, { data: input, headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } });
  expect(res.ok(), `${name}: ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { result: T }).result;
}

const setTemplate = (rows: { id: string; category: string; method: string; from?: string; askWhatFor?: boolean }[]) => cmd("artists.setShowQuickEntry", { rows });
const ROWS = [
  { id: "qetest01", category: "guarantee", method: "check" },
  { id: "qetest02", category: "tips", method: "venmo" },
  { id: "qetest03", category: "merch", method: "cash", askWhatFor: true },
];

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext();
  token = await tokenFor("rudy", "Rudy");
  artistId = await artistIdOf(ARTIST_SLUG);
  ({ id: showId } = await cmd<{ id: string }>("shows.create", { date: "2026-03-14", status: "confirmed", place: { city: "Quickville" } }));
});

test.afterAll(async () => {
  // Leave no income behind: the band's money pages (and other specs' totals) count income on any show.
  const { rows } = await cmd<{ rows: { id: string; showId?: string }[] }>("records.list", { kind: "income", limit: 200 });
  for (const x of rows.filter((r) => r.showId === showId)) await cmd("income.remove", { id: x.id });
  await cmd("shows.remove", { id: showId });
  await setTemplate([]);
  await api.dispose();
});

async function signIn(page: Page, who: "rudy" | "hugo") {
  await page.goto("/signin");
  await page.getByTestId(`dev-${who}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
async function openFinances(page: Page) {
  await page.goto(A(`/shows/${showId}?tab=finances`));
  await expect(page.getByTestId("show-page")).toBeVisible();
}
/** Add and Cancel close the card for the show; earlier tests leave it closed. */
async function openCard(page: Page) {
  await openFinances(page);
  const card = page.getByTestId("quick-entry");
  await expect(card.getByTestId("qe-open").or(card.locator('[data-testid^="qe-line-"]').first())).toBeVisible();
  if (await card.getByTestId("qe-open").isVisible()) await card.getByTestId("qe-open").click();
  await expect(card.locator('[data-testid^="qe-line-"]').first()).toBeVisible();
}
const line = (page: Page, i: number) => page.getByTestId("quick-entry").locator('[data-testid^="qe-line-"]').nth(i);
const amount = (page: Page, i: number) => line(page, i).locator('[data-testid^="qe-amount-"]');
const what = (page: Page, i: number) => line(page, i).locator('[data-testid^="qe-what-"]');

test("set up three rows in settings, fill two on a show, the draft survives leaving, Add puts them in Money in", async ({ page }) => {
  await setTemplate([]);
  await signIn(page, "rudy");
  await page.goto(A("/admin/money"));
  const settings = page.getByTestId("quick-entry-settings");
  await expect(settings).toContainText("Changes save as you go.");
  const rows = settings.locator('[data-testid^="qe-row-"]');
  for (let i = 1; i <= 3; i++) {
    await settings.getByTestId("qe-add-row").click();
    await expect(rows).toHaveCount(i);
  }
  const set = async (i: number, cat: string, method: string, ask = false) => {
    await rows.nth(i).locator('[data-testid^="qe-cat-"]').selectOption(cat);
    await expect(rows.nth(i).locator('[data-testid^="qe-cat-"]')).toHaveValue(cat);
    await rows.nth(i).locator('[data-testid^="qe-method-"]').selectOption(method);
    await expect(rows.nth(i).locator('[data-testid^="qe-method-"]')).toHaveValue(method);
    if (ask) await rows.nth(i).locator('[data-testid^="qe-ask-"]').check();
  };
  await set(0, "guarantee", "check");
  await set(1, "tips", "venmo");
  await set(2, "merch", "cash", true);

  await openFinances(page);
  const card = page.getByTestId("quick-entry");
  await expect(card.getByTestId("admin-only")).toBeVisible();
  await expect(card).toContainText("Goes on");
  await expect(card).toContainText("Mar 14");
  await expect(card.locator('[data-testid^="qe-line-"]')).toHaveCount(3);
  await expect(line(page, 0)).toContainText("Guarantee · Check");
  await expect(line(page, 2)).toContainText("Merch · Cash");
  await expect(what(page, 0)).toHaveCount(0);
  await expect(what(page, 2)).toBeVisible();

  await amount(page, 1).fill("40");
  await amount(page, 2).fill("60");
  await expect(card.getByTestId("qe-add")).toBeDisabled(); // Merch needs its "What for"
  await what(page, 2).fill("2 shirts");
  await expect(card.getByTestId("qe-add")).toBeEnabled();
  await expect(card.getByTestId("qe-add")).toContainText("Add 2 lines");

  // Leave and come back: the draft is still there.
  await page.goto(A("/shows"));
  await openFinances(page);
  await expect(amount(page, 1)).toHaveValue("40");
  await expect(amount(page, 2)).toHaveValue("60");
  await expect(what(page, 2)).toHaveValue("2 shirts");

  await card.getByTestId("qe-add").click();
  const income = page.getByTestId("income");
  const lines = income.locator('[data-testid^="income-row-"]');
  await expect(lines).toHaveCount(2);
  await expect(lines.filter({ hasText: "Tips" })).toContainText("$40.00");
  await expect(lines.filter({ hasText: "Merch" })).toContainText("$60.00");
  // Add closes the card; it stays closed after a reload until it's opened again.
  await expect(card.getByTestId("qe-open")).toBeVisible();
  await expect(card.locator('[data-testid^="qe-line-"]')).toHaveCount(0);
  await page.reload();
  await expect(card.getByTestId("qe-open")).toBeVisible();
  await card.getByTestId("qe-open").click();
  await expect(amount(page, 1)).toHaveValue("");
  await expect(amount(page, 2)).toHaveValue("");
  await expect(what(page, 2)).toHaveValue("");
  await expect(line(page, 1).locator('[data-testid^="qe-note-"]')).toContainText("already has $40.00 on this show");
});

test("Cancel closes the card and clears the draft; Open quick entry brings it back empty", async ({ page }) => {
  await setTemplate(ROWS);
  await signIn(page, "rudy");
  await openCard(page);
  await amount(page, 1).fill("25");
  await page.reload();
  await expect(amount(page, 1)).toHaveValue("25");
  const card = page.getByTestId("quick-entry");
  await page.getByTestId("qe-cancel").click();
  await expect(card.getByTestId("qe-open")).toBeVisible();
  await page.reload();
  await expect(card.getByTestId("qe-open")).toBeVisible();
  await card.getByTestId("qe-open").click();
  await expect(card.locator('[data-testid^="qe-line-"]')).toHaveCount(3);
  await expect(amount(page, 1)).toHaveValue("");
});

test("Who gets it in Settings starts the card's Who got it on that admin, still changeable", async ({ page }) => {
  await setTemplate(ROWS);
  await signIn(page, "rudy");
  await page.goto(A("/admin/money"));
  const pick = page.getByTestId("quick-entry-settings").getByTestId("qe-who-default");
  await expect(pick).toHaveValue("");
  const options = await pick.locator("option").evaluateAll((os) => os.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent ?? "" })));
  const target = options.filter((o) => o.value).at(-1)!;
  await pick.selectOption(target.value);
  await page.reload();
  await expect(page.getByTestId("quick-entry-settings").getByTestId("qe-who-default")).toHaveValue(target.value);
  await openCard(page);
  await expect(page.getByTestId("qe-who")).toHaveValue(target.value);
  await page.goto(A("/admin/money"));
  await page.getByTestId("quick-entry-settings").getByTestId("qe-who-default").selectOption("");
  await page.reload();
  await expect(page.getByTestId("quick-entry-settings").getByTestId("qe-who-default")).toHaveValue("");
});

test("with no template the card links to the setup", async ({ page }) => {
  await setTemplate([]);
  await signIn(page, "rudy");
  await openFinances(page);
  const card = page.getByTestId("quick-entry");
  await expect(card).toContainText("Set up the lines you fill in after every show");
  await page.getByTestId("qe-setup-link").click();
  await expect(page).toHaveURL(/\/admin\/money$/);
  await expect(page.getByTestId("quick-entry-settings")).toBeVisible();
});

test("a member sees no Quick entry card", async ({ page }) => {
  await setTemplate(ROWS);
  await signIn(page, "hugo");
  await openFinances(page);
  await expect(page.getByTestId("expenses")).toBeVisible();
  await expect(page.getByTestId("quick-entry")).toHaveCount(0);
});
