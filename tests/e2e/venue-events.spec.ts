import { test, expect, type Locator, type Page } from "@playwright/test";
import { A, FIRESTORE } from "./env";

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
const DOCS = `http://${FIRESTORE}/v1/projects/demo-band-tracker/databases/(default)/documents`;
const OWNER = { authorization: "Bearer owner" };
const shows = (page: Page) => page.getByTestId("venue-events-list").locator(":scope > div");
/** A show's flag and X (data-take: "notFit" or ""). */
const takeIn = (row: Locator) => row.locator('[data-testid^="venue-event-take-"]');

/** Every show: the list starts on likely opener slots. */
const allShows = (page: Page) => page.getByTestId("venue-events-filter-show").selectOption("all");

test.describe.configure({ mode: "serial" });
let bluebirdUrl = "";

test("an admin refreshes the Bluebird Room's calendar and sees the bills, the opener guess, the posters, and the past shows folded away", async ({ page }) => {
  await signInAs(page, "rudy");
  await openVenue(page, "Bluebird Room");
  bluebirdUrl = new URL(page.url()).pathname;
  await expect(page.getByTestId("venue-tab-details")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("venue-tab-events").click();
  await expect(page).toHaveURL(/tab=events/);
  await expect(page.getByTestId("venue-calendar-type")).toHaveText("iCal feed");
  // venue-calendars.spec.ts may refresh the same calendar first in another worker of this shard
  await expect(page.getByTestId("venue-calendar-health")).toContainText(/Not refreshed yet|Refreshed/);

  await page.getByTestId("venue-calendar-refresh").click();
  await expect(page.getByTestId("venue-calendar-health")).toContainText("found 3 shows");
  await expect(page.getByTestId("venue-calendar-error")).toHaveCount(0);
  // the default: likely opener slots only
  await expect(page.getByTestId("venue-events-filter-show")).toHaveValue("likely");
  await expect(page.getByTestId("venue-events-filter-hide")).toBeChecked();
  await expect(page.getByTestId("venue-events-filter-when")).toHaveValue("any");
  await expect(shows(page)).toHaveCount(1);
  await expect(page.getByTestId("venue-events-upcoming")).toContainText("Upcoming shows (1 of 3)");
  await allShows(page);
  await expect(shows(page)).toHaveCount(3);
  // furthest out first
  await expect(shows(page).getByTestId("venue-event-acts")).toHaveText(["Headline Example Trio", "Lone Example Act", "The Example Band with Sample Support"]);
  // When: 6 months out or more still has them all (2031); the remembered filter survives a reload
  await page.getByTestId("venue-events-filter-when").selectOption("6m");
  await expect(shows(page)).toHaveCount(3);
  await page.reload();
  await expect(page.getByTestId("venue-events-filter-show")).toHaveValue("all");
  await expect(page.getByTestId("venue-events-filter-when")).toHaveValue("6m");
  await page.getByTestId("venue-events-filter-when").selectOption("any");

  // the opener guess (#76): support listed → no badge; one act on a title-only calendar → Maybe; support TBA → Likely
  const withSupport = shows(page).filter({ hasText: "The Example Band" });
  await expect(withSupport.getByTestId("venue-event-acts")).toHaveText("The Example Band with Sample Support");
  await expect(withSupport.getByTestId("venue-event-chance")).toHaveCount(0);
  await expect(shows(page).filter({ hasText: "Lone Example Act" }).getByTestId("venue-event-chance")).toHaveText("Maybe");
  // "with special guests": the support is still to be announced
  const guests = shows(page).filter({ hasText: "Headline Example Trio" });
  await expect(guests.getByTestId("venue-event-acts")).toHaveText("Headline Example Trio");
  await expect(guests.getByTestId("venue-event-chance")).toHaveText("Likely opener slot");
  await expect(guests.getByTestId("venue-event-chance")).toHaveAttribute("title", /Support still to be announced.*A guess from the listing, not perfect\./);
  await expect(page.getByTestId("opener-disclaimer")).toContainText("a guess from the listing, not perfect");
  // the room's record: two settled bills (the 2020 shows) are not enough to say
  await expect(page.getByTestId("venue-calendar-openers")).toHaveText("Books openers: not enough shows yet");
  // the poster from the feed, a plain square for the shows without one
  await expect(guests.getByTestId("venue-event-image")).toHaveAttribute("src", "/icon-192.png");
  await expect(withSupport.getByTestId("venue-event-noimage")).toBeVisible();

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

test("an admin marks a show Not a fit in one click; it's saved, and Hide \"not a fit\" drops it", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(`${bluebirdUrl}?tab=events`);
  await allShows(page);
  await page.getByTestId("venue-events-filter-hide").uncheck();
  const row = shows(page).filter({ hasText: "Lone Example Act" });
  const take = takeIn(row);
  await expect(take).toHaveAttribute("data-take", "");
  await row.getByTestId(/^venue-event-notfit-/).click(); // one click: the X
  await expect(take).toHaveAttribute("data-take", "notFit");
  await page.reload();
  await expect(takeIn(shows(page).filter({ hasText: "Lone Example Act" }))).toHaveAttribute("data-take", "notFit");
  // only that show got a take
  await expect(takeIn(shows(page).filter({ hasText: "The Example Band" }))).toHaveAttribute("data-take", "");

  // Hide "not a fit" drops it; off brings it back
  await page.getByTestId("venue-events-filter-hide").check();
  await expect(shows(page).filter({ hasText: "Lone Example Act" })).toHaveCount(0);
  await expect(shows(page)).toHaveCount(2);
  await page.getByTestId("venue-events-filter-hide").uncheck();
  await expect(shows(page)).toHaveCount(3);
  // the X again clears it
  await shows(page).filter({ hasText: "Lone Example Act" }).getByTestId(/^venue-event-notfit-/).click();
  await expect(takeIn(shows(page).filter({ hasText: "Lone Example Act" }))).toHaveAttribute("data-take", "");
  await page.getByTestId("venue-events-filter-hide").check();
  await expect(shows(page)).toHaveCount(3);
});

test("the genre filter keeps the shows whose main act plays a picked genre", async ({ page, request }) => {
  await signInAs(page, "rudy");
  await page.goto(`${bluebirdUrl}?tab=events`);
  await allShows(page);
  // give the trio's act a genre (straight into the emulator: an act's About card has no genre field until something's known)
  const href = await shows(page).filter({ hasText: "Headline Example Trio" }).getByTestId(/^act-name-/).first().getAttribute("href");
  const actDoc = `${DOCS}/acts/${href!.split("/").pop()}?updateMask.fieldPaths=genres`;
  const setGenres = (genres?: string[]) => request.patch(actDoc, { headers: OWNER, data: { fields: genres ? { genres: { arrayValue: { values: genres.map((g) => ({ stringValue: g })) } } } : {} } });
  expect((await setGenres(["e2e indie folk"])).ok()).toBeTruthy();
  try {
    await page.getByTestId("venue-events-filter-genre").click();
    await page.getByTestId("venue-events-filter-genre-e2e indie folk").check();
    await expect(page.getByTestId("venue-events-filter-genre")).toHaveText("e2e indie folk");
    await expect(shows(page)).toHaveCount(1);
    await expect(shows(page).getByTestId("venue-event-acts")).toHaveText("Headline Example Trio");
    await expect(page.getByTestId("venue-events-upcoming")).toContainText("Upcoming shows (1 of 3)");
    await page.getByTestId("venue-events-filter-genre-clear").click();
    await expect(shows(page)).toHaveCount(3);
  } finally {
    await setGenres(); // put the act back as it was
  }
});

test("a member sees the shows but cannot set a take or change the source", async ({ page }) => {
  await signInAs(page, "hugo");
  await page.goto(`${bluebirdUrl}?tab=events`);
  await expect(page.getByTestId("venue-events-filter-hide")).toHaveCount(0); // members have no takes to hide by
  await allShows(page);
  await expect(shows(page)).toHaveCount(3);
  await expect(shows(page).filter({ hasText: "Headline Example Trio" }).getByTestId("venue-event-chance")).toBeVisible();
  await expect(page.getByText("Our take")).toHaveCount(0);
  await expect(page.locator('[data-testid^="venue-event-take-"]')).toHaveCount(0);
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
