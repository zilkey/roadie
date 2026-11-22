import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { A, APP, AUTH, FIRESTORE, GMAIL, ARTIST_SLUG } from "./env";

// Send later (Jeff, 2026-11-22: booking on a Sunday, emails out Monday early): Gmail's API can't schedule, so Roadie saves a draft
// in Gmail with a link to it, where Schedule send is, and logs the email on the pitch once Gmail has sent it. The fake Gmail stands
// in for what the person does there (schedule, then Gmail sends it). The venue and its pitch are made here, stamped.

let api: APIRequestContext;
let token: string;
let artistId: string;
const stamp = Date.now();
const room = `Draft Room ${stamp}`;
let pitchId = "";

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
async function cmd<T = Record<string, unknown>>(name: string, input: unknown): Promise<T> {
  const res = await api.post(`${APP}/api/commands/${name}`, { data: input, headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } });
  expect(res.ok(), `${name}: ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { result: T }).result;
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
  const contact = (await cmd<{ id: string }>("contacts.create", { name: `Dee Booker ${stamp}`, emails: [`dee-${stamp}@draftroom.example`] })).id;
  const venue = (await cmd<{ id: string }>("venues.create", { name: room, type: "club", address: { city: "Denver", state: "CO" }, region: "denver", contactIds: [contact] })).id;
  pitchId = (await cmd<{ id: string }>("pitches.flag", { kind: "venue", id: venue })).id;
  await cmd("pitches.move", { id: pitchId, status: "toPitch" });
});
test.afterAll(async () => {
  if (pitchId) await api.post(`${APP}/api/commands/pitches.remove`, { data: { id: pitchId }, headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } });
  await api.dispose();
});

test("save a draft in Gmail to send later: a link to it, kept on the pitch, scheduled, then logged with Gmail's send time", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A(`/booking/email/new?pitch=${pitchId}`));
  await expect(page.getByTestId("compose-page")).toBeVisible();
  await expect(page.getByTestId(`to-chip-dee-${stamp}@draftroom.example`)).toBeVisible();
  await page.getByTestId("email-subject").fill(`Monday pitch ${stamp}`);
  await page.getByTestId("email-body").click();
  await page.keyboard.type("Hi Dee, we'd love a Friday in March.");
  await page.getByTestId("email-draft").click();

  // saved: a link to the draft in Gmail (the right mailbox), and Done back to the pitch
  await expect(page.getByTestId("email-drafted")).toContainText("Schedule send");
  await expect(page.getByTestId("email-drafted-open")).toHaveAttribute("href", /^https:\/\/mail\.google\.com\/mail\/\?authuser=rudy%40example\.com#drafts\?compose=m\d+$/);
  await expect(page.getByTestId("email-drafted-open")).toHaveAttribute("target", "_blank");
  await page.getByTestId("email-drafted-done").click();
  await expect(page).toHaveURL(new RegExp(`/booking/pitches/${pitchId}$`));

  // the pitch keeps it: Draft in Gmail, not a thread yet
  const drafts = page.getByTestId("email-drafts");
  await expect(drafts).toContainText(`Monday pitch ${stamp}`);
  const row = drafts.locator('[data-testid^="email-draft-d"]').first();
  const draftId = (await row.getAttribute("data-testid"))!.replace("email-draft-", "");
  await expect(page.getByTestId(`email-draft-state-${draftId}`)).toHaveText("Draft in Gmail");

  // in Gmail: Schedule send. Opening the pitch again asks Gmail, and it says Scheduled, linking to Gmail's Scheduled folder
  expect((await api.post(`${GMAIL}/drafts/${draftId}/schedule`)).ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId(`email-draft-state-${draftId}`)).toHaveText("Scheduled in Gmail");
  await expect(page.getByTestId(`email-draft-open-${draftId}`)).toHaveAttribute("href", /#scheduled$/);

  // Monday morning Gmail sends it: the next visit logs it, dated when it went, and the pitch moves to Pitched
  expect((await api.post(`${GMAIL}/drafts/${draftId}/send`, { data: { date: "2031-03-03T14:02:00.000Z" } })).ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("email-drafts")).toHaveCount(0);
  await expect(page.getByTestId("email-threads")).toContainText(`Monday pitch ${stamp}`);
  await expect(page.getByTestId("pitch-body")).toContainText("Pitched");
});
