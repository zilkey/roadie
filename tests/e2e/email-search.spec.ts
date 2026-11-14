import { test, expect, type Page } from "@playwright/test";
import { GMAIL, A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

test("Search Gmail: link the web form's auto-reply to the venue, find Rosa and the booking inbox in People", async ({ page, request }) => {
  const stamp = Date.now();
  const autoSubject = `Your submission to Pine Hollow Lounge ${stamp}`;
  const receive = async (data: Record<string, unknown>) => (await (await request.post(`${GMAIL}/messages/receive`, { data })).json()) as { threadId: string };
  const auto = await receive({ from: "booking@pinehollow.example", to: ["rudy@example.com"], subject: autoSubject, body: "We got your application." });
  const hay = await receive({ from: "rosa@pinehollow.example", fromName: "Rosa Jackson", to: ["rudy@example.com"], subject: `Support slot ${stamp}`, body: "Dec 11 works.\n\nRosa Jackson\nTalent buyer, Pine Hollow Lounge\n(303) 555-0101" });

  // Linking a thread makes each person on it a contact of the place, so the address this test adds is one that is never linked, and stamped so a retry finds it new.
  const added = `bookings-${stamp}@pinehollow.example`;
  await receive({ from: added, to: ["rudy@example.com"], subject: `Booking inbox ${stamp}`, body: "Send your dates." });

  await signInAs(page, "rudy");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Pine Hollow Lounge" }).locator("[data-testid^='flag-'][data-flagged='1']").click();
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
  await page.getByTestId("crumb-3").click();
  await expect(page.getByTestId("pitch-email-card").getByTestId("email-threads")).toContainText(autoSubject);

  // People tab
  await page.getByTestId("search-gmail").click();
  await page.getByTestId("gmail-tabs-people").click();
  await expect(page.getByTestId("gmail-people-q")).toHaveValue("pinehollow.example");
  const people = page.getByTestId("gmail-people");
  await expect(people.getByTestId("gmail-person-rosa@pinehollow.example")).toContainText("Talent buyer, Pine Hollow Lounge");
  await expect(people.getByTestId("gmail-known-rosa@pinehollow.example")).toHaveText("Already a contact");
  await expect(page.getByTestId(`gmail-add-${added}`)).toBeVisible();
  await page.getByTestId(`gmail-add-${added}`).click();
  await expect(page.getByTestId(`gmail-known-${added}`)).toHaveText("Added · Booking");

  // the venue's Contacts card lists the new address
  await page.goto(A("/booking/venues"));
  await page.getByTestId(/^row-venue-/).filter({ hasText: "Pine Hollow Lounge" }).getByTestId(/^page-link-/).click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
  await expect(page.getByTestId("contacts-panel")).toContainText(added);
});
