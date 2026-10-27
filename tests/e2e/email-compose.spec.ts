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
  await expect(page.getByTestId("pitch-page")).toBeVisible();
}
type Sent = { subject: string; to: string[]; html?: string; body: string };

test("compose: contacts as chips, a template, an unknown address becomes a contact, bold, the Gmail signature, send", async ({ page, request }) => {
  await request.put(`${GMAIL}/settings/signature`, { data: { account: "jeff@example.com", signature: "<div>Jeff on the road crew</div>" } });
  await signInAs(page, "jeff");
  await openPitch(page, "Lost Lake Lounge");
  const pitchUrl = page.url();
  const venueHref = await page.getByTestId("target-link").getAttribute("href");
  await page.getByTestId("email-new").click();
  await expect(page.getByTestId("compose-page")).toBeVisible();
  await expect(page.getByTestId("page-title")).toHaveText("New email");

  // Haylee is the venue's contact: pressed, and in To
  await expect(page.getByTestId("contact-pick-Haylee Jackson")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("to-chip-haylee@lostlake.example")).toContainText("Haylee Jackson");

  // a template fills subject and body; nothing is left to fill in
  await page.getByTestId("template").selectOption({ label: "First pitch" });
  await expect(page.getByTestId("email-subject")).toHaveValue("Lost Lake Lounge · Ingrid Avison Band");
  await expect(page.getByTestId("email-body")).toContainText("Hi Haylee,");
  await expect(page.getByTestId("email-body")).toContainText("Live video: https://ingridavison.example");
  await expect(page.getByTestId("template-fills")).toContainText("their first name");
  await expect(page.getByTestId("email-missing")).toHaveCount(0);
  await expect(page.getByTestId("signature-block")).toContainText("Jeff on the road crew");

  // an address that is nobody's contact yet offers to become one
  await page.getByTestId("to-input").fill("inbox@lostlake.example");
  await page.getByTestId("to-input").press("Enter");
  await expect(page.getByTestId("to-chip-inbox@lostlake.example")).toContainText("inbox@lostlake.example");
  await expect(page.getByTestId("add-contact-prompt")).toContainText("inbox@lostlake.example isn't a contact yet");
  await page.getByTestId("add-contact-open").click();
  await page.getByTestId("add-contact-name").fill("Lost Lake inbox");
  await page.getByTestId("add-contact-role").selectOption("both");
  await page.getByTestId("add-contact-save").click();
  await expect(page.getByTestId("add-contact-prompt")).toHaveCount(0);
  await expect(page.getByTestId("to-chip-inbox@lostlake.example")).toHaveText(/Lost Lake inbox/);
  await expect(page.getByTestId("contact-pick-Lost Lake inbox")).toHaveAttribute("aria-pressed", "true");

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

  const msgs = (await (await request.get(`${GMAIL}/messages?account=jeff@example.com`)).json()) as Sent[];
  const mine = msgs.find((m) => m.subject === subject);
  expect(mine?.to.sort()).toEqual(["haylee@lostlake.example", "inbox@lostlake.example"]);
  expect(mine?.html).toMatch(/<(b|strong)>/);
  expect(mine?.html).toContain("Jeff on the road crew");
  expect(mine?.body).toContain("Hi Haylee,");

  // the thread is on the pitch; the new contact is on the venue's Contacts card, with its roles
  await page.goto(pitchUrl);
  await expect(page.getByTestId("pitch-email-card").getByTestId("email-threads")).toContainText(subject);
  await page.goto(venueHref!);
  const card = page.getByTestId("contacts-panel");
  await expect(card).toContainText("Lost Lake inbox");
  await expect(card).toContainText("inbox@lostlake.example");
  // the Email button on a contact row opens a new email to that person, on the active pitch
  await page.getByTestId("contact-email-Haylee Jackson").click();
  await expect(page.getByTestId("compose-page")).toBeVisible();
  await expect(page).toHaveURL(/pitch=/);
  await expect(page.getByTestId("contact-pick-Haylee Jackson")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("contact-pick-Lost Lake inbox")).toHaveAttribute("aria-pressed", "false");
});

test("compose: a bare address stays bare on Not now, Move to Pitched, and Cancel throws the draft away", async ({ page, request }) => {
  await signInAs(page, "jeff");
  await openPitch(page, "Cervantes");
  const pitchUrl = page.url();
  await page.getByTestId("email-new").click();
  await expect(page.getByTestId("compose-page")).toBeVisible();
  await expect(page.getByTestId("compose-contacts")).toHaveCount(0); // no contacts on this venue
  await expect(page.getByTestId("email-send")).toBeDisabled();

  // a half-written email survives a reload, and Cancel clears it
  await page.getByTestId("email-subject").fill("Half written");
  await page.getByTestId("to-input").fill("Talent@Cervantes.example");
  await page.getByTestId("to-input").press(",");
  await expect(page.getByTestId("to-chip-talent@cervantes.example")).toBeVisible();
  await expect(page.getByTestId("draft-note")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("email-subject")).toHaveValue("Half written");
  await expect(page.getByTestId("to-chip-talent@cervantes.example")).toBeVisible();
  await page.getByTestId("email-cancel").click();
  await expect(page.getByTestId("pitch-page")).toBeVisible();
  await page.getByTestId("email-new").click();
  await expect(page.getByTestId("email-subject")).toHaveValue("");
  await expect(page.getByTestId("to-chip-talent@cervantes.example")).toHaveCount(0);

  // a bad address is refused with a note; a good one gets the prompt; Not now keeps the bare address
  await page.getByTestId("to-input").fill("not an address");
  await page.getByTestId("to-input").press("Enter");
  await expect(page.getByTestId("to-error")).toBeVisible();
  await page.getByTestId("to-input").fill("talent@cervantes.example");
  await page.getByTestId("to-input").press("Enter");
  await expect(page.getByTestId("to-error")).toHaveCount(0);
  await expect(page.getByTestId("add-contact-prompt")).toBeVisible();
  await page.getByTestId("add-contact-skip").click();
  await expect(page.getByTestId("add-contact-prompt")).toHaveCount(0);
  await expect(page.getByTestId("to-chip-talent@cervantes.example")).toHaveText(/talent@cervantes\.example/);

  // Cc is its own row; an unfilled {{field}} blocks Send
  await page.getByTestId("cc-toggle").click();
  await page.getByTestId("cc-input").fill("jeff@example.com");
  await page.getByTestId("cc-input").press("Enter");
  await expect(page.getByTestId("cc-chip-jeff@example.com")).toBeVisible();
  const subject = `Cervantes ${Date.now()}`;
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
  const drafts = (await (await request.get(`${GMAIL}/drafts?account=jeff@example.com`)).json()) as { subject: string }[];
  expect(drafts.some((d) => d.subject === subject)).toBe(true);
  const before = (await (await request.get(`${GMAIL}/messages?account=jeff@example.com`)).json()) as Sent[];
  expect(before.some((m) => m.subject === subject)).toBe(false);

  await expect(page.getByTestId("mark-pitched")).toBeChecked();
  await page.getByTestId("email-send").click();
  await expect(page).toHaveURL(/\/booking\/email\/(?!new)[^/?]+$/);
  await page.goto(pitchUrl);
  await expect(page.getByTestId("status")).toHaveValue("pitched");
  await expect(page.getByTestId("timeline").getByTestId("tl-emailSent")).toContainText(subject);
});
