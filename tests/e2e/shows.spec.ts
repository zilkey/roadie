import { test, expect, type Browser, type Page } from "@playwright/test";
import { dateInBandZone } from "../../src/lib/timezone";
import { addDays } from "../../src/lib/shows";
import { CAL, BIT, GMAIL, A } from "./env";


async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
}
async function as(browser: Browser, key: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInAs(page, key);
  return { page, close: () => ctx.close() };
}
const localToday = () => dateInBandZone();
const showId = (page: Page) => page.url().split("/shows/")[1].split(/[/?]/)[0];

async function cancelShow(page: Page, id: string, reason?: string) {
  await page.goto(A(`/shows/${id}`));
  await page.getByTestId("show-status").click();
  await page.getByTestId("status-opt-canceled").check();
  if (reason) await page.getByTestId("status-reason").fill(reason);
  await page.getByTestId("status-save").click();
  await expect(page.getByTestId("show-status")).toContainText("Canceled");
}
const row = (page: Page, id: string) => page.locator(`[data-testid="shows-row"][data-id="${id}"]`);
const heads = (page: Page, tab: string) => page.getByTestId(`shows-table-${tab}`).locator("th");

test("Booked it turns a pitch into a show with a set length, show start, calendar event and a deal", async ({ page, request }) => {
  type CalEv = { id: string; title: string; attendees: { email: string }[]; start: string };
  const calIds = new Set(((await (await request.get(`${CAL}/events`)).json()) as CalEv[]).map((e) => e.id)); // fake state outlives runs
  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Fox Theatre" }).locator("[data-testid^='flag-'][data-flagged='1']").click(); // the filled flag opens the pitch
  await expect(page.getByTestId("pitch-page")).toBeVisible();
  const pitchUrl = page.url();
  await page.getByTestId("booked-it").click();

  // prefilled from the pitch
  await expect(page.getByTestId("new-show")).toBeVisible();
  await expect(page.getByTestId("show-venue")).not.toHaveValue("");
  await expect(page.getByTestId("billed-as")).toHaveValue("full-band");
  for (const n of ["Ingrid", "Jeff", "David", "Eric", "Emma"]) await expect(page.getByTestId(`play-${n}`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("sound")).toHaveValue("venueProvided");

  // billed as fills who's playing, and stays editable
  await page.getByTestId("billed-as").selectOption("duo");
  await expect(page.getByTestId("play-David")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("billed-as").selectOption("full-band");
  await expect(page.getByTestId("play-David")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("show-date").fill("2027-02-20");
  await page.getByTestId("show-set").fill("20:00");
  await page.getByTestId("show-showStart").fill("19:30");
  await page.getByTestId("show-length").fill("1h 30m");
  await expect(page.getByTestId("show-length-says")).toHaveText("1 hour 30 minutes · ends at 9:30 PM");
  await page.getByTestId("show-length").fill("lots");
  await expect(page.getByTestId("show-length-error")).toBeVisible();
  await page.getByTestId("show-save").click(); // refused: stays on the form
  await expect(page.getByTestId("new-show")).toBeVisible();
  await page.getByTestId("show-length").fill("2:30");
  await expect(page.getByTestId("show-length-says")).toHaveText("2 hours 30 minutes · ends at 10:30 PM");
  await expect(page.getByTestId("show-notes")).toHaveCount(0);
  await page.getByTestId("sound").selectOption("bandProvided");
  await page.getByTestId("need-poster").check();
  await page.getByTestId("need-merch").check();
  await page.getByTestId("deal-guarantee").fill("400");
  await page.getByTestId("show-save").click();

  await expect(page.getByTestId("show-page")).toBeVisible();
  const id = showId(page);

  // calendar
  const findEv = async () => ((await (await request.get(`${CAL}/events`)).json()) as CalEv[]).find((e) => !calIds.has(e.id) && e.title.includes("Fox Theatre") && e.start.startsWith("2027-02-20"));
  await expect.poll(async () => !!(await findEv())).toBe(true);
  const ev = (await findEv())!;
  expect(ev.attendees.map((a) => a.email)).toEqual(expect.arrayContaining(["jeff@example.com", "emma@example.com"]));

  // the pitch is booked and links to the show
  await page.goto(pitchUrl);
  await expect(page.getByTestId("status-chip")).toHaveText("Booked");
  await expect(page.getByTestId(`pitch-show-${id}`)).toBeVisible();

  // cancel takes it off the calendar
  await cancelShow(page, id);
  const after = (await (await request.get(`${CAL}/events`)).json()) as CalEv[];
  expect(after.some((e) => e.id === ev.id)).toBe(false);
});

test("Booked it with several pitch dates: pick which become shows, one show per date", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Rocky Mountain Folks" }).locator("[data-testid^='flag-'][data-flagged='1']").click(); // the filled flag opens the pitch
  await page.getByTestId("pitch-dates-date").fill("2027-07-16");
  await page.getByTestId("pitch-dates-add").click();
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  const pitchUrl = page.url();
  await page.getByTestId("booked-it").click();
  await expect(page.getByTestId("pitch-date-picker")).toBeVisible();
  await expect(page.getByTestId("show-date")).toHaveCount(0);
  // the first upcoming date is chosen; add the other
  await expect(page.getByTestId("pick-date-2027-07-16")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("pick-date-2027-07-23")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("pick-date-2027-07-23").click();
  await page.getByTestId("show-venue").selectOption({ label: "Lost Lake Lounge · Denver" });
  await page.getByTestId("show-calendar").uncheck();
  await expect(page.getByTestId("show-save")).toHaveText("Add 2 shows");
  await page.getByTestId("show-save").click();

  // back on the pitch with a show for each chosen date
  await expect(page.getByTestId("pitch-page")).toBeVisible();
  await expect(page.getByTestId("status-chip")).toHaveText("Booked");
  await expect(page.getByTestId("pitch-shows").locator('[data-testid^="pitch-show-"]')).toHaveCount(2);
  await expect(page.getByTestId("pitch-shows")).toContainText("Fri, Jul 16");
  await expect(page.getByTestId("pitch-shows")).toContainText("Fri, Jul 23");
  expect(page.url()).toBe(pitchUrl);
  for (const l of await page.getByTestId("pitch-shows").locator('[data-testid^="pitch-show-"]').all()) {
    const href = (await l.getAttribute("href"))!;
    await cancelShow(page, href.split("/shows/")[1]);
    await page.goto(pitchUrl);
  }
});

test("Ask who's free: emails go out, a sub answers by link without logging in", async ({ page, browser, request }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Dairy Arts Center" }).locator("[data-testid^='flag-'][data-flagged='1']").click(); // the filled flag opens the pitch
  await page.getByTestId("ask-toggle").click();
  await page.getByTestId("ask-date").fill("2027-03-06");
  await expect(page.getByTestId("ask-person-David")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ask-person-Sam")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("ask-person-Sam").click();
  await expect(page.getByTestId("ask-message")).toHaveValue(/show at Dairy Arts Center on Sat, Mar 6/);
  await page.getByTestId("ask-send").click();

  // Sam has no email: the link is shown to send by text. Others were emailed.
  await expect(page.getByTestId("ask-result")).toContainText("Emailed");
  const link = (await page.getByTestId("ask-link-Sam").textContent())!.trim();
  expect(link).toMatch(/\/ask\/[^/]+\/[^/]+\/[\w-]{20,}$/);
  const mail = (await (await request.get(`${GMAIL}/messages?account=jeff@example.com`)).json()) as { to: string[]; subject: string; body: string }[];
  const toDavid = mail.find((m) => m.to.includes("david@example.com") && m.subject.includes("Dairy Arts Center"));
  expect(toDavid?.body).toMatch(/\/ask\//);

  // Jeff's page: everyone is waiting
  await expect(page.getByTestId("avail-state-Sam")).toHaveText("Waiting");

  // the sub opens the link in a fresh browser with no login
  const anon = await browser.newContext();
  const sub = await anon.newPage();
  await sub.goto(link.replace("http://127.0.0.1:3100", ""));
  await expect(sub.getByTestId("ask-label")).toContainText("Dairy Arts Center");
  await sub.getByTestId("answer-note").fill("Can do after 6");
  await sub.getByTestId("answer-yes").click();
  await expect(sub.getByTestId("answer-saved")).toContainText("You said Yes");
  await sub.getByTestId("answer-maybe").click();
  await expect(sub.getByTestId("answer-saved")).toContainText("You said Maybe");
  await sub.getByTestId("answer-yes").click();
  await expect(sub.getByTestId("answer-saved")).toContainText("You said Yes");
  // a tampered link is refused
  await sub.goto(link.slice(0, -3).replace("http://127.0.0.1:3100", "") + "xyz");
  await expect(sub.getByTestId("ask-problem")).toBeVisible();
  await anon.close();

  // Jeff sees it live, marks David himself, reminds the rest, then closes
  await expect(page.getByTestId("avail-state-Sam")).toHaveText("Yes");
  await expect(page.getByTestId("avail-row-Sam")).toContainText("Can do after 6");
  await page.getByTestId("avail-set-David").click();
  await page.getByTestId("mark-David-maybe").click();
  await expect(page.getByTestId("avail-state-David")).toHaveText("Maybe");
  await expect(page.getByTestId("avail-row-David")).toContainText("set by admin");
  await expect(page.getByTestId("remind-all")).toHaveText("Remind 2 waiting");
  await page.getByTestId("remind-all").click();
  await expect(page.getByTestId("ask-result").last()).toContainText("Emailed");
  await page.getByTestId("ask-close").click();
  await expect(page.getByTestId("ask-closed")).toBeVisible();
});

test("a member sees Home with a show today, read-only, with no money", async ({ page, browser }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/shows/new"));
  await page.getByTestId("show-venue").selectOption({ label: "Hi-Dive · Denver" });
  await page.getByTestId("show-date").fill(localToday());
  await page.getByTestId("show-loadIn").fill("17:00");
  await page.getByTestId("show-set").fill("21:15");
  await page.getByTestId("billed-as").selectOption("full-band");
  await page.getByTestId("show-calendar").uncheck();
  await page.getByTestId("deal-guarantee").fill("300");
  await page.getByTestId("show-save").click();
  await expect(page.getByTestId("show-page")).toBeVisible();
  const id = showId(page);
  // admin Home: show day. Today's card first; the booking to-dos step aside.
  await page.goto(A("/home"));
  await expect(page.getByTestId(`today-${id}`)).toBeVisible();
  await expect(page.getByTestId("booking-home")).toHaveCount(0);

  const david = await as(browser, "david");
  const d = david.page;
  await expect(d.getByTestId(`today-${id}`)).toBeVisible();
  await expect(d.getByTestId(`today-${id}`)).toContainText("Hi-Dive");
  await expect(d.getByTestId(`today-${id}`)).toContainText("5:00 pm");
  await expect(d.getByTestId(`today-${id}`)).toContainText("9:15 pm");
  await expect(d.getByTestId(`today-gear-${id}`)).toBeVisible();
  await expect(d.getByTestId(`today-setlist-${id}`)).toHaveCount(0); // no setlist on this show
  // open "Can you play?" (seeded for David) sits below today's show, above anything else
  const askBox = await d.getByTestId(/^ask-[A-Za-z0-9]+$/).first().boundingBox();
  const todayBox = await d.getByTestId(`today-${id}`).boundingBox();
  expect(todayBox!.y).toBeLessThan(askBox!.y);
  await expect(d.getByTestId("booking-home")).toHaveCount(0);
  await expect(d.getByTestId(/^enter-money/)).toHaveCount(0);

  // the show page opens read-only for a member
  await d.goto(A(`/shows/${id}`));
  await expect(d.getByTestId("show-page")).toBeVisible();
  await d.goto(A("/shows/new"));
  await expect(d).toHaveURL(/\/home$/);
  await d.goto(A("/shows"));
  await expect(row(d, id)).toBeVisible();
  await david.close();

  await cancelShow(page, id);
  await page.goto(A("/home"));
  await expect(page.getByTestId(`today-${id}`)).toHaveCount(0);
  await expect(page.getByTestId("booking-home")).toBeVisible();
});

test("a confirmed show published from the Promotion card appears in fake Bandsintown and leaves on cancel", async ({ page, request }) => {
  const unique = "2027-04-10";
  await request.post(`${BIT}/__reset`); // fake state outlives runs
  await signInAs(page, "jeff");
  await page.goto(A("/shows/new"));
  await page.getByTestId("show-venue").selectOption({ label: "Lost Lake Lounge · Denver" });
  await page.getByTestId("show-date").fill(unique);
  await page.getByTestId("show-set").fill("20:30");
  await page.getByTestId("show-calendar").uncheck();
  await expect(page.getByTestId("show-public")).toHaveCount(0); // no "public show" on the form
  await page.getByTestId("show-save").click();
  await expect(page.getByTestId("show-page")).toBeVisible();
  const id = showId(page);
  await page.getByTestId("promotion-edit").click();
  await page.getByTestId("ticket-url").fill("https://tickets.example/lost-lake");
  await page.getByTestId("promotion-save").click();
  await page.getByTestId("bit-publish").click();
  await expect(page.getByTestId("bit-unpublish")).toBeVisible();

  const list = async () => ((await (await request.get(`${BIT}/events`)).json()) as { datetime: string; venueName: string; ticketUrl?: string; city: string }[]);
  await expect.poll(async () => (await list()).filter((e) => e.datetime.startsWith(unique)).length).toBe(1);
  const mine = (await list()).filter((e) => e.datetime.startsWith(unique));
  expect(mine[0]).toMatchObject({ datetime: `${unique}T20:30:00`, venueName: "Lost Lake Lounge", city: "Denver", ticketUrl: "https://tickets.example/lost-lake" });
  await page.goto(BIT);
  await expect(page.getByText("tickets.example/lost-lake")).toBeVisible();

  await cancelShow(page, id);
  expect((await list()).filter((e) => e.datetime.startsWith(unique))).toHaveLength(0);

  // an unpublished show never goes out
  await page.goto(A("/shows/new"));
  await page.getByTestId("show-venue").selectOption({ label: "Lost Lake Lounge · Denver" });
  await page.getByTestId("show-date").fill("2027-04-11");
  await page.getByTestId("show-calendar").uncheck();
  await page.getByTestId("show-save").click();
  expect((await list()).filter((e) => e.datetime.startsWith("2027-04-11"))).toHaveLength(0);
  const priv = showId(page);
  await cancelShow(page, priv, "Room double-booked.");
  await page.goto(A("/shows#canceled"));
  await expect(row(page, priv).locator("td.reason")).toHaveText("Room double-booked.");
});

test("Shows list: title row with New show and no subtitle; one table per tab; the tab survives a reload", async ({ page, browser }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/shows"));
  const head = page.locator(".page-head");
  await expect(head.getByTestId("page-title")).toHaveText("Shows");
  await expect(head.getByTestId("new-show-btn")).toBeVisible();
  await expect(head.locator(".page-meta")).toHaveCount(0);
  await expect(page.getByText("Upcoming, played, canceled and dropped.")).toHaveCount(0);
  const t = await head.getByTestId("page-title").boundingBox(), b = await head.getByTestId("new-show-btn").boundingBox();
  expect(Math.abs((t!.y + t!.height / 2) - (b!.y + b!.height / 2))).toBeLessThan(4); // same row, centered

  await expect(heads(page, "upcoming")).toHaveText(["Date", "Venue", "Address", "Load in", "Sound check", "Doors", "Show starts", "Downbeat", "Sound", "Contact", "Setlist"]);
  const hi = page.getByTestId("shows-row").filter({ hasText: "Hi-Dive" });
  await expect(hi.locator("td").nth(5)).toHaveText("8:30 pm"); // doors
  await expect(hi.locator("td.addr a")).toHaveAttribute("href", /google\.com\/maps\/search\/\?api=1&query=7%20S%20Broadway/);
  await expect(hi.locator("td").nth(8)).toHaveText("They provide");
  await expect(hi.locator("td.contact")).toHaveCount(1);
  const lake = page.getByTestId("shows-row").filter({ hasText: "Lost Lake Lounge" }).first();
  await expect(lake.locator("td").nth(3)).toHaveText("—"); // no load-in
  await expect(lake.locator("td").nth(3).locator(".dash")).toHaveCount(1);

  await page.getByTestId("shows-filter-played").click();
  await expect(page).toHaveURL(/#played$/);
  await expect(heads(page, "played")).toHaveText(["Date", "Venue", "Duration", "Total income", "Total expenses"]);
  const dairy = page.getByTestId("shows-row").filter({ hasText: "Dairy Arts Center" });
  await expect(dairy.locator("td").nth(2)).toHaveText("50m");
  await expect(page.getByTestId("shows-totals")).toContainText("Showing");
  await expect(page.getByTestId("shows-more")).toHaveCount(0); // fewer than 50 played
  await page.reload();
  await expect(page.getByTestId("shows-filter-played")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("shows-table-played")).toBeVisible();
  await page.getByTestId("shows-filter-dropped").click();
  await expect(page).toHaveURL(/#dropped$/);
  await page.getByTestId("shows-filter-canceled").click();
  await expect(page).toHaveURL(/#canceled$/);

  const david = await as(browser, "david");
  await david.page.goto(A("/shows#played"));
  await expect(heads(david.page, "played")).toHaveText(["Date", "Venue", "Duration"]);
  await expect(david.page.getByTestId("new-show-btn")).toHaveCount(0);
  await expect(david.page.locator(".page-meta")).toHaveCount(0);
  await david.close();
});

test("Shows list on a phone: the table scrolls inside its box with the date pinned; the page never scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signInAs(page, "jeff");
  await page.goto(A("/shows#upcoming"));
  await expect(page.getByTestId("shows-table-upcoming")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const box = page.locator(".show-scroll");
  expect(await box.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await box.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  const date = page.getByTestId("shows-row").first().locator("td.date");
  const b = (await box.boundingBox())!, d = (await date.boundingBox())!;
  expect(d.x).toBeGreaterThanOrEqual(b.x - 1);
  expect(d.x).toBeLessThan(b.x + 4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("last night's unsettled show stays on top of Home: enter money for admins, add expenses for members", async ({ page, browser }) => {
  const yesterday = addDays(dateInBandZone(), -1);
  await signInAs(page, "jeff");
  await page.goto(A("/shows/new"));
  await page.getByTestId("show-venue").selectOption({ label: "Hi-Dive · Denver" });
  await page.getByTestId("show-date").fill(yesterday);
  await page.getByTestId("show-calendar").uncheck();
  await page.getByTestId("show-save").click();
  await expect(page.getByTestId("show-page")).toBeVisible();
  const id = showId(page);

  await page.goto(A("/home"));
  const card = page.getByTestId(`recent-${id}`);
  await expect(card).toContainText("Last night");
  await expect(card).toContainText("How'd it go?");
  await expect(page.getByTestId(`today-${id}`)).toHaveCount(0);
  // the regular Home (next show, to-dos) is still there below it
  await expect(page.getByTestId("booking-home")).toBeVisible();
  await page.getByTestId(`enter-money-${id}`).click();
  await expect(page).toHaveURL(new RegExp(`/shows/${id}\\?tab=finances$`));

  const david = await as(browser, "david");
  await expect(david.page.getByTestId(`recent-${id}`)).toContainText("Add expenses from last night");
  await expect(david.page.getByTestId(`enter-money-${id}`)).toHaveCount(0);
  await expect(david.page.getByTestId(`add-expenses-${id}`)).toBeVisible();
  await david.close();

  await page.goto(A(`/shows/${id}`));
  page.once("dialog", (dlg) => dlg.accept());
  await page.getByTestId("show-archive").click();
  await expect(page).toHaveURL(/\/shows$/);
});


test("a new show is a draft: it restores in another browser, Home lists it under Unfinished, and creating the show clears it", async ({ page, browser }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/shows/new"));
  await page.getByTestId("show-venue").selectOption({ label: "Lost Lake Lounge · Denver" });
  await page.getByTestId("show-date").fill("2027-06-12");
  await page.getByTestId("show-set").fill("20:15");
  await expect(page.getByTestId("draft-status")).toHaveText("Draft saved");

  // same page, same browser: reload restores
  await page.reload();
  await expect(page.getByTestId("show-date")).toHaveValue("2027-06-12");
  await expect(page.getByTestId("draft-restored")).toBeVisible();

  // another machine = a new browser context signed in as the same person (no shared localStorage)
  const other = await as(browser, "jeff");
  await other.page.goto(A("/home"));
  const card = other.page.getByTestId("unfinished");
  await expect(card).toContainText("New show · Lost Lake Lounge · 2027-06-12");
  await card.getByRole("link").first().click();
  await expect(other.page.getByTestId("show-date")).toHaveValue("2027-06-12");
  await expect(other.page.getByTestId("show-set")).toHaveValue("20:15");
  await expect(other.page.getByTestId("show-venue")).not.toHaveValue("");
  await expect(other.page.getByTestId("draft-restored")).toBeVisible();

  // someone else does not get it
  const david = await as(browser, "david");
  await expect(david.page.getByTestId("unfinished")).toHaveCount(0);
  await david.close();

  // creating the show clears the draft everywhere
  await other.page.getByTestId("show-calendar").uncheck();
  await other.page.getByTestId("show-save").click();
  await expect(other.page.getByTestId("show-page")).toBeVisible();
  const id = showId(other.page);
  await other.page.goto(A("/home"));
  await expect(other.page.getByTestId("unfinished")).toHaveCount(0);
  await page.goto(A("/shows/new"));
  await expect(page.getByTestId("show-date")).toHaveValue("");
  await expect(page.getByTestId("draft-restored")).toHaveCount(0);
  await other.close();
  await cancelShow(page, id);
});

