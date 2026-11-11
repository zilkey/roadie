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
/** The fixture shows are years out and not all likely opener slots: list every show, any time (the default is likely, next 3 months). */
async function everyShow(page: Page) {
  await page.getByTestId("calendar-filter-all").click();
  await page.getByTestId("calendar-filter-when").selectOption("any");
}

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
  await everyShow(page);

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

test("Pitch this on a show starts the venue's pitch with the show's date, marks it Pitched and goes on to the headliner's act page", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/booking/calendars"));
  await everyShow(page);
  await page.getByTestId("venue-calendars-more").click();
  const trio = shows(page).filter({ hasText: "Headline Example Trio" });
  // nothing is "new" on a viewer's first look
  await expect(page.getByTestId("venue-event-new")).toHaveCount(0);
  // the first test pitched the trio by hand: clear it so Pitch this shows
  const take = trio.locator('select[data-testid^="venue-event-take-"]');
  await take.selectOption("");
  await expect(take).toHaveValue("");
  await trio.getByTestId(/^pitch-this-/).click();

  const form = page.getByTestId("pitch-show-form");
  await expect(form.getByRole("heading")).toHaveText(/^Pitch Bluebird Room for \w{3}, \w{3} \d+$/);
  await expect(page.getByTestId("pitch-show-show")).toContainText("Headline Example Trio");
  await expect(page.getByTestId("pitch-show-ask").locator("option")).toHaveText(["Open for Headline Example Trio", "Play another night"]);
  await expect(page.getByTestId("pitch-show-reach")).toBeChecked();
  // another night: nothing to tell the headliner, so no checkbox
  await page.getByTestId("pitch-show-ask").selectOption("another");
  await expect(page.getByTestId("pitch-show-reach")).toHaveCount(0);
  await page.getByTestId("pitch-show-ask").selectOption("open");
  // Cancel closes without pitching
  await page.getByTestId("pitch-show-cancel").click();
  await expect(form).toHaveCount(0);
  await expect(take).toHaveValue("");

  await trio.getByTestId(/^pitch-this-/).click();
  await page.getByTestId("pitch-show-start").click();
  await expect(page).toHaveURL(/\/booking\/acts\/[^/]+$/);
  await expect(page.getByTestId("act-page")).toContainText("Headline Example Trio");
  await expect(page.getByTestId("act-pitch")).toBeVisible();

  // back on the list: Pitched, and no Pitch this
  await page.goBack();
  await page.getByTestId("venue-calendars-more").click();
  await expect(take).toHaveValue("pitched");
  await expect(trio.getByTestId(/^pitch-this-/)).toHaveCount(0);
});

test("a search on the Venue calendars tab shows the search cards, and clearing it brings the shows back", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/booking/calendars"));
  await everyShow(page);
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
  const row = (name: string) => shows(page).filter({ hasText: name });
  const pill = (k: string) => page.getByTestId(`calendar-filter-${k}`);

  // the default: likely opener slots in the next 3 months, anywhere; the 2031 fixture shows are further out
  await expect(pill("likely")).toHaveAttribute("aria-pressed", "true");
  await expect(pill("hide")).toHaveAttribute("aria-pressed", "false");
  await expect(pill("all")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("calendar-filter-region")).toHaveValue("");
  await expect(page.getByTestId("calendar-filter-when")).toHaveValue("3m");
  await expect(page.getByTestId("opener-disclaimer")).toHaveText("Opener chance is a guess from the listing, not perfect. Hover a badge for why.");
  await expect(page.getByTestId("venue-calendars-none")).toBeVisible();

  // Any time: only the trio (support still to be announced) is a likely slot; the list reads on past the first page to find it,
  // in one settled render: no "no match" note or half-filled table on the way (each bigger read's first snapshot comes from the
  // cache with only the last read's shows, which once read as the end and flashed the note once a round)
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="venue-calendars"]')!;
    const seen: string[] = [];
    (window as unknown as { __seen: string[] }).__seen = seen;
    new MutationObserver(() => {
      const s = root.querySelector('[data-testid="venue-calendars-none"]') ? "none" : root.querySelector("table") ? `table:${root.querySelectorAll("tbody tr").length}` : "loading";
      if (seen.at(-1) !== s) seen.push(s);
    }).observe(root, { subtree: true, childList: true });
  });
  await page.getByTestId("calendar-filter-when").selectOption("any");
  await expect(shows(page)).toHaveCount(1);
  await expect(row("Headline Example Trio")).toHaveCount(1);
  const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  expect(seen.filter((s) => s !== "loading")).toEqual(["table:1"]);
  // remembered after a reload
  await page.reload();
  await expect(page.getByTestId("calendar-filter-when")).toHaveValue("any");
  await expect(pill("likely")).toHaveAttribute("aria-pressed", "true");
  await expect(shows(page)).toHaveCount(1);

  // the pills are one at a time: All shows turns Likely off
  await pill("all").click();
  await expect(pill("all")).toHaveAttribute("aria-pressed", "true");
  await expect(pill("likely")).toHaveAttribute("aria-pressed", "false");
  await expect(shows(page)).toHaveCount(2);

  // Hide "not a fit"
  await page.getByTestId("venue-calendars-more").click();
  await expect(shows(page)).toHaveCount(3);
  const take = row("Headline Example Trio").locator('select[data-testid^="venue-event-take-"]');
  const before = await take.inputValue();
  await take.selectOption("notFit");
  await pill("hide").click();
  await expect(pill("all")).toHaveAttribute("aria-pressed", "false");
  await expect(row("Headline Example Trio")).toHaveCount(0);
  await expect(row("Lone Example Act")).toHaveCount(1);
  await pill("all").click();
  await page.getByTestId("venue-calendars-more").click(); // a filter change starts over at the first page
  await row("Headline Example Trio").locator('select[data-testid^="venue-event-take-"]').selectOption(before);

  // region: the Bluebird Room is in Denver
  await page.getByTestId("calendar-filter-region").selectOption("boulder");
  await expect(page.getByTestId("venue-calendars-none")).toBeVisible();
  await page.getByTestId("calendar-filter-region").selectOption("denver");
  await expect(shows(page)).toHaveCount(2);

  // When: next month leaves nothing (the shows are in 2031)
  await page.getByTestId("calendar-filter-when").selectOption("1m");
  await expect(page.getByTestId("venue-calendars-none")).toBeVisible();
  await page.getByTestId("calendar-filter-when").selectOption("any");
  await expect(shows(page)).toHaveCount(2);
});
