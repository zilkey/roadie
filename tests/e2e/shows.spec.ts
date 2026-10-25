import { test, expect, type Browser, type Page } from "@playwright/test";
import { CAL, GMAIL, A } from "./env";


async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
async function as(browser: Browser, key: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInAs(page, key);
  return { page, close: () => ctx.close() };
}
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

