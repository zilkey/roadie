import { test, expect, type Browser, type Page } from "@playwright/test";
import { dateInBandZone } from "../../src/lib/timezone";
import { addDays } from "../../src/lib/shows";
import { CAL, GMAIL, A } from "./env";


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
  await page.getByTestId("status-opt-canceled").click();
  await expect(page.getByTestId("status-opt-canceled")).toBeChecked();
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
  await page.getByTestId("show-length").fill("2:30");
  await expect(page.getByTestId("show-length-says")).toHaveText("2 hours 30 minutes · ends at 10:30 PM");
  await expect(page.getByTestId("show-notes")).toHaveCount(0);
  await page.getByTestId("sound").selectOption("bandProvided");
  await page.getByTestId("need-poster").click();
  await expect(page.getByTestId("need-poster")).toBeChecked();
  await page.getByTestId("need-merch").click();
  await expect(page.getByTestId("need-merch")).toBeChecked();
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
  const yesterday = addDays(dateInBandZone(), -1);
  await signInAs(page, "jeff");
  // last night's unsettled show stays on top of Home
  await page.goto(A("/shows/new"));
  await page.getByTestId("show-venue").selectOption({ label: "Hi-Dive · Denver" });
  await page.getByTestId("show-date").fill(yesterday);
  await page.getByTestId("show-calendar").uncheck();
  await page.getByTestId("show-save").click();
  await expect(page.getByTestId("show-page")).toBeVisible();
  const lastId = showId(page);
  await page.goto(A("/home"));
  const card = page.getByTestId(`recent-${lastId}`);
  await expect(card).toContainText("Last night");
  await expect(page.getByTestId(`enter-money-${lastId}`)).toHaveAttribute("href", new RegExp(`/shows/${lastId}\\?tab=finances$`));
  const dv = await as(browser, "david");
  await expect(dv.page.getByTestId(`recent-${lastId}`)).toContainText("Add expenses from last night");
  await expect(dv.page.getByTestId(`enter-money-${lastId}`)).toHaveCount(0);
  await expect(dv.page.getByTestId(`add-expenses-${lastId}`)).toBeVisible();
  await dv.close();

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
  // a list from a template: its to-dos are unassigned, so they show on everyone's show-day card
  await page.getByTestId("new-list-actions").click();
  await page.getByRole("menuitem", { name: "Promo", exact: true }).click();
  await expect(page.getByTestId("checklists-count")).toHaveText("0 of 3");
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
  const todo = d.getByTestId(`today-todo-${id}`);
  await expect(todo).toContainText("To do · 3");
  await expect(todo).toContainText("Make show poster");
  // a ticked to-do drops out of Home's open list on the next live update, so assert on the list, not the checkbox
  const first = todo.locator("label").first();
  const label = (await first.locator("span").first().textContent())!;
  await first.getByRole("checkbox").click();
  await expect(todo).toContainText("To do · 2");
  await expect(todo).not.toContainText(label);
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
  await cancelShow(page, lastId);
  await page.goto(A("/home"));
  await expect(page.getByTestId(`today-${id}`)).toHaveCount(0);
  await expect(page.getByTestId("booking-home")).toBeVisible();
});

test("Shows list: title row with New show and no subtitle; one table per tab; the tab survives a reload", async ({ page, browser }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/shows"));
  const head = page.locator(".page-head");
  await expect(head.getByTestId("page-title")).toHaveText("Shows");
  await expect(head.getByTestId("new-show-btn")).toBeVisible();
  await expect(head.locator(".page-meta")).toHaveCount(0);
  await expect(page.getByText("Upcoming, played, canceled and dropped.")).toHaveCount(0);

  await expect(heads(page, "upcoming")).toHaveText(["Date", "Venue", "Address", "Load in", "Sound check", "Doors", "Show starts", "Downbeat", "Sound", "Contact", "Setlist"]);
  const hi = page.getByTestId("shows-row").filter({ hasText: "Hi-Dive" }).filter({ hasText: "Nov 14" });
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

