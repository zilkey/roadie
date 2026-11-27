import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { A, APP, AUTH, FIRESTORE, ARTIST_SLUG } from "./env";

// Booking an opener slot through a promoter (Jeff, 2026-11-22): on a campaign page the promoter's name opens its pitch, starting an
// empty one in that campaign when it has none, and that Pitch tab lists the shows pitched at the promoter's rooms. "Write one email"
// fills To from the rooms' contacts when the promoter has none of its own, and offers the pitched shows to insert.
// Everything here is made by this spec (stamped names, so a retry starts clean): a promoter with no contacts, two of its rooms with a
// booking contact each (the same address twice, as Z2's rooms all list one inbox), and one upcoming show per room, pitched.

let api: APIRequestContext;
let token: string;
let artistId: string;
const stamp = Date.now();
const name = (s: string) => `${s} ${stamp}`;
const made = { campaign: "", promoter: "", venues: [] as string[], events: [] as string[] };

async function tokenFor(key: string, display: string) {
  const res = await api.post(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo`, {
    data: {
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: `dev-${key}`, email: `${key}@example.com`, email_verified: true, name: display }))}&providerId=google.com`,
      requestUri: "http://localhost", returnIdpSignInMethod: true, returnSecureToken: true,
    },
  });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { idToken: string }).idToken;
}
async function cmd<T = Record<string, unknown>>(cmdName: string, input: unknown): Promise<T> {
  const res = await api.post(`${APP}/api/commands/${cmdName}`, { data: input, headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } });
  expect(res.ok(), `${cmdName}: ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { result: T }).result;
}
/** A show on a venue's calendar: shared, top-level, written straight to the emulator as a refresh would. */
async function putEvent(id: string, venueId: string, date: string, headliner: string) {
  const s = (v: string) => ({ stringValue: v });
  const res = await api.patch(`http://${FIRESTORE}/v1/projects/demo-band-tracker/databases/(default)/documents/venueEvents/${id}`, {
    headers: { authorization: "Bearer owner" },
    data: { fields: {
      id: s(id), venueId: s(venueId), sourceId: s(id), source: s("ics"), date: s(date), title: s(headliner), bill: s("headliner"), status: s("onsale"),
      acts: { arrayValue: { values: [{ mapValue: { fields: { name: s(headliner), role: s("headliner") } } }] } },
      firstSeenAt: s("2026-11-01T00:00:00.000Z"), lastSeenAt: s("2026-11-01T00:00:00.000Z"), deletedAt: { nullValue: null },
    } },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext();
  token = await tokenFor("rudy", "Rudy");
  const res = await api.get(`http://${FIRESTORE}/v1/projects/demo-band-tracker/databases/(default)/documents/artists?pageSize=300`, { headers: { authorization: "Bearer owner" } });
  const docs = ((await res.json()) as { documents: { name: string; fields: { slug?: { stringValue: string } } }[] }).documents;
  artistId = docs.find((d) => d.fields.slug?.stringValue === ARTIST_SLUG)!.name.split("/").pop()!;

  made.campaign = (await cmd<{ id: string }>("campaigns.create", { name: name("Opener Slots") })).id;
  made.promoter = (await cmd<{ id: string }>("promoters.create", { name: name("Peak Presents"), kind: "promoter" })).id;
  const inbox = `bookings-${stamp}@peak.example`;
  for (const [room, city, date, act] of [["Summit Hall", "Boulder", "2031-05-02", "Second Example Band"], ["Ridge Room", "Fort Collins", "2031-04-11", "First Example Band"]] as const) {
    const contact = (await cmd<{ id: string }>("contacts.create", { name: name(`${room} booking`), emails: [inbox] })).id;
    const venue = (await cmd<{ id: string }>("venues.create", { name: name(room), type: "theater", address: { city, state: "CO" }, region: "boulder", contactIds: [contact], promoterIds: [made.promoter] })).id;
    made.venues.push(venue);
    const ev = `${venue}__spec${stamp}`;
    made.events.push(ev);
    await putEvent(ev, venue, date, act);
    await cmd("venueEvents.pitch", { eventId: ev, campaignId: made.campaign });
  }
});

test.afterAll(async () => {
  if (made.campaign) await api.post(`${APP}/api/commands/campaigns.close`, { data: { id: made.campaign }, headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } });
  // The shows are upcoming and shared: left behind, they'd sit in every venue's calendar that a later spec in this shard counts
  // (venue-calendars.spec.ts lists exactly the Bluebird Room's three).
  for (const ev of made.events) await api.delete(`http://${FIRESTORE}/v1/projects/demo-band-tracker/databases/(default)/documents/venueEvents/${ev}`, { headers: { authorization: "Bearer owner" } });
  await api.dispose();
});

test("a promoter's name on a campaign opens its pitch with the shows pitched at its rooms, and one email to them has To and the shows", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A(`/booking/campaigns/${made.campaign}`));
  const group = page.getByTestId(`group-${made.promoter}`);
  await expect(group).toContainText("2 venues");

  // One email for the group: the promoter has no contacts, so To is the rooms' booking inbox, once
  await group.getByTestId(`group-write-${made.promoter}`).click();
  await expect(page.getByTestId("compose-page")).toBeVisible();
  await expect(page.getByTestId("to-row").locator('[data-testid^="to-chip-"]')).toHaveCount(1);
  await expect(page.getByTestId(`to-chip-bookings-${stamp}@peak.example`)).toBeVisible();
  await expect(page.getByTestId("compose-contacts").locator('[data-testid^="contact-pick-venue-"]')).toHaveCount(1);
  // the pitched shows, soonest first, and Insert all puts them in the message as a list
  const touches = page.getByTestId("promoter-show-touches");
  await expect(touches.locator("li")).toHaveCount(3);
  await expect(touches.locator("li").nth(1)).toContainText(`First Example Band at ${name("Ridge Room")}`);
  await page.getByTestId("touch-insert-shows:all").click();
  await expect(page.getByTestId("email-body")).toContainText("We'd love to open any of these shows:");
  await expect(page.getByTestId("email-body").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("email-body").locator("li").first()).toContainText(`First Example Band at ${name("Ridge Room")}`);

  // The promoter's name: no pitch of its own yet, so it starts one in this campaign and opens it on the Pitch tab
  await page.goto(A(`/booking/campaigns/${made.campaign}`));
  await page.getByTestId(`group-name-${made.promoter}`).click();
  await expect(page).toHaveURL(/\/booking\/pitches\/[^/?]+$/);
  await expect(page.getByTestId("promoter-page")).toBeVisible();
  await expect(page.getByTestId("pitch-body")).toBeVisible();
  const shows = page.getByTestId("promoter-pitched-shows");
  await expect(shows).toContainText("Pitched shows (2)");
  await expect(shows.locator("tbody tr")).toHaveCount(2);
  await expect(shows.locator("tbody tr").first()).toContainText("First Example Band");
  await expect(shows.locator("tbody tr").first()).toContainText(name("Ridge Room"));
  const pitchUrl = page.url();

  // back on the campaign, the group row now carries the promoter's own pitch, and its name goes straight back to it
  await page.goto(A(`/booking/campaigns/${made.campaign}`));
  await expect(page.getByTestId(`group-${made.promoter}`)).toContainText("and the promoter's own pitch");
  await page.getByTestId(`group-name-${made.promoter}`).click();
  await expect(page).toHaveURL(pitchUrl);
});
