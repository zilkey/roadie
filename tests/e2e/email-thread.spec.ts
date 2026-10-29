import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { APP, AUTH, FIRESTORE, GMAIL, ARTIST_SLUG, A } from "./env";

// The thread page /booking/email/<id>: a linked Gmail thread read like mail, with an inline reply. The mail is put in the fake
// Gmail with /messages/receive and linked through the app's own command, since the Search Gmail page is another story.

let api: APIRequestContext;
let token: string;
let artistId: string;

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

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

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext();
  token = await tokenFor("jeff", "Jeff");
  artistId = await artistIdOf(ARTIST_SLUG);
});
test.afterAll(async () => { await api.dispose(); });

test("a linked thread opens as a page, reads like mail, and replies inline", async ({ page, request }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Lost Lake Lounge" }).locator("[data-testid^='flag-'][data-flagged='1']").click();
  await expect(page.getByTestId("pitch-page")).toBeVisible();
  const pitchId = page.url().split("/").pop()!.split("?")[0];
  const venueId = (await page.getByTestId("target-link").getAttribute("href"))!.split("/").pop()!;

  // A first email from the venue, then a follow-up that quotes it.
  const subject = `Dec 11 at Lost Lake ${Date.now()}`;
  const first = (await (await request.post(`${GMAIL}/messages/receive`, {
    data: { from: "haylee@lostlake.example", fromName: "Haylee Jackson", to: ["jeff@example.com"], subject, body: "Hi Ingrid, are you free Dec 11? Details: https://lostlake.example/dec11" },
  })).json()) as { threadId: string };
  await request.post(`${GMAIL}/messages/receive`, {
    data: { from: "haylee@lostlake.example", fromName: "Haylee Jackson", to: ["jeff@example.com"], subject, threadId: first.threadId,
      body: "Also, load-in is at 5.\n\nOn Tue, Dec 2, 2026 at 9:00 AM Haylee Jackson <haylee@lostlake.example> wrote:\n> Hi Ingrid, are you free Dec 11?" },
  });
  const linked = await cmd<{ id: string }>("email.link", { threadId: first.threadId, target: { kind: "venue", id: venueId }, pitchId });

  // The pitch's Email card has it, flagged as a new reply; the timeline row links to the thread.
  await page.goto(A(`/booking/pitches/${pitchId}`));
  const card = page.getByTestId("pitch-email-card");
  await expect(card.getByTestId(`thread-${linked.id}`)).toContainText(subject);
  await expect(card.getByTestId(`thread-new-${linked.id}`)).toHaveText("New reply");
  await expect(page.getByTestId("tl-read-emailReply").first()).toBeVisible();

  await card.getByTestId(`thread-${linked.id}`).click();
  await expect(page.getByTestId("thread-page")).toBeVisible();
  await expect(page.getByTestId("page-title")).toHaveText(subject);
  await expect(page.getByTestId("back")).toHaveText("← Back");
  await expect(page.getByTestId("thread-page")).toContainText("2 messages · Haylee Jackson");
  await expect(page.getByTestId("thread-private")).toContainText("sent and received from jeff@example.com");
  await expect(page.getByTestId("open-in-gmail")).toHaveAttribute("href", new RegExp(`#all/${first.threadId}$`));

  // The last message is open (with the New pill and its quote hidden); the older one is a single line.
  await expect(page.getByTestId("msg-1")).toContainText("Also, load-in is at 5.");
  await expect(page.getByTestId("msg-new")).toHaveText("New");
  await expect(page.getByTestId("quote-1")).toHaveCount(0);
  await page.getByTestId("quote-toggle-1").click();
  await expect(page.getByTestId("quote-1")).toContainText("are you free Dec 11?");
  await expect(page.getByTestId("msg-body-0")).toHaveCount(0);
  await expect(page.getByTestId("msg-preview-0")).toContainText("Hi Ingrid, are you free Dec 11?");
  await page.getByTestId("msg-toggle-0").click();
  await expect(page.getByTestId("msg-body-0").getByRole("link", { name: "https://lostlake.example/dec11" })).toBeVisible();

  // Reply goes to the sender; the answer is sent in the same Gmail thread.
  await expect(page.getByTestId("reply-to")).toContainText("Haylee Jackson");
  await page.getByTestId("reply-body").click();
  await page.keyboard.type("Dec 11 works");
  await page.getByTestId("reply-send").click();
  await expect(page.getByTestId("reply-note")).toHaveText("Sent");
  await expect(page.getByTestId("msg-2")).toContainText("Dec 11 works");
  await expect(page.getByTestId("msg-2")).toHaveAttribute("data-direction", "sent");

  const msgs = (await (await request.get(`${GMAIL}/messages?account=jeff@example.com`)).json()) as { threadId: string; direction: string; to: string[]; body: string }[];
  const mine = msgs.filter((m) => m.threadId === first.threadId && m.direction === "sent");
  expect(mine).toHaveLength(1);
  expect(mine[0].to).toEqual(["haylee@lostlake.example"]);
  expect(mine[0].body).toContain("Dec 11 works");

  // Back on the pitch: the row counts 3 messages, and the thread is no longer a new reply.
  await page.getByTestId("back").click();
  await expect(page.getByTestId(`thread-count-${linked.id}`)).toHaveText("3");
  await expect(page.getByTestId(`thread-new-${linked.id}`)).toHaveCount(0);
});

test("unlinking a thread takes it off the place and returns to the pitch", async ({ page, request }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Lost Lake Lounge" }).locator("[data-testid^='flag-'][data-flagged='1']").click();
  await expect(page.getByTestId("pitch-page")).toBeVisible();
  const pitchId = page.url().split("/").pop()!.split("?")[0];
  const venueId = (await page.getByTestId("target-link").getAttribute("href"))!.split("/").pop()!;
  const subject = `Unlink me ${Date.now()}`;
  const m = (await (await request.post(`${GMAIL}/messages/receive`, { data: { from: "haylee@lostlake.example", to: ["jeff@example.com"], subject, body: "Hello" } })).json()) as { threadId: string };
  const linked = await cmd<{ id: string }>("email.link", { threadId: m.threadId, target: { kind: "venue", id: venueId }, pitchId });
  await page.goto(A(`/booking/email/${linked.id}`));
  await expect(page.getByTestId("msg-0")).toContainText("Hello");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("thread-actions").click();
  await page.getByTestId("thread-menu-unlink").click();
  await expect(page).toHaveURL(new RegExp(`/booking/pitches/${pitchId}$`));
  await expect(page.getByTestId("pitch-email-card")).not.toContainText(subject);
});
