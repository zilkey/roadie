import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

// Booking's Venue calendars tab: every venue's upcoming shows in one list. The shows come from the Bluebird Room's seeded iCal
// calendar (fixtures/calendars via VENUE_EVENTS_FIXTURES, three shows in 2031) once it is refreshed; its two seeded 2020 shows are
// past and never listed. playwright.config.ts pages the tab by 2 (NEXT_PUBLIC_VENUE_CALENDARS_PAGE), so the third show needs "Load more".
// venue-events.spec.ts sets a take on Lone Example Act and checks The Example Band has none, so this spec only touches the trio.

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

const shows = (page: Page) => page.getByTestId("venue-calendars").locator("tbody tr");

test.describe.configure({ mode: "serial" });

test("an admin browses every venue's upcoming shows, a page at a time, and opens a venue's Events tab", async ({ page }) => {
  await signInAs(page, "rudy");
  // Fill the Bluebird Room's shows: Booking -> Venues -> the venue (through its pitch) -> Events -> Refresh.
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-venues").click();
  await page.getByTestId("booking-search").fill("Bluebird Room");
  await page.getByTestId(/^row-venue-/).filter({ hasText: "Bluebird Room" }).first().getByTestId(/^venue-full-/).click();
  await expect(page.getByTestId(/^(venue|pitch)-page$/)).toBeVisible();
  if (await page.getByTestId("pitch-page").count()) await page.getByTestId("target-link").click();
  await page.getByTestId("venue-tab-events").click();
  await page.getByTestId("venue-calendar-refresh").click();
  await expect(page.getByTestId("venue-calendar-health")).toContainText("found 3 shows");
  const venuePath = new URL(page.url()).pathname;

  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-calendars").click();
  await expect(page).toHaveURL(/\/booking\/calendars$/);
  await expect(page.getByTestId("booking-seg-calendars")).toHaveAttribute("aria-selected", "true");

  // first page: the two soonest, in date order, with the bill, the time and the venue
  await expect(shows(page)).toHaveCount(2);
  await expect(shows(page).nth(0).getByTestId("venue-event-acts")).toHaveText("The Example Band with Sample Support");
  await expect(shows(page).nth(0).getByTestId("calendar-show-date")).toContainText("Fri, Mar 14");
  await expect(shows(page).nth(0).getByTestId("calendar-show-date")).toContainText("8 PM");
  await expect(shows(page).nth(0)).toContainText("Denver");
  await expect(shows(page).nth(1).getByTestId("venue-event-acts")).toHaveText("Lone Example Act");
  await expect(shows(page).nth(0).getByTestId("venue-event-chance")).toHaveCount(0);
  await expect(shows(page).nth(1).getByTestId("venue-event-chance")).toHaveText("Maybe");
  await expect(shows(page).nth(0).getByTestId("calendar-show-poster-noimage")).toBeVisible();
  // past shows are not upcoming
  await expect(page.getByTestId("venue-calendars")).not.toContainText("Retired Example Duo");

  // the next page
  await page.getByTestId("venue-calendars-more").click();
  await expect(shows(page)).toHaveCount(3);
  const trio = shows(page).nth(2);
  await expect(trio.getByTestId("venue-event-acts")).toHaveText("Headline Example Trio");
  await expect(trio.getByTestId("venue-event-chance")).toHaveText("Likely opener slot");
  await expect(trio.getByTestId("calendar-show-poster-image")).toHaveAttribute("src", "/icon-192.png");
  await expect(trio.getByTestId("calendar-show-poster-image")).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(page.getByTestId("opener-disclaimer")).toBeVisible();
  await expect(page.getByTestId("venue-calendars-more")).toHaveCount(0);

  // our take, set here, is the same take the venue's Events tab shows
  const take = trio.locator('select[data-testid^="venue-event-take-"]');
  await take.selectOption("pitched");
  await expect(take).toHaveValue("pitched");

  // the venue's name opens its Events tab
  await trio.getByTestId(/^calendar-show-venue-/).click();
  await expect(page).toHaveURL(new RegExp(`${venuePath}\\?tab=events$`));
  await expect(page.getByTestId("venue-tab-events")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("venue-events-list").locator(":scope > div").filter({ hasText: "Headline Example Trio" })
    .locator('select[data-testid^="venue-event-take-"]')).toHaveValue("pitched");
});

test("a search on the Venue calendars tab shows the search cards, and clearing it brings the shows back", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/booking/calendars"));
  await expect(shows(page).first()).toBeVisible();
  await page.getByTestId("booking-search").fill("Bluebird");
  await expect(page.getByTestId("search-buckets")).toBeVisible();
  await expect(page.getByTestId("venue-calendars")).toHaveCount(0);
  await page.getByTestId("search-clear").click();
  await expect(page).toHaveURL(/\/booking\/calendars$/);
  await expect(shows(page).first()).toBeVisible();
});

test("the filters narrow the shows and are remembered", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/booking/calendars"));
  await expect(shows(page)).toHaveCount(2);
  const row = (name: string) => shows(page).filter({ hasText: name });

  // Likely needs an opener: only the trio (support still to be announced); the list reads on past the first page to find it
  await page.getByTestId("calendar-filter-likely").click();
  await expect(page.getByTestId("calendar-filter-likely")).toHaveAttribute("aria-pressed", "true");
  await expect(shows(page)).toHaveCount(1);
  await expect(row("Headline Example Trio")).toHaveCount(1);
  // remembered after a reload
  await page.reload();
  await expect(page.getByTestId("calendar-filter-likely")).toHaveAttribute("aria-pressed", "true");
  await expect(shows(page)).toHaveCount(1);
  await page.getByTestId("calendar-filter-likely").click();

  // Hide "not a fit"
  await page.getByTestId("venue-calendars-more").click();
  await expect(shows(page)).toHaveCount(3);
  const take = row("Headline Example Trio").locator('select[data-testid^="venue-event-take-"]');
  const before = await take.inputValue();
  await take.selectOption("notFit");
  await page.getByTestId("calendar-filter-notfit").click();
  await expect(row("Headline Example Trio")).toHaveCount(0);
  await expect(row("Lone Example Act")).toHaveCount(1);
  await page.getByTestId("calendar-filter-notfit").click();
  await page.getByTestId("venue-calendars-more").click(); // a filter change starts over at the first page
  await row("Headline Example Trio").locator('select[data-testid^="venue-event-take-"]').selectOption(before);

  // region: the Bluebird Room is in Denver
  await page.getByTestId("calendar-filter-region").selectOption("boulder");
  await expect(page.getByTestId("venue-calendars-none")).toBeVisible();
  await page.getByTestId("calendar-filter-region").selectOption("denver");
  await expect(shows(page)).toHaveCount(2);

  // date range: up to the end of April 2031 leaves the March and April shows
  await page.getByTestId("calendar-filter-to").fill("2031-04-30");
  await expect(shows(page)).toHaveCount(2);
  await expect(row("Headline Example Trio")).toHaveCount(0);
  await page.getByTestId("calendar-filter-from").fill("2031-04-01");
  await expect(shows(page)).toHaveCount(1);
  await expect(row("Lone Example Act")).toHaveCount(1);

  await page.getByTestId("calendar-filter-clear").click();
  await expect(shows(page)).toHaveCount(2);
  await expect(page.getByTestId("calendar-filter-region")).toHaveValue("");
});
