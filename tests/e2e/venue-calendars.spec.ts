import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { A, APP, AUTH, FIRESTORE, ARTIST_SLUG } from "./env";

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

  // Back comes back to the list as it was: the filter (in the URL), both pages and the scroll. A short window so it scrolls.
  await page.goBack();
  await page.setViewportSize({ width: 1280, height: 360 });
  await expect(shows(page)).toHaveCount(3);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(100);
  await shows(page).nth(2).getByTestId(/^calendar-show-venue-/).click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
  await page.getByTestId("back").click();
  await expect(page).toHaveURL(/\/booking\/calendars\?show=all$/);
  await expect(shows(page)).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y);
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

/** Set an act's links through the app's own command (an act with nothing known yet has no link editor on its page, only Look up). */
async function setActLinks(request: APIRequestContext, actId: string, links: Record<string, string>) {
  const auth = await request.post(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo`, {
    data: {
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: "dev-rudy", email: "rudy@example.com", email_verified: true, name: "Rudy" }))}&providerId=google.com`,
      requestUri: "http://localhost", returnIdpSignInMethod: true, returnSecureToken: true,
    },
  });
  const token = ((await auth.json()) as { idToken: string }).idToken;
  const artists = await request.get(`http://${FIRESTORE}/v1/projects/demo-band-tracker/databases/(default)/documents/artists`, { headers: { authorization: "Bearer owner" } });
  const docs = ((await artists.json()) as { documents: { name: string; fields: { slug?: { stringValue: string } } }[] }).documents;
  const artistId = docs.find((d) => d.fields.slug?.stringValue === ARTIST_SLUG)!.name.split("/").pop()!;
  const res = await request.post(`${APP}/api/commands/acts.update`, { data: { id: actId, patch: { links } }, headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test("the act cell lists the act's links, each in a new tab; the city sits under the venue", async ({ page, request }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/booking/calendars"));
  await everyShow(page);
  const trio = shows(page).filter({ hasText: "Headline Example Trio" });
  // the city is under the venue's name; there is no City column
  await expect(trio.getByTestId(/^calendar-show-city-/)).toHaveText("Denver");
  await expect(page.getByRole("columnheader", { name: "City" })).toHaveCount(0);

  // the trio's act gets a website and an Instagram: they show up live, under the ticket link
  const actId = (await trio.getByTestId(/^act-name-/).first().getAttribute("data-testid"))!.replace(/^act-name-/, "");
  await setActLinks(request, actId, { instagram: "https://instagram.com/exampletrio", website: "https://trio.example.com/" });
  const site = trio.getByTestId(`calendar-act-link-${actId}-website`), ig = trio.getByTestId(`calendar-act-link-${actId}-instagram`);
  await expect(site).toHaveText("Website ↗");
  await expect(site).toHaveAttribute("href", "https://trio.example.com/");
  await expect(ig).toHaveText("Instagram ↗");
  await expect(ig).toHaveAttribute("href", "https://instagram.com/exampletrio");
  for (const a of [site, ig, trio.getByRole("link", { name: /Tickets and details/ })]) {
    await expect(a).toHaveAttribute("target", "_blank");
    await expect(a).toHaveAttribute("rel", "noopener noreferrer");
  }
});

test("Notes: click to edit in place without moving the row; the box grows as she types; Enter saves to one line with an ellipsis", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/booking/calendars"));
  await everyShow(page);
  const trio = shows(page).filter({ hasText: "Headline Example Trio" });
  const cell = trio.locator('[data-testid^="calendar-show-note-"]');
  const button = cell.getByRole("button");
  // start empty (a retry may find the earlier attempt's note)
  if (!/Add a note/.test(await button.textContent() ?? "")) {
    await button.click();
    await cell.locator("textarea").fill("");
    await cell.locator("textarea").press("Enter");
  }
  await expect(button).toContainText("Add a note");

  // the layout, not the viewport: focusing the box may scroll the table's own scroller to show it
  const layout = () => cell.evaluate((el) => {
    const td = el.closest("td")!, tr = td.parentElement as HTMLTableRowElement, table = td.closest("table")!;
    return { td: [td.offsetLeft, td.offsetTop, td.offsetWidth, td.offsetHeight], row: [tr.offsetTop, tr.offsetHeight], table: [table.offsetWidth, table.offsetHeight] };
  });
  // the page settles first (the rows grow while the listing's data comes in)
  let before = await layout();
  await expect.poll(async () => { const now = await layout(); const same = JSON.stringify(now) === JSON.stringify(before); before = now; return same; }).toBe(true);
  await button.click();
  const box = cell.locator("textarea");
  await expect(box).toBeFocused();
  // editing changes neither the cell nor the row
  expect(await layout()).toEqual(before);
  const oneLine = (await box.boundingBox())!.height;

  const long = "Saw them at the Gothic in May, great draw, ask Dana about the opener slot and whether they want a local band with a horn section";
  const [first, rest] = [long.slice(0, 30), long.slice(31)]; // "Saw them at the Gothic in May," then a new line
  await box.pressSequentially(first);
  await box.press("Shift+Enter");
  await box.pressSequentially(rest);
  await expect.poll(async () => (await box.boundingBox())!.height).toBeGreaterThan(oneLine);
  expect(await layout()).toEqual(before);

  await box.press("Enter");
  await expect(box).toHaveCount(0);
  const text = button.locator(".min-w-0");
  await expect(text).toContainText("Saw them at the Gothic in May,");
  expect(await layout()).toEqual(before);
  // one line, cut off with an ellipsis
  const style = await text.evaluate((el) => ({ ov: getComputedStyle(el).textOverflow, ws: getComputedStyle(el).whiteSpace, cut: el.scrollWidth > el.clientWidth }));
  expect(style).toEqual({ ov: "ellipsis", ws: "nowrap", cut: true });

  // saved without leaving the page: it is there after a reload
  await page.reload();
  await everyShow(page);
  await expect(cell.getByRole("button")).toContainText("ask Dana about the opener slot");

  // Escape puts it back; clearing it leaves "Add a note"
  await cell.getByRole("button").click();
  await cell.locator("textarea").fill("thrown away");
  await cell.locator("textarea").press("Escape");
  await expect(cell.getByRole("button")).toContainText("Saw them at the Gothic");
  await cell.getByRole("button").click();
  await cell.locator("textarea").fill("");
  await cell.locator("textarea").press("Enter");
  await expect(cell.getByRole("button")).toContainText("Add a note");
});
