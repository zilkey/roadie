import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

// Acts (#77): bands seen on venue calendars. Refreshing Bluebird Room's seeded iCal feed (fixtures/calendars) links its bills to shared
// acts (src/server/events/acts.ts), so the spec starts there; the later tests open the acts it created.

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

async function openVenue(page: Page, search: string) {
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-venues").click();
  await page.getByTestId("booking-search").fill(search);
  await page.getByTestId(/^row-venue-/).filter({ hasText: search }).first().getByTestId(/^venue-full-/).click();
  await expect(page.getByTestId(/^(venue|pitch)-page$/)).toBeVisible();
  if (await page.getByTestId("pitch-page").count()) await page.getByTestId("target-link").click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
}

test.describe.configure({ mode: "serial" });
const href: Record<string, string> = {};

/** The act page path behind a name in the venue's upcoming shows. */
async function actPath(page: Page, name: string) {
  const link = page.getByTestId("venue-events-list").getByTestId(/^act-name-/).filter({ hasText: name }).first();
  return (await link.getAttribute("href"))!;
}

test("the venue's Events tab lists who opens here, and each name opens the act's page", async ({ page }) => {
  await signInAs(page, "rudy");
  await openVenue(page, "Bluebird Room");
  await page.getByTestId("venue-tab-events").click();
  await page.getByTestId("venue-calendar-refresh").click();
  await expect(page.getByTestId("venue-calendar-health")).toContainText("found 3 shows");

  const openers = page.getByTestId("venue-openers");
  await expect(openers).toBeVisible();
  await expect(openers).toContainText("Who opens here");
  await expect(openers).toContainText("Sample Support");
  await expect(openers).not.toContainText("Lone Example Act"); // headliners aren't openers
  const row = page.getByTestId(/^venue-opener-/).filter({ hasText: "Sample Support" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("1 show");

  href.support = await actPath(page, "Sample Support");
  href.headliner = await actPath(page, "The Example Band");
  href.lone = await actPath(page, "Lone Example Act");
  await row.getByTestId(/^act-name-/).click();
  await expect(page.getByTestId("act-page")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${href.support}$`));
  await expect(page.getByTestId("act-page")).toContainText("Sample Support");
});

test("an act's page lists where they've played, and the shortlist, relationship and note stick", async ({ page }) => {
  await signInAs(page, "rudy");

  // the opener: one show, Opening, with the headliner named
  await page.goto(href.support);
  await expect(page.getByTestId("act-page")).toBeVisible();
  const played = page.getByTestId(/^act-played-/);
  await expect(played).toHaveCount(1);
  await expect(played).toContainText("Bluebird Room");
  await expect(played).toContainText("with The Example Band");
  await expect(played).toContainText("Opening");
  // the headliner: the same show, Headlining
  await page.goto(href.headliner);
  await expect(page.getByTestId(/^act-played-/)).toContainText("Headlining");

  // About starts empty, with Look up not ready yet
  await page.goto(href.support);
  await expect(page.getByTestId("act-about-empty")).toBeVisible();
  await expect(page.getByTestId("act-lookup")).toBeDisabled();

  // shortlist toggles and survives a reload
  const star = page.getByTestId("act-shortlist");
  if ((await star.getAttribute("aria-pressed")) === "true") await star.click(); // a retry starts from the earlier attempt's data
  await expect(star).toHaveText("Shortlist");
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await star.click();
  await expect(star).toHaveText("Shortlisted");
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByTestId("act-shortlist")).toHaveText("Shortlisted");

  // relationship: pick shows its hint, tapping again clears it
  const hint = page.getByTestId("act-rel-hint");
  await expect(hint).toHaveText("Pick one, or leave it blank.");
  await page.getByTestId("act-rel-openFor").click();
  await expect(page.getByTestId("act-rel-openFor")).toHaveAttribute("aria-pressed", "true");
  await expect(hint).toHaveText("Bigger than us: pitch them for an opening slot.");
  await page.getByTestId("act-rel-peer").click();
  await expect(hint).toHaveText("About our size: we open for them, they open for us.");
  await expect(page.getByTestId("act-rel-openFor")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("act-rel-peer").click();
  await expect(page.getByTestId("act-rel-peer")).toHaveAttribute("aria-pressed", "false");
  await expect(hint).toHaveText("Pick one, or leave it blank.");

  // the note saves
  await page.getByTestId("act-note").click();
  await page.getByTestId("act-note-input").fill("Great harmonies. Ask about a swap in spring.");
  await page.getByTestId("act-note-input").press("Tab"); // blur commits
  await expect(page.getByTestId("act-note")).toHaveText("Great harmonies. Ask about a swap in spring.");
  await page.reload();
  await expect(page.getByTestId("act-note")).toHaveText("Great harmonies. Ask about a swap in spring.");
  await expect(page.getByTestId("act-contacts")).toBeVisible();
  await expect(page.getByTestId("contact-add")).toBeVisible();
});

test("the Acts tab shows the shortlist, all acts, a search, and hides an act that isn't a fit until it's searched for", async ({ page }) => {
  await signInAs(page, "rudy");
  const id = (p: string) => p.split("/").pop()!;
  const sup = id(href.support), head = id(href.headliner), lone = id(href.lone);

  await page.goto(A("/booking/acts"));
  await expect(page.getByTestId("acts-tab")).toBeVisible();
  await expect(page.getByTestId("acts-filter-shortlist")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId(`act-row-${sup}`)).toBeVisible();
  await expect(page.getByTestId(`act-row-${head}`)).toHaveCount(0);
  await expect(page.getByTestId(`act-seen-${sup}`)).toContainText("Bluebird Room (opening)");

  await page.getByTestId("acts-filter-all").click();
  await expect(page.getByTestId(`act-row-${sup}`)).toBeVisible();
  await expect(page.getByTestId(`act-row-${head}`)).toBeVisible();
  await expect(page.getByTestId(`act-row-${lone}`)).toBeVisible();

  // the star on a row shortlists it
  await page.getByTestId(`act-star-${head}`).click();
  await expect(page.getByTestId(`act-star-${head}`)).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("acts-filter-shortlist").click();
  await expect(page.getByTestId(`act-row-${head}`)).toBeVisible();
  await page.getByTestId(`act-star-${head}`).click(); // and off again
  await expect(page.getByTestId(`act-row-${head}`)).toHaveCount(0);

  // search narrows the list
  await page.getByTestId("acts-filter-all").click();
  await page.getByTestId("acts-q").fill("lone");
  await expect(page.getByTestId(`act-row-${lone}`)).toBeVisible();
  await expect(page.getByTestId(`act-row-${sup}`)).toHaveCount(0);
  await page.getByTestId("acts-q").fill("zzz nobody");
  await expect(page.getByTestId("acts-empty")).toHaveText("Nothing matches.");

  // "Not a fit" hides the act from the list until its name is searched for
  await page.goto(href.lone);
  await page.getByTestId("act-rel-notFit").click();
  await expect(page.getByTestId("act-rel-hint")).toHaveText("Hidden from the Acts list unless you ask for it.");
  await page.goto(A("/booking/acts"));
  await page.getByTestId("acts-filter-all").click();
  await expect(page.getByTestId(`act-row-${head}`)).toBeVisible();
  await expect(page.getByTestId(`act-row-${lone}`)).toHaveCount(0);
  await page.getByTestId("acts-q").fill("lone");
  await expect(page.getByTestId(`act-row-${lone}`)).toBeVisible();
  await expect(page.getByTestId(`act-row-${lone}`)).toContainText("Not a fit");
});

test("an act's name on the Booking Venue calendars tab links to its page", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-calendars").click();
  // every show, any time: the calendars tab starts on likely opener slots in the next 3 months, and the fixture shows are in 2031
  await page.getByTestId("calendar-filter-all").click();
  await page.getByTestId("calendar-filter-when").selectOption("any");
  const link = page.getByTestId(`act-name-${href.support.split("/").pop()}`).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByTestId("act-page")).toBeVisible();
});

test("an act added by hand lands on its own page with nothing known about it yet", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/booking/acts"));
  await page.getByTestId("booking-add-actions").click();
  await page.getByTestId("add-act").click();
  await expect(page.getByTestId("new-act")).toBeVisible();
  await page.getByTestId("new-act-name").fill("Hand Added Quartet");
  await page.getByTestId("new-act-submit").click();
  await expect(page.getByTestId("act-page")).toBeVisible();
  await expect(page.getByTestId("act-page")).toContainText("Hand Added Quartet");
  await expect(page.getByTestId("act-about-empty")).toBeVisible();
  await expect(page.getByTestId("act-shortlist")).toHaveText("Shortlist");
  await expect(page.getByTestId("act-page")).toContainText("Not on any venue calendar in Roadie.");
});
