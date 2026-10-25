import { test, expect, type APIRequestContext } from "@playwright/test";
import { APP, AUTH, FIRESTORE, ARTIST_SLUG } from "./env";

// The public fan list page /f/{slug}: no login. Shows are made through the app's commands and removed afterwards; the seeded
// artist has features.fans on, and the "off" test flips it and puts it back. No screenshots: those are taken by hand.

let api: APIRequestContext;
let token: string;
let artistId: string;
const madeShows: string[] = [];

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

/** A date in the band's zone, `plus` days from today. */
const bandDay = (plus = 0) => {
  const d = new Date(Date.now() + plus * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};

interface View { instagram: string | null; current: { showId: string; label: string } | null; choices: { showId: string; label: string }[] }
const listView = async () => (await (await api.get(`${APP}/api/public/${ARTIST_SLUG}/list`)).json()) as View;

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext();
  token = await tokenFor("jeff", "Jeff");
  artistId = await artistIdOf(ARTIST_SLUG);
  // Today's show has no times, so its window is the whole day; the other one is a few days out for the Change picker.
  for (const [plus, city] of [[0, "Fanville"], [3, "Pickton"]] as const) {
    const { id } = await cmd<{ id: string }>("shows.create", { date: bandDay(plus), status: "confirmed", place: { city }, addToCalendar: false });
    madeShows.push(id);
  }
});

test.afterAll(async () => {
  for (const id of madeShows) await cmd("shows.remove", { id });
  await api.dispose();
});

const go = (page: import("@playwright/test").Page) => page.goto(`/f/${ARTIST_SLUG}`);

test("during a show: email only, then the thank-you", async ({ page }) => {
  const view = await listView();
  expect(view.current).toBeTruthy();
  await go(page);
  await expect(page.getByTestId("fans-page")).toBeVisible();
  await expect(page.getByTestId("fans-show")).toContainText(view.current!.label);
  await expect(page.getByTestId("fans-show")).toContainText("Tonight");
  await expect(page.getByTestId("fans-city")).toHaveCount(0);
  const signup = page.waitForRequest((r) => r.url().endsWith("/signup") && r.method() === "POST");
  await page.getByTestId("fans-email").fill("fan-during@example.com");
  await page.getByTestId("fans-first-name").fill("Dana");
  await page.getByTestId("fans-join").click();
  const body = (await signup).postDataJSON();
  expect(body).toMatchObject({ email: "fan-during@example.com", firstName: "Dana", showId: view.current!.showId, page: `/f/${ARTIST_SLUG}` });
  await expect(page.getByTestId("fans-thanks")).toContainText("Dana");
  await expect(page.getByTestId("fans-instagram")).toHaveCount(view.instagram ? 1 : 0);
});

test("Change picks another show", async ({ page }) => {
  const view = await listView();
  const other = view.choices.find((c) => c.showId !== view.current?.showId);
  expect(other).toBeTruthy();
  await go(page);
  await page.getByTestId("fans-change").click();
  await expect(page.getByTestId("fans-choice").first()).toBeVisible();
  await page.getByTestId("fans-choice").filter({ hasText: other!.label }).first().click();
  await expect(page.getByTestId("fans-show")).toContainText(other!.label);
  await expect(page.getByTestId("fans-show")).not.toContainText("Tonight");
  const signup = page.waitForRequest((r) => r.url().endsWith("/signup"));
  await page.getByTestId("fans-email").fill("fan-change@example.com");
  await page.getByTestId("fans-join").click();
  expect((await signup).postDataJSON()).toMatchObject({ showId: other!.showId });
  await expect(page.getByTestId("fans-thanks")).toBeVisible();
});

test("no show: a city is optional", async ({ page }) => {
  // Same data as the server gave, minus today's show.
  await page.route(`**/api/public/${ARTIST_SLUG}/list`, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), current: null } });
  });
  await go(page);
  await expect(page.getByTestId("fans-show")).toHaveCount(0);
  await expect(page.getByTestId("fans-city")).toBeVisible();
  const signup = page.waitForRequest((r) => r.url().endsWith("/signup"));
  await page.getByTestId("fans-email").fill("fan-city@example.com");
  await page.getByTestId("fans-city").fill("Boulder, CO");
  await page.getByTestId("fans-join").click();
  const body = (await signup).postDataJSON();
  expect(body).toMatchObject({ city: "Boulder, CO" });
  expect(body.showId).toBeUndefined();
  await expect(page.getByTestId("fans-thanks")).toBeVisible();

  // And skipping the city works too.
  await go(page);
  await page.getByTestId("fans-email").fill("fan-nocity@example.com");
  await page.getByTestId("fans-join").click();
  await expect(page.getByTestId("fans-thanks")).toBeVisible();
});

test("a bad email shows an error and nothing is sent", async ({ page }) => {
  let sent = 0;
  await page.route("**/signup", (route) => { sent++; return route.continue(); });
  await go(page);
  await page.getByTestId("fans-email").fill("not-an-email");
  await page.getByTestId("fans-join").click();
  await expect(page.getByTestId("fans-error")).toBeVisible();
  await expect(page.getByTestId("fans-thanks")).toHaveCount(0);
  expect(sent).toBe(0);
  await page.getByTestId("fans-email").fill("fixed@example.com");
  await page.getByTestId("fans-join").click();
  await expect(page.getByTestId("fans-thanks")).toBeVisible();
});

test("fans off: the page is not found", async ({ page }) => {
  await cmd("artists.update", { id: artistId, patch: { features: { fans: false } } });
  try {
    await go(page);
    await expect(page.getByTestId("fans-not-found")).toBeVisible();
    await expect(page.getByTestId("fans-join")).toHaveCount(0);
  } finally {
    await cmd("artists.update", { id: artistId, patch: { features: { fans: true } } });
  }
  await go(page);
  await expect(page.getByTestId("fans-join")).toBeVisible();
});

test("an unknown band is not found", async ({ page }) => {
  await page.goto("/f/no-such-band");
  await expect(page.getByTestId("fans-not-found")).toBeVisible();
});

test("the page loads no sign-in code", async ({ page }) => {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  await go(page);
  await expect(page.getByTestId("fans-join")).toBeVisible();
  expect(urls.filter((u) => /identitytoolkit|securetoken|\/api\/session/.test(u))).toEqual([]);
});
