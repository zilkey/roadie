import { test, expect, type Page } from "@playwright/test";
import { GMAIL, A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
async function openPitch(page: Page, place: string) {
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("pitch-list").locator("tr", { hasText: place }).locator("[data-testid^='flag-'][data-flagged='1']").click();
  await expect(page.getByTestId(/^pitch-(page|body)$/)).toBeVisible();
}
type Sent = { subject: string; to: string[]; html?: string; body: string };

test("compose: contacts as chips, a template, an unknown address becomes a contact, bold, the Gmail signature, send", async ({ page, request }) => {
  await request.put(`${GMAIL}/settings/signature`, { data: { account: "rudy@example.com", signature: "<div>Rudy on the road crew</div>" } });
  await signInAs(page, "rudy");
  await openPitch(page, "Pine Hollow Lounge");
  const pitchUrl = page.url();
  const inboxAddr = `inbox-${Date.now()}@pinehollow.example`; // stamped: a retry finds it new, so the add-contact prompt shows again
  const inboxName = `Pine Hollow inbox ${Date.now()}`;
  const venueHref = A(`/booking/venues/${await page.getByTestId("venue-page").getAttribute("data-record-id")}`); // the venue's one page (#82)
  await page.getByTestId("email-new").click();
  await expect(page.getByTestId("compose-page")).toBeVisible();
  await expect(page.getByTestId("page-title")).toHaveText("New email");

  // Rosa is the venue's contact: pressed, and in To
  await expect(page.getByTestId("contact-pick-Rosa Jackson")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("to-chip-rosa@pinehollow.example")).toContainText("Rosa Jackson");
  // the chips show the address too, not just the name
  await expect(page.getByTestId("to-chip-rosa@pinehollow.example")).toContainText("<rosa@pinehollow.example>");
  await expect(page.getByTestId("contact-pick-email-Rosa Jackson")).toHaveText("rosa@pinehollow.example");
  // typing an address that's already there keeps it in the box with a note, until it's edited
  await page.getByTestId("to-input").fill("Rosa@PineHollow.example");
  await page.getByTestId("to-input").blur();
  await expect(page.getByTestId("to-error")).toHaveText("rosa@pinehollow.example is already added.");
  await expect(page.getByTestId("to-input")).toHaveValue("Rosa@PineHollow.example");
  await page.getByTestId("to-input").fill("");
  await expect(page.getByTestId("to-error")).toHaveCount(0);

  // a template fills subject and body; nothing is left to fill in
  await page.getByTestId("template").selectOption({ label: "First pitch" });
  await expect(page.getByTestId("email-subject")).toHaveValue("Pine Hollow Lounge · Nora Quill Band");
  await expect(page.getByTestId("email-body")).toContainText("Hi Rosa,");
  await expect(page.getByTestId("email-body")).toContainText("Live video: https://noraquill.example");
  await expect(page.getByTestId("template-fills")).toContainText("their first name");
  await expect(page.getByTestId("email-missing")).toHaveCount(0);
  await expect(page.getByTestId("signature-block")).toContainText("Rudy on the road crew");

  // an address that is nobody's contact yet offers to become one
  await page.getByTestId("to-input").fill(inboxAddr);
  await page.getByTestId("to-input").press("Enter");
  await expect(page.getByTestId(`to-chip-${inboxAddr}`)).toContainText(inboxAddr);
  await expect(page.getByTestId("add-contact-prompt")).toContainText(`${inboxAddr} isn't a contact yet`);
  await page.getByTestId("add-contact-open").click();
  await page.getByTestId("add-contact-name").fill(inboxName);
  await page.getByTestId("add-contact-role").selectOption("both");
  await page.getByTestId("add-contact-save").click();
  await expect(page.getByTestId("add-contact-prompt")).toHaveCount(0);
  await expect(page.getByTestId(`to-chip-${inboxAddr}`)).toHaveText(new RegExp(inboxName));
  await expect(page.getByTestId(`contact-pick-${inboxName}`)).toHaveAttribute("aria-pressed", "true");

  // bold the whole message with the toolbar
  const body = page.getByTestId("email-body");
  await body.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Bold" }).click();

  const subject = `Winter slot ${Date.now()}`;
  await page.getByTestId("email-subject").fill(subject);
  await page.getByTestId("email-send").click();
  // The thread page belongs to another story; the URL is what this one promises.
  await expect(page).toHaveURL(/\/booking\/email\/(?!new)[^/?]+$/);

  const msgs = (await (await request.get(`${GMAIL}/messages?account=rudy@example.com`)).json()) as Sent[];
  const mine = msgs.find((m) => m.subject === subject);
  expect(mine?.to.sort()).toEqual([inboxAddr, "rosa@pinehollow.example"]);
  expect(mine?.html).toMatch(/<(b|strong)>/);
  expect(mine?.html).toContain("Rudy on the road crew");
  expect(mine?.body).toContain("Hi Rosa,");

  // the thread is on the pitch; the new contact is on the venue's Contacts card, with its roles
  await page.goto(pitchUrl);
  await expect(page.getByTestId("pitch-email-card").getByTestId("email-threads")).toContainText(subject);
  await page.goto(venueHref!);
  const card = page.getByTestId("contacts-panel");
  await expect(card).toContainText(inboxName);
  await expect(card).toContainText(inboxAddr);
  // the Email button on a contact row opens a new email to that person, on the active pitch
  await page.getByTestId("contact-email-Rosa Jackson").click();
  await expect(page.getByTestId("compose-page")).toBeVisible();
  await expect(page).toHaveURL(/pitch=/);
  await expect(page.getByTestId("contact-pick-Rosa Jackson")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId(`contact-pick-${inboxName}`)).toHaveAttribute("aria-pressed", "false");
});

test("compose: a bare address stays bare on Not now, Move to Pitched, and Cancel throws the draft away", async ({ page, request }) => {
  await signInAs(page, "rudy");
  await openPitch(page, "Marisol");
  const pitchUrl = page.url();
  await page.getByTestId("email-new").click();
  await expect(page.getByTestId("compose-page")).toBeVisible();
  await expect(page.getByTestId("compose-contacts")).toHaveCount(0); // no contacts on this venue
  await expect(page.getByTestId("email-send")).toBeDisabled();

  // a half-written email survives a reload, and Cancel clears it
  await page.getByTestId("email-subject").fill("Half written");
  await page.getByTestId("to-input").fill("Talent@Marisol.example");
  await page.getByTestId("to-input").press(",");
  await expect(page.getByTestId("to-chip-talent@marisol.example")).toBeVisible();
  await expect(page.getByTestId("draft-note")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("email-subject")).toHaveValue("Half written");
  await expect(page.getByTestId("to-chip-talent@marisol.example")).toBeVisible();
  await page.getByTestId("email-cancel").click();
  await expect(page.getByTestId(/^pitch-(page|body)$/)).toBeVisible();
  await page.getByTestId("email-new").click();
  await expect(page.getByTestId("email-subject")).toHaveValue("");
  await expect(page.getByTestId("to-chip-talent@marisol.example")).toHaveCount(0);

  // a bad address is refused with a note; a good one gets the prompt; Not now keeps the bare address
  await page.getByTestId("to-input").fill("not an address");
  await page.getByTestId("to-input").press("Enter");
  await expect(page.getByTestId("to-error")).toBeVisible();
  await page.getByTestId("to-input").fill("talent@marisol.example");
  await page.getByTestId("to-input").press("Enter");
  await expect(page.getByTestId("to-error")).toHaveCount(0);
  await expect(page.getByTestId("add-contact-prompt")).toBeVisible();
  await page.getByTestId("add-contact-skip").click();
  await expect(page.getByTestId("add-contact-prompt")).toHaveCount(0);
  await expect(page.getByTestId("to-chip-talent@marisol.example")).toHaveText(/talent@marisol\.example/);

  // Cc is its own row; an unfilled {{field}} blocks Send
  await page.getByTestId("cc-toggle").click();
  await page.getByTestId("cc-input").fill("rudy@example.com");
  await page.getByTestId("cc-input").press("Enter");
  await expect(page.getByTestId("cc-chip-rudy@example.com")).toBeVisible();
  const subject = `Marisol ${Date.now()}`;
  await page.getByTestId("email-subject").fill(`${subject} {{venue.nickname}}`);
  await page.getByTestId("email-body").click();
  await page.keyboard.type("Hello from the band.");
  await expect(page.getByTestId("email-missing")).toContainText("{{venue.nickname}}");
  await expect(page.getByTestId("email-send")).toBeDisabled();
  await page.getByTestId("email-subject").fill(subject);
  await expect(page.getByTestId("email-missing")).toHaveCount(0);

  // Save draft in Gmail keeps it unsent
  await page.getByTestId("email-draft").click();
  await expect(page.getByTestId("email-drafted")).toBeVisible();
  const drafts = (await (await request.get(`${GMAIL}/drafts?account=rudy@example.com`)).json()) as { subject: string }[];
  expect(drafts.some((d) => d.subject === subject)).toBe(true);
  const before = (await (await request.get(`${GMAIL}/messages?account=rudy@example.com`)).json()) as Sent[];
  expect(before.some((m) => m.subject === subject)).toBe(false);

  // Already Pitched (a retry, or an earlier spec) hides the checkbox; otherwise it is on by default.
  if (await page.getByTestId("mark-pitched").count()) await expect(page.getByTestId("mark-pitched")).toBeChecked();
  await page.getByTestId("email-send").click();
  await expect(page).toHaveURL(/\/booking\/email\/(?!new)[^/?]+$/);
  await page.goto(pitchUrl);
  await expect(page.getByTestId("status")).toHaveValue("pitched");
  await expect(page.getByTestId("timeline").getByTestId("tl-emailSent")).toContainText(subject);
});

test("compose: ⌘/Ctrl+B, I, U and K format the message like Gmail", async ({ page }) => {
  await signInAs(page, "rudy");
  await openPitch(page, "Pine Hollow Lounge");
  await page.getByTestId("email-new").click();
  await expect(page.getByTestId("compose-page")).toBeVisible();
  const body = page.getByTestId("email-body");
  await body.click();
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type("loud");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type(" plain ");
  await page.keyboard.press("ControlOrMeta+i");
  await page.keyboard.type("lean");
  await page.keyboard.press("ControlOrMeta+i");
  await page.keyboard.type(" ");
  await page.keyboard.press("ControlOrMeta+u");
  await page.keyboard.type("under");
  await page.keyboard.press("ControlOrMeta+u");
  await page.keyboard.type(" see roadie");
  // select "roadie" and link it with ⌘K
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowLeft");
  page.once("dialog", (d) => d.accept("myroadie.online"));
  await page.keyboard.press("ControlOrMeta+k");
  await expect(body.locator("b, strong")).toHaveText("loud");
  await expect(body.locator("i, em")).toHaveText("lean");
  await expect(body.locator("u")).toHaveText("under");
  await expect(body.locator("a")).toHaveAttribute("href", "https://myroadie.online");
  await expect(body.locator("a")).toHaveText("roadie");
  await expect(page.getByRole("button", { name: "Insert link" })).toHaveAttribute("title", /Insert link \((⌘|Ctrl\+)K\)/);
});
