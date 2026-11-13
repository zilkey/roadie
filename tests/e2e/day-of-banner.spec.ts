import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { A, FIRESTORE } from "./env";

// The day-of banner (#66). The banner runs on the real clock, so the show and the rehearsal here are written straight into the
// emulator with times relative to now (on the band's clock, America/Denver): copies of the seeded Deep End show and Loft rehearsal.

const DOCS = `http://${FIRESTORE}/v1/projects/demo-band-tracker/databases/(default)/documents`;
const OWNER = { authorization: "Bearer owner" };
const SHOW = "e2e-dayof-show";
const REHEARSAL = "e2e-dayof-rehearsal";
const HOUR = 60 * 60 * 1000;

type Fields = Record<string, unknown>;
const str = (s: string) => ({ stringValue: s });

/** The band's wall clock at an instant: { date: "2026-11-10", time: "17:05", shown: "5:05 pm" }. */
function denver(at: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  const h = Number(p.hour) % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${String(h).padStart(2, "0")}:${p.minute}`, shown: `${((h + 11) % 12) + 1}:${p.minute} ${h < 12 ? "am" : "pm"}` };
}

async function seeded(request: APIRequestContext, collection: string, match: (f: Fields) => boolean): Promise<Fields> {
  const res = await request.get(`${DOCS}/${collection}?pageSize=300`, { headers: OWNER });
  const docs = ((await res.json()) as { documents: { fields: Fields }[] }).documents;
  const found = docs.find((d) => match(d.fields));
  if (!found) throw new Error(`no seeded ${collection} doc to copy`);
  return found.fields;
}
async function put(request: APIRequestContext, path: string, fields: Fields) {
  expect((await request.patch(`${DOCS}/${path}`, { headers: OWNER, data: { fields } })).ok()).toBeTruthy();
}
const nameOf = (f: Fields, key: string) => ((f[key] as { mapValue?: { fields?: { name?: { stringValue?: string } } } } | undefined)?.mapValue?.fields?.name?.stringValue);

/** A confirmed show at the Deep End whose only time is a load-in at `loadInAt`. */
async function putShow(request: APIRequestContext, loadInAt: number) {
  const base = await seeded(request, "shows", (f) => nameOf(f, "venue") === "Deep End");
  const t = denver(loadInAt);
  await put(request, `shows/${SHOW}`, { ...base, date: str(t.date), status: str("confirmed"), times: { mapValue: { fields: { loadIn: str(t.time) } } } });
  return t;
}
/** A rehearsal at the Attic starting at `startAt`, with no end time. */
async function putRehearsal(request: APIRequestContext, startAt: number) {
  const { endTime: _end, ...base } = await seeded(request, "rehearsals", (f) => nameOf(f, "location") === "The Attic");
  const t = denver(startAt);
  await put(request, `rehearsals/${REHEARSAL}`, { ...base, date: str(t.date), startTime: str(t.time) });
  return t;
}
async function uidOf(request: APIRequestContext, email: string) {
  const res = await request.get(`${DOCS}/users?pageSize=100`, { headers: OWNER });
  const docs = ((await res.json()) as { documents: { name: string; fields: { email?: { stringValue: string } } }[] }).documents;
  return docs.find((d) => d.fields.email?.stringValue === email)!.name.split("/").pop()!;
}
/** Forget what someone hid, leaving the rest of their prefs alone. */
async function clearDismissed(request: APIRequestContext, email: string) {
  const uid = await uidOf(request, email);
  const has = await request.get(`${DOCS}/userPrefs/${uid}`, { headers: OWNER });
  if (has.ok()) await request.patch(`${DOCS}/userPrefs/${uid}?updateMask.fieldPaths=dayOfDismissed`, { headers: OWNER, data: { fields: {} } });
}
async function cleanUp(request: APIRequestContext) {
  await request.delete(`${DOCS}/shows/${SHOW}`, { headers: OWNER });
  await request.delete(`${DOCS}/rehearsals/${REHEARSAL}`, { headers: OWNER });
  for (const email of ["rudy@example.com", "hugo@example.com"]) await clearDismissed(request, email);
}

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

test.beforeEach(async ({ request }) => { await cleanUp(request); });
test.afterAll(async ({ request }) => { await cleanUp(request); });

test("the banner shows inside the window and not before, stacks earliest first, and each row opens its page", async ({ page, request }) => {
  const now = Date.now();
  // The rehearsal starts in an hour (its window opened two hours ago); the show loads in 5 hours from now: too early for its row.
  const rehearsal = await putRehearsal(request, now + HOUR);
  await putShow(request, now + 5 * HOUR);
  await signInAs(page, "rudy");

  const banner = page.getByTestId("dayof-banner");
  const rows = banner.locator("[data-key]");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Rehearsal");
  await expect(rows.first()).toContainText("The Attic");
  await expect(rows.first().getByTestId("dayof-when")).toHaveText(`Starts ${rehearsal.shown}`);
  await expect(banner.getByTestId("dayof-row-show")).toHaveCount(0);

  // The load-in moves to 2 hours from now: the show's row appears by itself, under the rehearsal (which appeared first).
  const show = await putShow(request, now + 2 * HOUR);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute("data-testid", "dayof-row-rehearsal");
  await expect(rows.nth(1)).toHaveAttribute("data-testid", "dayof-row-show");
  await expect(rows.nth(1).getByTestId("dayof-title")).toHaveText("Deep End");
  await expect(rows.nth(1).getByTestId("dayof-when")).toHaveText(`Load-in ${show.shown}`);

  // Above the nav, full rows.
  const bannerBox = (await banner.boundingBox())!;
  const topbar = (await page.getByTestId("topbar").boundingBox())!;
  expect(bannerBox.y + bannerBox.height).toBeLessThanOrEqual(topbar.y + 1);
  expect(bannerBox.height).toBe(88);

  // Each piece of the row is its own link to the page; Directions opens Google Maps; an admin gets Edit Fan Page (the
  // Promotion tab) and, with no amount on the line yet, no Preview.
  const showRow = banner.getByTestId("dayof-row-show");
  for (const id of ["dayof-link", "dayof-title", "dayof-when", "dayof-city"]) await expect(showRow.getByTestId(id)).toHaveAttribute("href", new RegExp(`/shows/${SHOW}$`));
  await expect(showRow.getByTestId("dayof-directions")).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=Deep%20End/);
  await expect(showRow.getByTestId("dayof-fan-edit")).toHaveAttribute("href", new RegExp(`/shows/${SHOW}\\?tab=promotion$`));
  await expect(showRow.getByTestId("dayof-fan-preview")).toHaveCount(0);

  // Each row goes straight to its page, and the banner is there too.
  await banner.getByTestId("dayof-row-show").getByTestId("dayof-link").click();
  await expect(page).toHaveURL(new RegExp(`/shows/${SHOW}$`));
  await expect(page.getByRole("heading", { name: "Deep End" }).first()).toBeVisible();
  await expect(rows).toHaveCount(2);
  await banner.getByTestId("dayof-row-rehearsal").getByTestId("dayof-link").click();
  await expect(page).toHaveURL(new RegExp(`/rehearsals/${REHEARSAL}$`));

  // On a phone: above the phone bar, 44px a row, nothing wider than the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("phonebar")).toBeVisible();
  const phone = (await banner.boundingBox())!;
  expect(phone.height).toBe(88);
  expect(phone.width).toBe(390);
  expect(phone.y + phone.height).toBeLessThanOrEqual((await page.getByTestId("phonebar").boundingBox())!.y + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("dismissing hides a row for that person only, and it stays hidden", async ({ page, request, browser }) => {
  const now = Date.now();
  await putRehearsal(request, now + HOUR);
  await putShow(request, now + 2 * HOUR);
  await signInAs(page, "rudy");
  const banner = page.getByTestId("dayof-banner");
  await expect(banner.locator("[data-key]")).toHaveCount(2);

  await banner.getByRole("button", { name: "Hide the banner for Deep End" }).click();
  await expect(banner.locator("[data-key]")).toHaveCount(1);
  await expect(banner.getByTestId("dayof-row-show")).toHaveCount(0);
  await expect(banner.getByTestId("dayof-row-rehearsal")).toBeVisible();

  // Saved to Rudy's prefs: still hidden after a reload, and the rehearsal's row is still there.
  await expect.poll(async () => JSON.stringify((await (await request.get(`${DOCS}/userPrefs/${await uidOf(request, "rudy@example.com")}`, { headers: OWNER })).json()).fields?.dayOfDismissed ?? {})).toContain(`show:${SHOW}:`);
  await page.reload();
  await expect(banner.getByTestId("dayof-row-rehearsal")).toBeVisible();
  await expect(banner.getByTestId("dayof-row-show")).toHaveCount(0);

  // Hugo, a member, still sees both.
  const other = await browser.newContext();
  const hugoPage = await other.newPage();
  await signInAs(hugoPage, "hugo");
  const davids = hugoPage.getByTestId("dayof-banner").locator("[data-key]");
  await expect(davids).toHaveCount(2);
  await expect(hugoPage.getByTestId("dayof-banner").getByTestId("dayof-row-show")).toContainText("Deep End");

  // Hiding the last row takes the whole bar away.
  await banner.getByRole("button", { name: "Hide the banner for the rehearsal at The Attic" }).click();
  await expect(banner).toHaveCount(0);
  await expect(davids).toHaveCount(2);
  await other.close();
});

test("after the show the row congratulates; Record the deets opens the show and starts Roadie's interview in a new chat", async ({ page, request, browser }) => {
  // The show's only time, the load-in, was 90 minutes ago: past the hour after its last time, inside the 3 hours the row stays.
  await putShow(request, Date.now() - 90 * 60 * 1000);
  await signInAs(page, "rudy");
  const row = page.getByTestId("dayof-banner").getByTestId("dayof-row-show");
  await expect(row.getByTestId("dayof-congrats")).toHaveText("Congrats on the Deep End show!");
  await expect(row.getByTestId("dayof-record")).toHaveText("Record the deets");
  await expect(row.getByTestId("dayof-when")).toHaveCount(0);

  const sent = page.waitForRequest((r) => r.url().endsWith("/api/assistant/chat") && r.method() === "POST");
  await row.getByTestId("dayof-link").click();
  await expect(page).toHaveURL(new RegExp(`/shows/${SHOW}$`));
  const body = (await sent).postDataJSON() as { threadId?: string; message: string; pageContext: { route: string; recordKind?: string; recordId?: string } };
  expect(body.message).toBe("Ask me about the Deep End show");
  expect(body.threadId).toBeUndefined(); // a new chat
  expect(body.pageContext).toEqual({ route: "show", recordKind: "show", recordId: SHOW });
  const panel = page.getByTestId("roadie-panel");
  await expect(panel.getByTestId("roadie-msg-user").last()).toHaveText("Ask me about the Deep End show");
  await expect(panel.getByTestId("roadie-msg-assistant").last()).toBeVisible();

  // On a phone, with Roadie closed, the sheet opens with it.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("roadie-close").click();
  await expect(page.getByTestId("roadie-pill")).toBeVisible();
  await page.getByTestId("dayof-banner").getByTestId("dayof-row-show").getByTestId("dayof-link").click();
  await expect(page.getByTestId("roadie-sheet").getByTestId("roadie-msg-user").last()).toHaveText("Ask me about the Deep End show");

  // Hugo, a member, has no Roadie: the row congratulates and opens the show, nothing more.
  const other = await browser.newContext();
  const hugoPage = await other.newPage();
  await signInAs(hugoPage, "hugo");
  const davids = hugoPage.getByTestId("dayof-banner").getByTestId("dayof-row-show");
  await expect(davids.getByTestId("dayof-congrats")).toHaveText("Congrats on the Deep End show!");
  await expect(davids.getByTestId("dayof-record")).toHaveCount(0);
  await davids.getByTestId("dayof-link").click();
  await expect(hugoPage).toHaveURL(new RegExp(`/shows/${SHOW}$`));
  await other.close();
});

test("no banner on a day with nothing on", async ({ page }) => {
  await signInAs(page, "rudy");
  await expect(page.getByTestId("topbar")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
  await expect(page.getByTestId("dayof-banner")).toHaveCount(0);
});
