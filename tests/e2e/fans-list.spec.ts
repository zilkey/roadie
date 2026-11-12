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

/** Today's date and the wall time now, in the band's zone. */
const bandNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};

interface View { socials: { key: string }[]; current: { showId: string; label: string } | null; merch: { venmo: string; items: { id: string; name: string; priceCents: number }[] } | null }
const listView = async () => (await (await api.get(`${APP}/api/public/${ARTIST_SLUG}/list`)).json()) as View;
const ITEMS = [{ id: "cz", name: "Coozie", priceCents: 500 }, { id: "ts", name: "T-Shirt", priceCents: 2500 }];

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext();
  token = await tokenFor("rudy", "Rudy");
  artistId = await artistIdOf(ARTIST_SLUG);
  // A show starting now: signups from an hour before to three hours after belong to it.
  const { date, time } = bandNow();
  const { id } = await cmd<{ id: string }>("shows.create", { date, status: "confirmed", place: { city: "Fanville" }, times: { showStart: time } });
  madeShows.push(id);
});

test.afterAll(async () => {
  for (const id of madeShows) await cmd("shows.remove", { id });
  await api.dispose();
});

const go = (page: import("@playwright/test").Page) => page.goto(`/f/${ARTIST_SLUG}`);

test("during a show: the show is picked by the time, then the thank-you; the page loads no sign-in code", async ({ page }) => {
  const view = await listView();
  expect(view.current).toBeTruthy();
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  await go(page);
  await expect(page.getByTestId("fans-page")).toBeVisible();
  await expect(page.getByTestId("fans-show")).toContainText(view.current!.label);
  await expect(page.getByTestId("fans-show")).toContainText("Tonight");
  await expect(page.getByText("At a show?")).toHaveCount(0);
  const signup = page.waitForRequest((r) => r.url().endsWith("/signup") && r.method() === "POST");
  await page.getByTestId("fans-email").fill("fan-during@example.com");
  await page.getByTestId("fans-first-name").fill("Wren Avery");
  await page.getByTestId("fans-zip").fill("80302");
  await page.getByTestId("fans-join").click();
  const body = (await signup).postDataJSON();
  expect(body).toEqual({ email: "fan-during@example.com", name: "Wren Avery", zip: "80302", page: `/f/${ARTIST_SLUG}` });
  await expect(page.getByTestId("fans-thanks")).toContainText("Wren");
  await expect(page.getByTestId("fans-socials")).toHaveCount(view.socials.length ? 1 : 0);
  await expect(page.getByTestId("fans-merch")).toHaveCount(view.merch ? 1 : 0);
  expect(urls.filter((u) => /identitytoolkit|securetoken|\/api\/session/.test(u))).toEqual([]);
});

test("merch: plus and minus build the Venmo link with the total and a note; the name and colors come from the view", async ({ page }) => {
  // The seeded artist has merch off (the Merch nav item would show up in other specs), so the view gets a price list here.
  // The server side of merch, the public name and the style is covered in tests/emulator/fans.test.ts.
  await page.route(`**/api/public/${ARTIST_SLUG}/list`, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: {
      ...(await res.json()), artistName: "Test Band", merch: { venmo: "Test-Band", items: ITEMS }, style: { theme: "light", accent: "#f0b400" },
      shows: { venmo: "Test-Band", items: [{ id: "s1", name: "Jennifer House Concert", amountCents: 2000, button: "donation" }, { id: "s2", name: "Deep End", amountCents: 1500, button: "ticket" }] },
      links: [{ id: "l1", name: "New single", url: "https://example.com/single" }],
      socials: [{ key: "website", label: "Website", url: "https://example.com" }, { key: "instagram", label: "Instagram", url: "https://instagram.com/x" }],
    } });
  });
  await go(page);
  await expect(page.getByTestId("fans-name")).toContainText("Test Band");
  // Top to bottom: the email list, the shows, merch, links, then the socials.
  const order = await page.locator('form, [data-testid="fans-show-line"], [data-testid="fans-merch"], [data-testid="fans-links"], [data-testid="fans-socials"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid") ?? "form"));
  expect(order).toEqual(["form", "fans-show-line", "fans-show-line", "fans-merch", "fans-links", "fans-socials"]);
  // A show's line: + and − like merch, the button says Ticket or Suggested Donation, Venmo gets the total and the show.
  const [donate, ticket] = [page.getByTestId("fans-show-line").nth(0), page.getByTestId("fans-show-line").nth(1)];
  await expect(donate.getByTestId("fans-show-pay")).toHaveText("Suggested Donation · $20");
  await expect(donate.getByTestId("fans-show-pay")).toHaveAttribute("href", "https://venmo.com/Test-Band?txn=pay&amount=20.00&note=Jennifer%20House%20Concert");
  await expect(donate.getByTestId("fans-show-minus")).toBeDisabled();
  await donate.getByTestId("fans-show-plus").click();
  await expect(donate.getByTestId("fans-show-count")).toHaveText("2");
  await expect(donate.getByTestId("fans-show-pay")).toHaveText("Suggested Donation · $40");
  await expect(ticket.getByTestId("fans-show-pay")).toHaveText("Buy 1 Ticket · $15");
  await ticket.getByTestId("fans-show-plus").click();
  await ticket.getByTestId("fans-show-plus").click();
  await expect(ticket.getByTestId("fans-show-pay")).toHaveText("Buy 3 Tickets · $45");
  await expect(ticket.getByTestId("fans-show-pay")).toHaveAttribute("href", "https://venmo.com/Test-Band?txn=pay&amount=45.00&note=3%20tickets%2C%20Deep%20End");
  await expect(page.getByTestId("fans-link")).toHaveAttribute("href", "https://example.com/single");
  await expect(page.getByTestId("fans-social-instagram")).toHaveAttribute("href", "https://instagram.com/x");
  await expect(page.getByTestId("fans-page")).toHaveAttribute("data-theme", "light");
  await expect(page.getByTestId("fans-venmo")).toHaveCSS("color", "rgb(0, 0, 0)");
  const items = page.getByTestId("fans-merch-item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Coozie");
  await expect(items.nth(0)).toContainText("$5");
  const venmo = page.getByTestId("fans-venmo");
  await expect(venmo).toHaveText("Pay with Venmo");
  await expect(venmo).toHaveAttribute("href", "https://venmo.com/Test-Band");
  await items.nth(0).getByTestId("fans-merch-plus").click();
  await items.nth(0).getByTestId("fans-merch-plus").click();
  await items.nth(1).getByTestId("fans-merch-plus").click();
  await expect(items.nth(0).getByTestId("fans-merch-count")).toHaveText("2");
  await expect(venmo).toHaveText("Pay $35 with Venmo");
  await expect(venmo).toHaveAttribute("href", "https://venmo.com/Test-Band?txn=pay&amount=35.00&note=2%20Coozie%2C%201%20T-Shirt");
  await items.nth(1).getByTestId("fans-merch-minus").click();
  await expect(venmo).toHaveText("Pay $10 with Venmo");
  await expect(items.nth(1).getByTestId("fans-merch-minus")).toBeDisabled();
});

test("a logo replaces the name", async ({ page }) => {
  const logo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  await page.route(`**/api/public/${ARTIST_SLUG}/list`, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), artistName: "Test Band", logo } });
  });
  await go(page);
  await expect(page.getByTestId("fans-logo")).toHaveAttribute("alt", "Test Band");
  await expect(page.getByTestId("fans-name")).not.toContainText("Test Band");
});

test("no show: name and zip are optional, and a bad zip is caught", async ({ page }) => {
  // Same data as the server gave, minus today's show.
  await page.route(`**/api/public/${ARTIST_SLUG}/list`, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), current: null } });
  });
  await go(page);
  await expect(page.getByTestId("fans-show")).toHaveCount(0);
  await page.getByTestId("fans-email").fill("fan-zip@example.com");
  await page.getByTestId("fans-zip").fill("803");
  await page.getByTestId("fans-join").click();
  await expect(page.getByTestId("fans-error")).toContainText("5-digit");
  await page.getByTestId("fans-zip").fill("");
  const signup = page.waitForRequest((r) => r.url().endsWith("/signup"));
  await page.getByTestId("fans-join").click();
  expect((await signup).postDataJSON()).toEqual({ email: "fan-zip@example.com", page: `/f/${ARTIST_SLUG}` });
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

test("an unknown band is not found", async ({ page }) => {
  await page.goto("/f/no-such-band");
  await expect(page.getByTestId("fans-not-found")).toBeVisible();
});
