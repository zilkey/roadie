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
  token = await tokenFor("rudy", "Rudy");
  artistId = await artistIdOf(ARTIST_SLUG);
});
test.afterAll(async () => { await api.dispose(); });

test("a linked thread opens as a page, reads like mail, and replies inline", async ({ page, request }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Pine Hollow Lounge" }).locator("[data-testid^='flag-'][data-flagged='1']").click();
  await expect(page.getByTestId(/^pitch-(page|body)$/)).toBeVisible();
  const pitchId = page.url().split("/").pop()!.split("?")[0];
  const venueId = (await page.getByTestId("venue-page").getAttribute("data-record-id"))!; // the venue's one page (#82)

  // A first email from the venue, then a follow-up that quotes it.
  const subject = `Dec 11 at Pine Hollow ${Date.now()}`;
  const first = (await (await request.post(`${GMAIL}/messages/receive`, {
    data: { from: "rosa@pinehollow.example", fromName: "Rosa Jackson", to: ["rudy@example.com"], subject, body: "Hi Nora, are you free Dec 11? Details: https://pinehollow.example/dec11" },
  })).json()) as { threadId: string };
  await request.post(`${GMAIL}/messages/receive`, {
    data: { from: "rosa@pinehollow.example", fromName: "Rosa Jackson", to: ["rudy@example.com"], subject, threadId: first.threadId,
      body: "Also, load-in is at 5.\n\nOn Tue, Dec 2, 2026 at 9:00 AM Rosa Jackson <rosa@pinehollow.example> wrote:\n> Hi Nora, are you free Dec 11?" },
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
  await expect(page.getByTestId("page-title")).toHaveText("Email Thread");
  await expect(page.getByTestId("crumb-1")).toHaveText("Campaigns"); // came from the pitch: Booking › Campaigns › campaign › the pitch › Email
  await expect(page.getByTestId("crumb-3")).toHaveText("Pine Hollow Lounge");
  await expect(page.getByTestId("crumb-current")).toHaveText("Email");
  await expect(page.getByTestId("thread-subject")).toHaveText(subject); // the subject, small, beside Open in Gmail
  await expect(page.getByTestId("thread-private")).toContainText("sent and received from rudy@example.com");
  await expect(page.getByTestId("open-in-gmail")).toHaveAttribute("href", new RegExp(`#all/${first.threadId}$`));

  // The last message is open (with the New pill and its quote hidden); the older one is a single line.
  await expect(page.getByTestId("msg-1")).toContainText("Also, load-in is at 5.");
  await expect(page.getByTestId("msg-new")).toHaveText("New");
  await expect(page.getByTestId("quote-1")).toHaveCount(0);
  await page.getByTestId("quote-toggle-1").click();
  await expect(page.getByTestId("quote-1")).toContainText("are you free Dec 11?");
  await expect(page.getByTestId("msg-body-0")).toHaveCount(0);
  await expect(page.getByTestId("msg-preview-0")).toContainText("Hi Nora, are you free Dec 11?");
  await page.getByTestId("msg-toggle-0").click();
  await expect(page.getByTestId("msg-body-0").getByRole("link", { name: "https://pinehollow.example/dec11" })).toBeVisible();

  // Reply goes to the sender; the answer is sent in the same Gmail thread.
  await expect(page.getByTestId("reply-to")).toContainText("Rosa Jackson");
  await expect(page.getByTestId("reply-to")).toContainText("<rosa@pinehollow.example>"); // the address shows beside the name
  await page.getByTestId("reply-to-input").fill("rosa@pinehollow.example");
  await page.getByTestId("reply-to-input").press("Enter");
  await expect(page.getByTestId("reply-to-error")).toHaveText("rosa@pinehollow.example is already added.");
  await expect(page.getByTestId("reply-to-input")).toHaveValue("rosa@pinehollow.example");
  await page.getByTestId("reply-to-input").fill("");
  await expect(page.getByTestId("reply-to-error")).toHaveCount(0);
  await page.getByTestId("reply-body").click();
  await page.keyboard.type("Dec 11 works");
  await page.getByTestId("reply-send").click();
  await expect(page.getByTestId("reply-note")).toHaveText("Sent");
  await expect(page.getByTestId("msg-2")).toContainText("Dec 11 works");
  await expect(page.getByTestId("msg-2")).toHaveAttribute("data-direction", "sent");

  const msgs = (await (await request.get(`${GMAIL}/messages?account=rudy@example.com`)).json()) as { threadId: string; direction: string; to: string[]; body: string }[];
  const mine = msgs.filter((m) => m.threadId === first.threadId && m.direction === "sent");
  expect(mine).toHaveLength(1);
  expect(mine[0].to).toEqual(["rosa@pinehollow.example"]);
  expect(mine[0].body).toContain("Dec 11 works");

  // Back on the pitch: the row counts 3 messages, and the thread is no longer a new reply.
  await page.getByTestId("crumb-3").click();
  await expect(page.getByTestId(`thread-count-${linked.id}`)).toHaveText("3");
  await expect(page.getByTestId(`thread-new-${linked.id}`)).toHaveCount(0);
});

test("opened from the venue page, the crumbs go back to the venue; a bounce comes off the pitch and stays off", async ({ page, request }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Pine Hollow Lounge" }).locator("[data-testid^='flag-'][data-flagged='1']").click();
  await expect(page.getByTestId(/^pitch-(page|body)$/)).toBeVisible();
  const pitchId = page.url().split("/").pop()!.split("?")[0];
  const venueId = (await page.getByTestId("venue-page").getAttribute("data-record-id"))!;
  const subject = `Bounced ${Date.now()}`;
  const sent = await cmd<{ threadId: string }>("pitches.sendEmail", { id: pitchId, to: ["typo@pinehollow.example"], subject, body: "Hi" });
  const id = `${artistId}__${sent.threadId}`;

  await page.goto(A(`/booking/venues/${venueId}?tab=pitch`));
  await expect(page.getByTestId("pitch-activity-card")).toContainText(subject);
  await page.getByTestId("pitch-email-card").getByTestId(`thread-${id}`).click();
  await expect(page.getByTestId("thread-page")).toBeVisible();
  await expect(page.getByTestId("crumb-1")).toHaveText("Venues");
  await expect(page.getByTestId("crumb-2")).toHaveText("Pine Hollow Lounge");
  await expect(page.getByTestId("crumb-current")).toHaveText("Email");

  // Take it off the pitch: gone from This email covers, and from the pitch's Email card and timeline, after a reload too.
  await expect(page.getByTestId(`covers-${pitchId}`)).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByTestId(`covers-remove-${pitchId}`).click();
  await expect(page.getByTestId(`covers-${pitchId}`)).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("thread-covers")).toContainText("No pitch yet.");
  await page.goto(A(`/booking/pitches/${pitchId}`));
  await expect(page.getByTestId("pitch-email-card")).toBeVisible();
  await expect(page.getByTestId(`thread-${id}`)).toHaveCount(0);
  await expect(page.getByTestId("pitch-activity-card")).not.toContainText(subject);
});

test("the + on This email covers suggests the pitch whose contact is on the email, and adds it", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Pine Hollow Lounge" }).locator("[data-testid^='flag-'][data-flagged='1']").click();
  await expect(page.getByTestId(/^pitch-(page|body)$/)).toBeVisible();
  const pitchId = page.url().split("/").pop()!.split("?")[0];
  // Desmond (Heron Theatre's contact) only cc'd, so he doesn't become a Pine Hollow contact.
  const sent = await cmd<{ threadId: string }>("pitches.sendEmail", { id: pitchId, to: ["rosa@pinehollow.example"], cc: ["desmond@herontheatre.example"], subject: `Both rooms ${Date.now()}`, body: "Hi" });
  await page.goto(A(`/booking/email/${artistId}__${sent.threadId}`));
  await expect(page.getByTestId(`covers-${pitchId}`)).toBeVisible();

  await page.getByTestId("thread-covers-add").click();
  const first = page.getByTestId("covers-pick-hits").locator("button").first();
  await expect(first).toContainText("Heron Theatre");
  await expect(first).toContainText("Desmond Webb is on this email");
  const heronId = (await first.getAttribute("data-testid"))!.replace("covers-pick-hit-", "");
  await page.getByTestId("covers-pick-find").fill("bluebird");
  await expect(page.getByTestId("covers-pick-hits")).toContainText("Bluebird Room"); // anything else is a search away
  await page.getByTestId("covers-pick-find").fill("heron");
  await page.getByTestId(`covers-pick-hit-${heronId}`).click();
  await page.getByTestId("covers-pick-submit").click();
  await expect(page.getByTestId("covers-pick-dialog")).toBeHidden();
  await expect(page.getByTestId(`covers-${heronId}`)).toContainText("Heron Theatre");

  // Leave Heron Theatre as it was for the other specs.
  page.once("dialog", (d) => d.accept());
  await page.getByTestId(`covers-remove-${heronId}`).click();
  await expect(page.getByTestId(`covers-${heronId}`)).toHaveCount(0);
});

test("unlinking a thread takes it off the place and returns to the pitch", async ({ page, request }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Pine Hollow Lounge" }).locator("[data-testid^='flag-'][data-flagged='1']").click();
  await expect(page.getByTestId(/^pitch-(page|body)$/)).toBeVisible();
  const pitchId = page.url().split("/").pop()!.split("?")[0];
  const venueId = (await page.getByTestId("venue-page").getAttribute("data-record-id"))!; // the venue's one page (#82)
  const subject = `Unlink me ${Date.now()}`;
  const m = (await (await request.post(`${GMAIL}/messages/receive`, { data: { from: "rosa@pinehollow.example", to: ["rudy@example.com"], subject, body: "Hello" } })).json()) as { threadId: string };
  const linked = await cmd<{ id: string }>("email.link", { threadId: m.threadId, target: { kind: "venue", id: venueId }, pitchId });
  await page.goto(A(`/booking/email/${linked.id}`));
  await expect(page.getByTestId("msg-0")).toContainText("Hello");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("thread-actions").click();
  await page.getByTestId("thread-menu-unlink").click();
  await expect(page).toHaveURL(new RegExp(`/booking/pitches/${pitchId}$`));
  await expect(page.getByTestId("pitch-email-card")).not.toContainText(subject);
});

test("formatting shows on the thread, and a formatted paste into the reply is sent with it", async ({ page, request }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Pine Hollow Lounge" }).locator("[data-testid^='flag-'][data-flagged='1']").click();
  await expect(page.getByTestId(/^pitch-(page|body)$/)).toBeVisible();
  const pitchId = page.url().split("/").pop()!.split("?")[0];
  const venueId = (await page.getByTestId("venue-page").getAttribute("data-record-id"))!;

  // A Gmail-style HTML reply: formatting, a link, a script that must not run, and Gmail's quote block.
  const subject = `Formatted ${Date.now()}`;
  const m = (await (await request.post(`${GMAIL}/messages/receive`, {
    data: { from: "rosa@pinehollow.example", to: ["rudy@example.com"], subject,
      body: "Load-in is at 5. Parking: https://pinehollow.example/parking\n\nOn Mon, Rudy wrote:\n> Hi",
      html: '<div dir="ltr">Load-in is <b>at 5</b>, <i>sharp</i>. <span style="text-decoration:underline">Bring cables.</span> <a href="https://pinehollow.example/parking">Parking</a><script>window.__pwned = 1</script></div><div class="gmail_quote"><div class="gmail_attr">On Mon, Rudy wrote:</div><blockquote class="gmail_quote">Hi</blockquote></div>' },
  })).json()) as { threadId: string };
  const linked = await cmd<{ id: string }>("email.link", { threadId: m.threadId, target: { kind: "venue", id: venueId }, pitchId });
  await page.goto(A(`/booking/email/${linked.id}`));

  const html = page.getByTestId("msg-html-0");
  await expect(html.locator("b")).toHaveText("at 5");
  await expect(html.locator("i")).toHaveText("sharp");
  await expect(html.locator("u")).toHaveText("Bring cables.");
  await expect(html.getByRole("link", { name: "Parking" })).toHaveAttribute("target", "_blank");
  await expect(html).not.toContainText("On Mon, Rudy wrote");
  expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
  await page.getByTestId("quote-toggle-0").click();
  await expect(page.getByTestId("quote-0")).toContainText("On Mon, Rudy wrote:");

  // Paste what Google Docs puts on the clipboard: formatting on spans inside a <b style="font-weight:normal"> wrapper.
  const body = page.getByTestId("reply-body");
  await body.click();
  await body.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData("text/html", '<b style="font-weight:normal" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700">See you</span> <span style="font-style:italic">at</span> <span style="text-decoration:underline">five</span></p></b>');
    dt.setData("text/plain", "See you at five");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(body.locator("b")).toHaveText("See you");
  await expect(body.locator("u")).toHaveText("five");
  await page.getByTestId("reply-send").click();
  await expect(page.getByTestId("reply-note")).toHaveText("Sent");

  const sent = (await (await request.get(`${GMAIL}/messages?account=rudy@example.com`)).json()) as { threadId: string; direction: string; html?: string }[];
  const mine = sent.find((x) => x.threadId === m.threadId && x.direction === "sent");
  expect(mine?.html).toContain("<b>See you</b>");
  expect(mine?.html).toContain("<i>at</i>");
  expect(mine?.html).toContain("<u>five</u>");
  await expect(page.getByTestId("msg-html-1").locator("b")).toHaveText("See you");
});
