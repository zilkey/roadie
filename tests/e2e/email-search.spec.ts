import { test, expect, type Page } from "@playwright/test";
import { GMAIL, A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

test("Search Gmail: link the web form's auto-reply to the venue, find Haylee and the booking inbox in People", async ({ page, request }) => {
  const stamp = Date.now();
  const autoSubject = `Your submission to Lost Lake Lounge ${stamp}`;
  const receive = async (data: Record<string, unknown>) => (await (await request.post(`${GMAIL}/messages/receive`, { data })).json()) as { threadId: string };
  const auto = await receive({ from: "booking@lostlake.example", to: ["jeff@example.com"], subject: autoSubject, body: "We got your application." });
  const hay = await receive({ from: "haylee@lostlake.example", fromName: "Haylee Jackson", to: ["jeff@example.com"], subject: `Support slot ${stamp}`, body: "Dec 11 works.\n\nHaylee Jackson\nTalent buyer, Lost Lake Lounge\n(303) 555-0101" });

  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Lost Lake Lounge" }).locator("[data-testid^='flag-'][data-flagged='1']").click();
  await page.getByTestId("search-gmail").click();

  // Threads tab: both are listed; link the auto-reply
  await expect(page.getByTestId("gmail-tabs")).toBeVisible();
  const results = page.getByTestId("gmail-results");
  await expect(results.getByTestId(`gmail-thread-${auto.threadId}`)).toContainText(autoSubject);
  await expect(results.getByTestId(`gmail-thread-${hay.threadId}`)).toContainText("Dec 11 works.");
  await expect(page.getByTestId(`gmail-linked-${auto.threadId}`)).toHaveCount(0);
  await page.getByTestId(`gmail-link-${auto.threadId}`).click();
  await expect(page.getByTestId(`gmail-linked-${auto.threadId}`)).toHaveText("On this venue");
  await expect(page.getByTestId(`gmail-open-${auto.threadId}`)).toBeVisible();

  // the pitch's Email card has it
  await page.getByTestId("back").click();
  await expect(page.getByTestId("pitch-email-card").getByTestId("email-threads")).toContainText(autoSubject);

  // People tab
  await page.getByTestId("search-gmail").click();
  await page.getByTestId("gmail-tabs-people").click();
  await expect(page.getByTestId("gmail-people-q")).toHaveValue("lostlake.example");
  const people = page.getByTestId("gmail-people");
  await expect(people.getByTestId("gmail-person-haylee@lostlake.example")).toContainText("Talent buyer, Lost Lake Lounge");
  await expect(people.getByTestId("gmail-known-haylee@lostlake.example")).toHaveText("Already a contact");
  await expect(page.getByTestId("gmail-add-booking@lostlake.example")).toBeVisible();
  await page.getByTestId("gmail-add-booking@lostlake.example").click();
  await expect(page.getByTestId("gmail-known-booking@lostlake.example")).toHaveText("Added · Booking");

  // the venue's Contacts card lists the new address
  await page.goto(A("/booking/venues"));
  await page.getByTestId(/^row-venue-/).filter({ hasText: "Lost Lake Lounge" }).getByTestId(/^page-link-/).click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
  await expect(page.getByTestId("contacts-panel")).toContainText("booking@lostlake.example");
});

test("Reply from Roadie links the thread and opens it", async ({ page, request }) => {
  const stamp = Date.now();
  const hay = (await (await request.post(`${GMAIL}/messages/receive`, { data: { from: "haylee@lostlake.example", fromName: "Haylee Jackson", to: ["jeff@example.com"], subject: `Dates ${stamp}`, body: "Which dates?" } })).json()) as { threadId: string };
  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Lost Lake Lounge" }).locator("[data-testid^='flag-'][data-flagged='1']").click();
  await page.getByTestId("search-gmail").click();
  await page.getByTestId(`gmail-reply-${hay.threadId}`).click();
  // the thread page is another story; the link was made and we went to /booking/email/<id>
  await expect(page).toHaveURL(/\/booking\/email\/[^/?]+$/);
});
