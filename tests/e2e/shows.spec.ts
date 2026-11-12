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
// The tab's own columns: custom field columns (.cf) come and go with Admin > Custom fields, which other specs change in parallel.
const heads = (page: Page, tab: string) => page.getByTestId(`shows-table-${tab}`).locator("th:not(.cf)");

test("Booked it turns a pitch into a show with a set length, show start and a deal; the calendar event goes out only from its button", async ({ page, request }) => {
  type CalEv = { id: string; title: string; attendees: { email: string }[]; start: string };
  const calIds = new Set(((await (await request.get(`${CAL}/events`)).json()) as CalEv[]).map((e) => e.id)); // fake state outlives runs
  await signInAs(page, "rudy");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Heron Theatre" }).locator("[data-testid^='flag-'][data-flagged='1']").click(); // the filled flag opens the pitch
  await expect(page.getByTestId(/^pitch-(page|body)$/)).toBeVisible();
  const pitchUrl = page.url();
  await page.goto(pitchUrl.replace("/booking/pitches/", "/shows/new?pitch=")); // Booked it's form lives on the pitch page; this route stays for Roadie

  // prefilled from the pitch
  await expect(page.getByTestId("new-show")).toBeVisible();
  await expect(page.getByTestId("show-venue")).not.toHaveValue("");
  await expect(page.getByTestId("billed-as")).toHaveValue("full-band");
  for (const n of ["Nora", "Rudy", "Hugo", "Felix", "Iris"]) await expect(page.getByTestId(`play-${n}`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("sound")).toHaveValue("venueProvided");

  // billed as fills who's playing, and stays editable
  await page.getByTestId("billed-as").selectOption("duo");
  await expect(page.getByTestId("play-Hugo")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("billed-as").selectOption("full-band");
  await expect(page.getByTestId("play-Hugo")).toHaveAttribute("aria-pressed", "true");

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
  // a pitch becoming a show is celebrated
  await expect(page.getByTestId("celebration-title")).toHaveText("It's a show!");
  await expect(page.getByTestId("celebration-text")).toContainText("Heron Theatre");

  await expect(page.getByTestId("show-page")).toBeVisible();
  const id = showId(page);

  // Saving the show sends nothing to Calendar
  const findEv = async () => ((await (await request.get(`${CAL}/events`)).json()) as CalEv[]).find((e) => !calIds.has(e.id) && e.title.includes("Heron Theatre") && e.start.startsWith("2027-02-20"));
  expect(await findEv()).toBeUndefined();

  // the pitch is booked and links to the show
  await page.goto(pitchUrl);
  await expect(page.getByTestId("status-chip")).toHaveText("Booked");
  await expect(page.getByTestId(`pitch-show-${id}`)).toBeVisible();

  // Add to calendar from the show, after the preview
  await page.goto(A(`/shows/${id}`));
  await page.getByTestId("where-calendar-open").click();
  await expect(page.getByTestId("cal-preview-invitees")).toContainText("iris@example.com");
  await page.getByTestId("cal-send").click();
  await expect(page.getByTestId("where-calendar")).toContainText("On the band calendar");
  const ev = (await findEv())!;
  expect(ev.attendees.map((a) => a.email)).toEqual(expect.arrayContaining(["rudy@example.com", "iris@example.com"]));

  // Canceling leaves the event until someone removes it
  await cancelShow(page, id);
  expect((await findEv())?.id).toBe(ev.id);
  await page.getByTestId("where-calendar-open").click();
  await page.getByTestId("where-calendar-dialog").getByTestId("cal-remove").click();
  await expect(page.getByTestId("where-calendar")).toContainText("Not on the band calendar");
  expect(await findEv()).toBeUndefined();
});

test("Ask who's free: the pitch's dates ahead are picked, and Send says why it's off", async ({ page }) => {
  await signInAs(page, "rudy");
  const open = async (name: string) => {
    await page.goto(A("/booking"));
    await page.getByTestId("booking-seg-pitches").click();
    await page.getByTestId("pitch-list").locator("tr", { hasText: name }).locator("[data-testid^='flag-'][data-flagged='1']").click();
    await expect(page.getByTestId("ask-form")).toBeVisible();
  };
  // Creamery has possible dates: each one is a column in Who's free and starts picked in the ask.
  await open("Creamery Arts Center");
  await expect(page.getByTestId("pitch-dates-col-0")).toHaveText("Fri, Mar 12");
  await expect(page.getByTestId("ask-date-2027-03-12")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ask-date-2027-03-19")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("whos-free-status")).toHaveText("Not asked yet");
  // Marisol has none: Send is off and says so until a date is added in the grid.
  await open("Marisol");
  await expect(page.getByTestId("ask-no-dates")).toBeVisible();
  await expect(page.getByTestId("ask-send")).toBeDisabled();
  await expect(page.getByTestId("ask-send-why")).toHaveText("Pick a date to send.");
  // A message typed before there's a date gets the real dates as they're added
  await expect(page.getByTestId("ask-message")).toHaveValue(/on \[date\]\./);
  await page.getByTestId("ask-message").fill("Hey all, Marisol on [date]. In?");
  await page.getByTestId("pitch-dates-date").fill("2027-03-06");
  await page.getByTestId("pitch-dates-add").click();
  await expect(page.getByTestId("ask-date-2027-03-06")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ask-message")).toHaveValue("Hey all, Marisol on Sat, Mar 6. In?");
  await page.getByTestId("pitch-dates-date").fill("2027-03-13");
  await page.getByTestId("pitch-dates-add").click();
  await expect(page.getByTestId("ask-message")).toHaveValue("Hey all, Marisol on Sat, Mar 6 or Sat, Mar 13. In?");
  // Dates rewritten by hand aren't touched; a note offers the standard message
  await page.getByTestId("ask-message").fill("Hey all, Marisol in early March. In?");
  await page.getByTestId("ask-date-2027-03-13").click();
  await expect(page.getByTestId("ask-message")).toHaveValue("Hey all, Marisol in early March. In?");
  await expect(page.getByTestId("ask-message-dates")).toContainText("Sat, Mar 6");
  await page.getByTestId("ask-message-reset").click();
  await expect(page.getByTestId("ask-message")).toHaveValue(/show at Marisol' Other Side on Sat, Mar 6\. Can you play\?/);
  await page.getByTestId("pitch-dates-remove-1").click();
  await expect(page.getByTestId("ask-send")).toBeEnabled();
  await expect(page.getByTestId("ask-send-why")).toHaveCount(0);
  // the column's × takes the date off the pitch again
  await page.getByTestId("pitch-dates-remove-0").click();
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await expect(page.getByTestId("ask-no-dates")).toBeVisible();
});

test("Ask who's free: one email per person for every date, a sub answers each date by link, a member signed in", async ({ page, browser, request }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Creamery Arts Center" }).locator("[data-testid^='flag-'][data-flagged='1']").click(); // the filled flag opens the pitch
  await expect(page.getByTestId(/^pitch-(page|body)$/)).toBeVisible();
  const pitchUrl = page.url();
  await page.getByTestId("pitch-dates-date").fill("2027-03-06");
  await page.getByTestId("pitch-dates-add").click();
  await expect(page.getByTestId("pitch-dates-col-0")).toHaveText("Sat, Mar 6");
  await page.getByTestId("ask-date-2027-03-19").click(); // not this one
  await expect(page.getByTestId("ask-person-Hugo")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ask-person-Sam")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("ask-person-Sam").click();
  await expect(page.getByTestId("ask-message")).toHaveValue(/show at Creamery Arts Center on Sat, Mar 6 or Fri, Mar 12\. Can you play\?/);
  await expect(page.getByTestId("ask-send")).toHaveText(/^Send \d+ emails$/);
  await page.getByTestId("ask-send").click();

  // Sam has no email: the link is shown to send by text. Others were emailed, once each for both dates.
  await expect(page.getByTestId("ask-result")).toContainText("Emailed");
  const link = (await page.getByTestId("ask-link-Sam").textContent())!.trim();
  expect(link).toMatch(/\/ask\/[^/]+\/[^/]+\/[\w-]{20,}$/);
  const mail = (await (await request.get(`${GMAIL}/messages?account=rudy@example.com`)).json()) as { to: string[]; subject: string; body: string }[];
  const toHugo = mail.filter((m) => m.to.includes("hugo@example.com") && m.subject.includes("Creamery Arts Center"));
  expect(toHugo).toHaveLength(1);
  expect(toHugo[0].subject).toContain("Sat, Mar 6 or Fri, Mar 12");
  expect(toHugo[0].body).toMatch(/\/ask\//);

  // Rudy's grid: everyone asked, no replies yet; Mar 19 wasn't asked about
  await expect(page.getByTestId("free-Sam-2027-03-06")).toHaveText("No reply");
  await expect(page.getByTestId("free-Sam-2027-03-19")).toHaveText("Not asked");
  await expect(page.getByTestId("whos-free-status")).toContainText("via email");

  // the sub opens the link in a fresh browser with no login: one card per date
  const anon = await browser.newContext();
  const sub = await anon.newPage();
  await sub.goto(link.replace("http://127.0.0.1:3100", ""));
  await expect(sub.getByTestId("ask-label")).toContainText("Creamery Arts Center");
  await expect(sub.locator("[data-testid^='answer-2027-'][data-testid$='-yes']")).toHaveCount(2);
  await sub.getByTestId("answer-2027-03-06-note").fill("Can do after 6");
  await sub.getByTestId("answer-2027-03-06-yes").click();
  await expect(sub.getByTestId("answer-2027-03-06-saved")).toBeVisible();
  await expect(sub.getByTestId("answer-2027-03-06-yes")).toHaveAttribute("aria-pressed", "true");
  await sub.getByTestId("answer-2027-03-12-maybe").click();
  await expect(sub.getByTestId("answer-2027-03-12-maybe")).toHaveAttribute("aria-pressed", "true");
  await sub.reload();
  await expect(sub.getByTestId("answer-2027-03-06-yes")).toHaveAttribute("aria-pressed", "true");
  await expect(sub.getByTestId("answer-2027-03-06-note")).toHaveValue("Can do after 6");
  // a tampered link is refused
  await sub.goto(link.slice(0, -3).replace("http://127.0.0.1:3100", "") + "xyz");
  await expect(sub.getByTestId("ask-problem")).toBeVisible();
  await anon.close();

  // a member opens the pitch signed in and answers there
  const hugo = await as(browser, "hugo");
  await hugo.page.goto(pitchUrl);
  await expect(hugo.page.getByTestId("member-dates")).toBeVisible();
  await hugo.page.getByTestId("answer-2027-03-12-no").click();
  await expect(hugo.page.getByTestId("answer-2027-03-12-saved")).toBeVisible();
  await hugo.close();

  // Rudy sees it live
  await expect(page.getByTestId("free-Sam-2027-03-06")).toContainText("Free");
  await expect(page.getByTestId("free-Sam-2027-03-06")).toContainText("Can do after 6");
  await expect(page.getByTestId("free-Sam-2027-03-12")).toHaveText("Maybe");
  await expect(page.getByTestId("free-Hugo-2027-03-12")).toHaveText("Can't");
  await expect(page.getByTestId("free-total-2027-03-06")).toHaveText(/^1 of \d+$/);

  // Rudy answers for himself on a date nobody asked him about
  await page.reload();
  await expect(page.getByTestId("my-dates")).toBeVisible();
  await page.getByTestId("my-dates").getByTestId("answer-2027-03-19-yes").click();
  await expect(page.getByTestId("my-dates").getByTestId("answer-2027-03-19-saved")).toBeVisible();
});

test("Shows list: title row with New show and no subtitle; one table per tab; the tab survives a reload", async ({ page, browser }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/shows"));
  const head = page.locator(".page-head");
  await expect(head.getByTestId("page-title")).toHaveText("Shows");
  await expect(head.getByTestId("new-show-btn")).toBeVisible();
  await expect(head.locator(".page-meta")).toHaveCount(0);
  await expect(page.getByText("Upcoming, played, canceled and dropped.")).toHaveCount(0);

  await expect(heads(page, "upcoming")).toHaveText(["Date", "Venue", "Address", "Load in", "Sound check", "Doors", "Show starts", "Set starts", "Sound", "Contact", "Setlist"]);
  const hi = page.getByTestId("shows-row").filter({ hasText: "Deep End" }).filter({ hasText: "Nov 14" });
  await expect(hi.locator("td").nth(5)).toHaveText("8:30 pm"); // doors
  await expect(hi.locator("td.addr a")).toHaveAttribute("href", /google\.com\/maps\/search\/\?api=1&query=7%20S%20Broadway/);
  await expect(hi.locator("td").nth(8)).toHaveText("They provide");
  await expect(hi.locator("td.contact")).toHaveCount(1);
  const lake = page.getByTestId("shows-row").filter({ hasText: "Pine Hollow Lounge" }).first();
  await expect(lake.locator("td").nth(3)).toHaveText("—"); // no load-in
  await expect(lake.locator("td").nth(3).locator(".dash")).toHaveCount(1);

  await page.getByTestId("shows-filter-played").click();
  await expect(page).toHaveURL(/#played$/);
  await expect(heads(page, "played")).toHaveText(["Date", "Venue", "Duration", "Total income", "Total expenses"]);
  const creamery = page.getByTestId("shows-row").filter({ hasText: "Creamery Arts Center" });
  await expect(creamery.locator("td").nth(2)).toHaveText("50m");
  await expect(page.getByTestId("shows-totals")).toContainText("Showing");
  await expect(page.getByTestId("shows-more")).toHaveCount(0); // fewer than 50 played
  await page.reload();
  await expect(page.getByTestId("shows-filter-played")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("shows-table-played")).toBeVisible();
  await page.getByTestId("shows-filter-dropped").click();
  await expect(page).toHaveURL(/#dropped$/);
  await page.getByTestId("shows-filter-canceled").click();
  await expect(page).toHaveURL(/#canceled$/);

  const hugo = await as(browser, "hugo");
  await hugo.page.goto(A("/shows#played"));
  await expect(heads(hugo.page, "played")).toHaveText(["Date", "Venue", "Duration"]);
  await expect(hugo.page.getByTestId("shows-row").filter({ hasText: "Creamery Arts Center" })).toHaveCount(1); // he played it (trio)
  await expect(hugo.page.getByTestId("shows-filter-canceled")).toHaveCount(0);
  await expect(hugo.page.getByTestId("shows-filter-dropped")).toHaveCount(0);
  await hugo.page.goto(A("/shows#canceled"));
  await expect(hugo.page.getByTestId("shows-filter-upcoming")).toHaveAttribute("aria-selected", "true");
  await expect(hugo.page.getByTestId("new-show-btn")).toHaveCount(0);
  await expect(hugo.page.locator(".page-meta")).toHaveCount(0);
  await hugo.close();
});

