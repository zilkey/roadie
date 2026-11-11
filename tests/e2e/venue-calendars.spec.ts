import { test, expect, type Locator, type Page } from "@playwright/test";
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
/** A show's flag and X (data-pitched: on the venue's pitch; data-take: "notFit" or ""). */
const takeIn = (row: Locator) => row.locator('[data-testid^="venue-event-take-"]');
/** Mark a show Not a fit, or clear it, with its X. */
async function setNotFit(row: Locator, on: boolean) {
  if ((await takeIn(row).getAttribute("data-take") === "notFit") !== on) await row.getByTestId(/^venue-event-notfit-/).click();
  await expect(takeIn(row)).toHaveAttribute("data-take", on ? "notFit" : "");
}

/** The fixture shows are not all likely opener slots: list every show (the default is likely ones only). */
async function everyShow(page: Page) {
  await page.getByTestId("calendar-filter-show").selectOption("all");
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

  // first page: the two furthest out, latest first, with the bill, the time and the venue
  await expect(shows(page)).toHaveCount(2);
  const trio = shows(page).nth(0);
  await expect(trio.getByTestId("venue-event-acts")).toHaveText("Headline Example Trio");
  await expect(shows(page).nth(1).getByTestId("venue-event-acts")).toHaveText("Lone Example Act");
  await expect(shows(page).nth(1).getByTestId("venue-event-chance")).toHaveText("Maybe");
  // past shows are not upcoming
  await expect(page.getByTestId("venue-calendars")).not.toContainText("Retired Example Duo");

  // the next page: the soonest
  await page.getByTestId("venue-calendars-more").click();
  await expect(shows(page)).toHaveCount(3);
  const soonest = shows(page).nth(2);
  await expect(soonest.getByTestId("venue-event-acts")).toHaveText("The Example Band with Sample Support");
  await expect(soonest.getByTestId("calendar-show-date")).toContainText("Fri, Mar 14");
  await expect(soonest.getByTestId("calendar-show-date")).toContainText("8 PM");
  await expect(soonest).toContainText("Denver");
  await expect(soonest.getByTestId("venue-event-chance")).toHaveCount(0);
  await expect(soonest.getByTestId("calendar-show-poster-noimage")).toBeVisible();
  await expect(trio.getByTestId("venue-event-acts")).toHaveText("Headline Example Trio");
  await expect(trio.getByTestId("venue-event-chance")).toHaveText("Likely opener slot");
  await expect(trio.getByTestId("calendar-show-poster-image")).toHaveAttribute("src", "/icon-192.png");
  await expect(trio.getByTestId("calendar-show-poster-image")).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(page.getByTestId("opener-disclaimer")).toBeVisible();
  await expect(page.getByTestId("venue-calendars-more")).toHaveCount(0);

  // the pitch flag (hollow until the show is on the venue's pitch) and Not a fit sit first on the row
  await expect(trio.getByTestId(/^pitch-this-/)).toHaveAttribute("aria-label", /Pitch this|On the Pitch List/);
  await expect(trio.getByTestId(/^venue-event-notfit-/)).toHaveAttribute("aria-pressed", "false");

  // the venue's name opens its Events tab, with the same flag on the show
  await trio.getByTestId(/^calendar-show-venue-/).click();
  await expect(page).toHaveURL(new RegExp(`${venuePath}\\?tab=events$`));
  await expect(page.getByTestId("venue-tab-events")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("venue-events-list").getByTestId(/^pitch-this-/).first()).toBeVisible();
});

test("Pitch this: one click adds the show to the venue's pitch; the filled flag asks to take the show off the pitch or the venue off the Pitch List", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/booking/calendars"));
  await everyShow(page);
  const trio = shows(page).filter({ hasText: "Headline Example Trio" });
  const take = takeIn(trio), flag = trio.getByTestId(/^pitch-this-/);
  // nothing is "new" on a viewer's first look
  await expect(page.getByTestId("venue-event-new")).toHaveCount(0);
  // start off the pitch (a retry may find it on)
  if (await take.getAttribute("data-pitched") === "1") { await flag.click(); await page.getByTestId("unpitch-show").click(); }
  await expect(take).toHaveAttribute("data-pitched", "0");
  await expect(flag).toHaveAttribute("data-flagged", "0");

  // one click: on the Bluebird Room's pitch (the seeded one), filled
  await flag.click();
  await expect(take).toHaveAttribute("data-pitched", "1");
  await expect(flag).toHaveAttribute("data-flagged", "1");
  await expect(page.getByTestId("unpitch-dialog")).toBeHidden();

  // the filled flag asks; Keep it changes nothing
  await flag.click();
  const dlg = page.getByTestId("unpitch-dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId("unpitch-venue")).toHaveText("Remove Bluebird Room from the Pitch List");
  await expect(dlg.getByTestId("unpitch-show")).toHaveText("Remove this show from the pitch");
  await dlg.getByTestId("unpitch-cancel").click();
  await expect(dlg).toBeHidden();
  await expect(take).toHaveAttribute("data-pitched", "1");

  // the pitch has the show's date and a note on its timeline
  await flag.click();
  await dlg.getByTestId("unpitch-open").click();
  await expect(page).toHaveURL(/\/booking\/pitches\/[^/]+$/);
  await expect(page.getByText("Added Headline Example Trio on Fri, May 9 (from the venue's calendar)")).toBeVisible();
  await page.goBack();
  await everyShow(page);

  // Remove this show from the pitch: hollow again; the venue stays on the Pitch List
  await flag.click();
  await dlg.getByTestId("unpitch-show").click();
  await expect(dlg).toBeHidden();
  await expect(take).toHaveAttribute("data-pitched", "0");
  await expect(flag).toHaveAttribute("data-flagged", "0");
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
  await expect(page).toHaveURL(/\/booking\/calendars\?show=all$/); // the filters outlast the search
  await expect(page.getByTestId("calendar-filter-show")).toHaveValue("all");
  await expect(shows(page).first()).toBeVisible();
});

test("the filters add up, read on past hidden shows and are remembered", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/booking/calendars"));
  const row = (name: string) => shows(page).filter({ hasText: name });

  // the default: likely opener slots, "not a fit" hidden, any genre, anywhere, all times; only the trio (support still to be announced)
  await expect(page.getByTestId("calendar-filter-show")).toHaveValue("likely");
  await expect(page.getByTestId("calendar-filter-hide")).toBeChecked();
  await expect(page.getByTestId("calendar-filter-genre")).toHaveText("Any genre");
  await expect(page.getByTestId("calendar-filter-region")).toHaveValue("");
  await expect(page.getByTestId("calendar-filter-when")).toHaveValue("any");
  await expect(page.getByTestId("opener-disclaimer")).toHaveText("Opener chance is a guess from the listing, not perfect. Hover a badge for why.");
  await expect(shows(page)).toHaveCount(1);
  await expect(row("Headline Example Trio")).toHaveCount(1);

  // All shows: in the URL, so it lasts a reload
  await page.getByTestId("calendar-filter-show").selectOption("all");
  await expect(shows(page)).toHaveCount(2);
  await expect(page).toHaveURL(/\/booking\/calendars\?show=all$/);
  await page.reload();
  await expect(page.getByTestId("calendar-filter-show")).toHaveValue("all");
  await expect(shows(page)).toHaveCount(2);

  // Hide "not a fit": with the two furthest out marked not a fit, only the soonest is left, a page further on. The list reads on
  // to find it in one settled render: no "no match" note or half-filled table on the way (each bigger read's first snapshot comes
  // from the cache with only the last read's shows, which once read as the end and flashed the note once a round)
  await page.getByTestId("calendar-filter-hide").uncheck();
  await setNotFit(row("Headline Example Trio"), true);
  await setNotFit(row("Lone Example Act"), true);
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="venue-calendars"]')!;
    const seen: string[] = [];
    (window as unknown as { __seen: string[] }).__seen = seen;
    new MutationObserver(() => {
      const s = root.querySelector('[data-testid="venue-calendars-none"]') ? "none" : root.querySelector("table") ? `table:${root.querySelectorAll("tbody tr").length}` : "loading";
      if (seen.at(-1) !== s) seen.push(s);
    }).observe(root, { subtree: true, childList: true });
  });
  await page.getByTestId("calendar-filter-hide").check();
  await expect(shows(page)).toHaveCount(1);
  await expect(row("The Example Band")).toHaveCount(1);
  const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  expect(seen.filter((s) => s !== "loading")).toEqual(["table:1"]);
  // and they add up: likely and not hidden leaves nothing (the trio is the only likely one)
  await page.getByTestId("calendar-filter-show").selectOption("likely");
  await expect(page.getByTestId("venue-calendars-none")).toBeVisible();
  await page.getByTestId("calendar-filter-show").selectOption("all");
  await page.getByTestId("calendar-filter-hide").uncheck();
  await page.getByTestId("venue-calendars-more").click();
  await setNotFit(row("Headline Example Trio"), false); // the X again clears it
  await setNotFit(row("Lone Example Act"), false);
  await page.getByTestId("calendar-filter-hide").check();

  // region: the Bluebird Room is in Denver
  await page.getByTestId("calendar-filter-region").selectOption("boulder");
  await expect(page.getByTestId("venue-calendars-none")).toBeVisible();
  await page.getByTestId("calendar-filter-region").selectOption("denver");
  await expect(shows(page)).toHaveCount(2);

  // When: the shows are in 2031, so 6 months out or more keeps them all
  await page.getByTestId("calendar-filter-when").selectOption("6m");
  await expect(shows(page)).toHaveCount(2);
  await page.getByTestId("venue-calendars-more").click();
  await expect(shows(page)).toHaveCount(3);
  await page.getByTestId("calendar-filter-when").selectOption("any");
  await expect(shows(page)).toHaveCount(2);

  // a link sends the exact list; back to the defaults leaves the URL bare
  await page.goto(A("/booking/calendars?show=all&notfit=show&region=boulder&when=6m"));
  await expect(page.getByTestId("calendar-filter-show")).toHaveValue("all");
  await expect(page.getByTestId("calendar-filter-hide")).not.toBeChecked();
  await expect(page.getByTestId("calendar-filter-region")).toHaveValue("boulder");
  await expect(page.getByTestId("calendar-filter-when")).toHaveValue("6m");
  await expect(page.getByTestId("venue-calendars-none")).toBeVisible();
  await page.getByTestId("calendar-filter-show").selectOption("likely");
  await page.getByTestId("calendar-filter-hide").check();
  await page.getByTestId("calendar-filter-region").selectOption("");
  await page.getByTestId("calendar-filter-when").selectOption("any");
  await expect(page).toHaveURL(/\/booking\/calendars$/);
});
