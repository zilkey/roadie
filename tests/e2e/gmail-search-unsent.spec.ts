import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { A, APP, AUTH, FIRESTORE, GMAIL, ARTIST_SLUG } from "./env";

// Search Gmail finds drafts and scheduled mail too (Jeff, 2026-11-22: a pitch to Z2 sat in Gmail's Scheduled and the search found
// nothing). Z2 has no contacts of its own; its rooms list one booking inbox, so the promoter's search offers the rooms' contacts.
// A scheduled email linked from the pitch is kept there until Gmail sends it. Everything here is made by this spec, stamped.

let api: APIRequestContext;
let token: string;
let artistId: string;
const stamp = Date.now();
const inbox = `bookingasst-${stamp}@z2.example`;
const made = { promoter: "", pitch: "", contact: "" };

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
  made.promoter = (await cmd<{ id: string }>("promoters.create", { name: `Zed Two Presents ${stamp}`, kind: "promoter" })).id;
  made.contact = (await cmd<{ id: string }>("contacts.create", { name: `Zed booking ${stamp}`, emails: [inbox] })).id;
  await cmd("venues.create", { name: `Zed Room ${stamp}`, type: "theater", address: { city: "Denver", state: "CO" }, region: "denver", contactIds: [made.contact], promoterIds: [made.promoter] });
  made.pitch = (await cmd<{ id: string }>("pitches.flag", { kind: "promoter", id: made.promoter })).id;
});
test.afterAll(async () => {
  if (made.pitch) await api.post(`${APP}/api/commands/pitches.remove`, { data: { id: made.pitch }, headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } });
  await api.dispose();
});

test("Search Gmail shows a scheduled email to the promoter's rooms; linking it from the pitch keeps it there as Scheduled in Gmail", async ({ page }) => {
  const subject = `Local support for Monday ${stamp}`;
  const sched = (await (await api.post(`${GMAIL}/drafts/gmail`, { data: { from: "rudy@example.com", to: [inbox], subject, body: "Hi, we'd love to open.", scheduled: true, sendAt: "2031-03-03T16:35:00.000Z" } })).json()) as { threadId: string };
  const draftSubject = `Still writing ${stamp}`;
  const draft = (await (await api.post(`${GMAIL}/drafts/gmail`, { data: { from: "rudy@example.com", to: [inbox], subject: draftSubject, body: "Half done" } })).json()) as { threadId: string };

  await signInAs(page, "rudy");
  await page.goto(A(`/booking/email/search?target=promoter:${made.promoter}&pitch=${made.pitch}`));
  // the room's booking contact is offered, and pressed
  await expect(page.getByTestId(`gmail-from-${made.contact}`)).toBeVisible();
  const row = page.getByTestId(`gmail-thread-${sched.threadId}`);
  await expect(row).toContainText(subject);
  await expect(row).toContainText("Not sent yet");
  await expect(page.getByTestId(`gmail-unsent-${sched.threadId}`)).toContainText("Scheduled · Mon, Mar 3");
  await expect(page.getByTestId(`gmail-open-gmail-${sched.threadId}`)).toHaveAttribute("href", /#scheduled$/);
  await expect(page.getByTestId(`gmail-unsent-${draft.threadId}`)).toHaveText("Draft");
  await expect(page.getByTestId(`gmail-open-gmail-${draft.threadId}`)).toHaveAttribute("href", /#drafts\?compose=m\d+$/);
  await expect(row.getByTestId(`gmail-reply-${sched.threadId}`)).toHaveCount(0);

  await page.getByTestId(`gmail-link-${sched.threadId}`).click();
  await expect(page.getByTestId(`gmail-kept-${sched.threadId}`)).toHaveText("Kept on this pitch");
  await expect(page.getByTestId(`gmail-link-${sched.threadId}`)).toHaveCount(0);

  // the pitch has it, as Scheduled in Gmail
  await page.goto(A(`/booking/pitches/${made.pitch}`));
  const kept = page.getByTestId("email-drafts");
  await expect(kept).toContainText(subject);
  await expect(kept).toContainText("Scheduled in Gmail");
  await expect(kept).not.toContainText(draftSubject);
});
