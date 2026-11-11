import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

// The venue Events tab (#60). Bluebird Room's seeded calendar is an iCal feed answered from fixtures/calendars (never the network);
// Swallow Hill's is a manual note; two past Bluebird shows are seeded directly (no reader keeps past shows).

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

/** Booking -> search -> the venue's page (through the pitch page when the venue has a pitch), as an admin. */
async function openVenue(page: Page, search: string) {
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-venues").click();
  await page.getByTestId("booking-search").fill(search);
  await page.getByTestId(/^row-venue-/).filter({ hasText: search }).first().getByTestId(/^venue-full-/).click();
  await expect(page.getByTestId(/^(venue|pitch)-page$/)).toBeVisible();
  if (await page.getByTestId("pitch-page").count()) await page.getByTestId("target-link").click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
}
const shows = (page: Page) => page.getByTestId("venue-events-list").locator(":scope > div");

test.describe.configure({ mode: "serial" });
let bluebirdUrl = "";

test("an admin refreshes the Bluebird Room's calendar and sees the bills, the open slot, and the past shows folded away", async ({ page }) => {
  await signInAs(page, "rudy");
  await openVenue(page, "Bluebird Room");
  bluebirdUrl = new URL(page.url()).pathname;
  await expect(page.getByTestId("venue-tab-details")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("venue-tab-events").click();
  await expect(page).toHaveURL(/tab=events/);
  await expect(page.getByTestId("venue-calendar-type")).toHaveText("iCal feed");
  await expect(page.getByTestId("venue-calendar-health")).toContainText("Not refreshed yet");

  await page.getByTestId("venue-calendar-refresh").click();
  await expect(page.getByTestId("venue-calendar-health")).toContainText("found 3 shows");
  await expect(page.getByTestId("venue-calendar-error")).toHaveCount(0);
  await expect(shows(page)).toHaveCount(3);

  const withSupport = shows(page).filter({ hasText: "The Example Band" });
  await expect(withSupport.getByTestId("venue-event-acts")).toHaveText("The Example Band with Sample Support");
  await expect(withSupport.getByTestId("venue-event-open")).toHaveCount(0);
  await expect(shows(page).filter({ hasText: "Lone Example Act" }).getByTestId("venue-event-open")).toHaveCount(0);
  // "with special guests": the support is still to be announced
  const guests = shows(page).filter({ hasText: "Headline Example Trio" });
  await expect(guests.getByTestId("venue-event-acts")).toHaveText("Headline Example Trio");
  await expect(guests.getByTestId("venue-event-open")).toHaveText("Open slot?");
  await expect(page.getByTestId("venue-event-open")).toHaveCount(1);

  // past shows: a collapsed card, who played the room
  await expect(page.getByTestId("venue-events-past")).toContainText("Past shows (2)");
  await expect(page.getByTestId(/^venue-event-past-/).first()).toBeHidden();
  await page.getByTestId("venue-events-past-toggle").click();
  await expect(page.getByTestId(/^venue-event-past-/)).toHaveCount(2);
  await expect(page.getByTestId("venue-events-past")).toContainText("The Old Example Band, Former Support");
  await expect(page.getByTestId("venue-events-past")).toContainText("Retired Example Duo");

  // refreshing again changes nothing
  await page.getByTestId("venue-calendar-refresh").click();
  await expect(shows(page)).toHaveCount(3);
});

test("an admin's take on a show is saved and survives a reload", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(`${bluebirdUrl}?tab=events`);
  const row = shows(page).filter({ hasText: "Lone Example Act" });
  const take = row.locator('select[data-testid^="venue-event-take-"]');
  await expect(take).toHaveValue("");
  await take.selectOption("interested");
  await expect(take).toHaveValue("interested");
  await page.reload();
  await expect(shows(page).filter({ hasText: "Lone Example Act" }).locator('select[data-testid^="venue-event-take-"]')).toHaveValue("interested");
  // only that show got a take
  await expect(shows(page).filter({ hasText: "The Example Band" }).locator('select[data-testid^="venue-event-take-"]')).toHaveValue("");
});

test("a member sees the shows but cannot set a take or change the source", async ({ page }) => {
  await signInAs(page, "hugo");
  await page.goto(`${bluebirdUrl}?tab=events`);
  await expect(shows(page)).toHaveCount(3);
  await expect(shows(page).filter({ hasText: "Headline Example Trio" }).getByTestId("venue-event-open")).toBeVisible();
  await expect(page.getByText("Our take")).toHaveCount(0);
  await expect(page.locator('select[data-testid^="venue-event-take-"]')).toHaveCount(0);
  await expect(page.getByTestId("venue-calendar-setup")).toHaveCount(0);
  await expect(page.getByTestId("calendar-setup")).toHaveCount(0);
  // a member can refresh
  await expect(page.getByTestId("venue-calendar-refresh")).toBeVisible();
});

test("a venue whose calendar can't be read shows its note instead of a list", async ({ page }) => {
  await signInAs(page, "rudy");
  await openVenue(page, "Swallow Hill");
  await page.getByTestId("venue-tab-events").click();
  await expect(page.getByTestId("venue-calendar-manual")).toHaveText("Posts shows on Instagram only");
  await expect(page.getByTestId("venue-calendar-refresh")).toHaveCount(0);
  await expect(page.getByTestId("venue-events-upcoming")).toHaveCount(0);
});

test("an admin tries an iCal address in the setup dialog and sees what it would find", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(`${bluebirdUrl}?tab=events`);
  await page.getByTestId("venue-calendar-setup").click();
  await expect(page.getByTestId("calendar-setup")).toBeVisible();
  await page.getByTestId("calendar-type").selectOption("ics");
  await page.getByTestId("calendar-main").fill("https://calendar.example.com/shows.ics");
  await page.getByTestId("calendar-try").click();
  await expect(page.getByTestId("calendar-preview")).toContainText("3 shows found");
  await expect(page.getByTestId("calendar-preview")).toContainText("Sample Support (support)");
  await page.getByTestId("calendar-cancel").click();
  await expect(page.getByTestId("calendar-setup")).toBeHidden();
});
