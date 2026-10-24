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

async function cancelShow(page: Page, id: string) {
  await page.goto(A(`/shows/${id}`));
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("show-actions").click();
  await page.getByTestId("show-menu-cancel").click();
  await expect(page.getByTestId("show-status")).toHaveText("Canceled");
}

test("Booked it turns a pitch into a show with checklist, an empty gear list, calendar and a deal", async ({ page, request }) => {
  type CalEv = { id: string; title: string; attendees: { email: string }[]; start: string };
  const calIds = new Set(((await (await request.get(`${CAL}/events`)).json()) as CalEv[]).map((e) => e.id)); // fake state outlives runs
  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("group-talking").getByText("Fox Theatre").click();
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
  await page.getByTestId("show-length").fill("45");
  await page.getByTestId("sound").selectOption("bandProvided");
  await page.getByTestId("need-poster").check();
  await page.getByTestId("need-merch").check();
  await page.getByTestId("deal-guarantee").fill("400");
  await page.getByTestId("show-save").click();

  await expect(page.getByTestId("show-page")).toBeVisible();
  const id = showId(page);
  await expect(page.getByTestId("show-people")).toHaveText("Ingrid, Jeff, David, Eric, Emma");
  await expect(page.getByTestId("show-billed")).toContainText("Full band");
  await expect(page.getByTestId("show-sound")).toContainText("We bring it");

  const checklist = page.getByTestId("checklist");
  for (const l of ["Book sound engineer", "Post the poster", "Pack merch table", "Confirm load-in and set times"]) {
    await expect(checklist.locator(`input[value="${l}"]`)).toHaveCount(1);
  }
  await expect(checklist.locator('input[value="Confirm backline with the venue"]')).toHaveCount(0);
  await expect(checklist.locator('input[value="Send stage plot and input list to the venue"]')).toHaveCount(0);

  const gear = page.getByTestId("gear");
  // nothing is pre-filled: people add gear here
  await expect(gear.locator('[data-testid^="gear-row-"]')).toHaveCount(0);
  await expect(gear.locator(".card-h").first()).toContainText("0 of 0");
  await gear.getByTestId("gear-add").fill("Keys rig");
  await gear.getByTestId("gear-add-owner").selectOption({ label: "Jeff" });
  await gear.getByTestId("gear-add-btn").click();
  await expect(gear.locator('input[value="Keys rig"]')).toHaveCount(1);
  await expect(gear.locator(".card-h").first()).toContainText("0 of 1");

  // check off, give an owner, pack
  const first = checklist.locator('[data-testid^="check-row-"]').first();
  await first.locator('input[type="checkbox"]').click();
  await expect(first.locator('input[type="checkbox"]')).toBeChecked();
  await first.locator("select").selectOption({ label: "Eric" });
  await expect(first.locator("select")).toHaveValue(/.+/);
  await gear.locator('[data-testid^="gear-row-"]').first().locator('input[type="checkbox"]').click();
  await expect(gear.locator(".card-h").first()).toContainText("1 of");

  // calendar + deal
  await expect(page.getByTestId("cal-state")).toHaveText("On calendar");
  const events = (await (await request.get(`${CAL}/events`)).json()) as CalEv[];
  const ev = events.find((e) => !calIds.has(e.id) && e.title.includes("Fox Theatre") && e.start.startsWith("2027-02-20"));
  expect(ev).toBeTruthy();
  expect(ev!.attendees.map((a) => a.email)).toEqual(expect.arrayContaining(["jeff@example.com", "emma@example.com"]));
  await expect(page.getByTestId("deal-summary")).toHaveText("$400.00 guarantee");

  // the pitch is booked and links to the show
  await page.goto(pitchUrl);
  await expect(page.getByTestId("status-chip")).toHaveText("Booked");
  await expect(page.getByTestId(`pitch-show-${id}`)).toBeVisible();

  // cancel takes it off the calendar
  await cancelShow(page, id);
  await expect(page.getByTestId("cal-state")).toHaveText("Not on calendar");
  const after = (await (await request.get(`${CAL}/events`)).json()) as CalEv[];
  expect(after.some((e) => e.id === ev!.id)).toBe(false);
});

test("Booked it with several pitch dates: pick which become shows, one show per date", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("group-waiting").getByText("Rocky Mountain Folks").click();
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
  await page.getByTestId("group-toPitch").getByText("Dairy Arts Center").click();
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
  const gear = page.getByTestId("gear");
  for (const [label, who] of [["Bass rig", "David"], ["Keys rig", "Jeff"]]) {
    await gear.getByTestId("gear-add").fill(label);
    await gear.getByTestId("gear-add-owner").selectOption({ label: who });
    await gear.getByTestId("gear-add-btn").click();
    await expect(gear.locator(`input[value="${label}"]`)).toHaveCount(1);
    await expect(gear.getByTestId("gear-add")).toHaveValue(""); // the draft is cleared before the next one
    await expect(gear.getByTestId("gear-add")).toBeEnabled();
  }

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
  await expect(d.getByTestId(`today-gear-${id}`)).toContainText("Bass rig");
  await expect(d.getByTestId(`today-setlist-${id}`)).toHaveCount(0); // no setlist on this show
  // open "Can you play?" (seeded for David) sits below today's show, above anything else
  const askBox = await d.getByTestId(/^ask-[A-Za-z0-9]+$/).first().boundingBox();
  const todayBox = await d.getByTestId(`today-${id}`).boundingBox();
  expect(todayBox!.y).toBeLessThan(askBox!.y);
  await expect(d.getByTestId("booking-home")).toHaveCount(0);
  await expect(d.getByTestId(/^enter-money/)).toHaveCount(0);

  // pack my own gear from Home; not someone else's
  const bass = d.getByTestId(`today-gear-${id}`).locator("label", { hasText: "Bass rig" }).locator("input");
  const keys = d.getByTestId(`today-gear-${id}`).locator("label", { hasText: "Keys rig" }).locator("input");
  await expect(keys).toBeDisabled();
  await bass.click();
  await expect(bass).toBeChecked();

  // read-only show page, no deal
  await d.goto(A(`/shows/${id}`));
  await expect(d.getByTestId("show-page")).toBeVisible();
  await expect(d.getByTestId("show-address")).toContainText("Broadway");
  await expect(d.getByTestId("deal-panel")).toHaveCount(0);
  await expect(d.getByTestId("show-edit")).toHaveCount(0);
  await expect(d.getByTestId("show-actions")).toHaveCount(0);
  await expect(d.getByTestId("check-add")).toHaveCount(0);
  await expect(d.getByTestId("checklist").locator('input[type="checkbox"]').first()).toBeDisabled();
  await expect(d.getByTestId("gear").locator("label", { hasText: "Bass rig" }).locator("input")).toBeChecked();
  await d.goto(A("/shows/new"));
  await expect(d).toHaveURL(/\/home$/);
  await d.goto(A("/shows"));
  await expect(d.getByTestId(`show-${id}`)).toBeVisible();
  await david.close();

  await cancelShow(page, id);
  await page.goto(A("/home"));
  await expect(page.getByTestId(`today-${id}`)).toHaveCount(0);
  await expect(page.getByTestId("booking-home")).toBeVisible();
});

test("a public confirmed show appears in fake Bandsintown, follows changes, and leaves on cancel", async ({ page, request }) => {
  const unique = "2027-04-10";
  await request.post(`${BIT}/__reset`); // fake state outlives runs
  await signInAs(page, "jeff");
  await page.goto(A("/shows/new"));
  await page.getByTestId("show-venue").selectOption({ label: "Lost Lake Lounge · Denver" });
  await page.getByTestId("show-date").fill(unique);
  await page.getByTestId("show-set").fill("20:30");
  await page.getByTestId("show-calendar").uncheck();
  await page.getByTestId("show-public").check();
  await page.getByTestId("show-ticket").fill("https://tickets.example/lost-lake");
  await page.getByTestId("show-save").click();
  await expect(page.getByTestId("show-page")).toBeVisible();
  const id = showId(page);
  await expect(page.getByTestId("bit-state")).toHaveText("Listed");
  await expect(page.getByTestId("bit-detail")).toContainText("Last synced");

  const list = async () => ((await (await request.get(`${BIT}/events`)).json()) as { datetime: string; venueName: string; ticketUrl?: string; city: string }[]);
  const mine = (await list()).filter((e) => e.datetime.startsWith(unique));
  expect(mine).toHaveLength(1);
  expect(mine[0]).toMatchObject({ datetime: `${unique}T20:30:00`, venueName: "Lost Lake Lounge", city: "Denver", ticketUrl: "https://tickets.example/lost-lake" });
  await page.goto(BIT);
  await expect(page.getByText("tickets.example/lost-lake")).toBeVisible();

  // a time change updates the same listing
  await page.goto(A(`/shows/${id}`));
  await page.getByTestId("show-edit").click();
  await page.getByTestId("show-set").fill("21:00");
  await expect(page.getByTestId("save-status")).toHaveText("Saved"); // autosave: no Save button on an existing show
  await expect(page.getByTestId("show-save")).toHaveCount(0);
  await page.getByTestId("show-edit").click(); // Done
  await expect(page.getByTestId("show-info")).toContainText("9:00 pm");
  await expect.poll(async () => (await list()).filter((e) => e.datetime.startsWith(unique)).map((e) => e.datetime)).toEqual([`${unique}T21:00:00`]);

  // turning it into a hold takes it off
  await page.getByTestId("show-edit").click();
  await page.getByTestId("status").selectOption("hold");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.getByTestId("show-edit").click();
  await expect(page.getByTestId("bit-state")).toHaveText("Not listed");
  await expect(page.getByTestId("bit-detail")).toContainText("Holds stay off");
  expect((await list()).filter((e) => e.datetime.startsWith(unique))).toHaveLength(0);

  // confirm again, then cancel removes it
  await page.getByTestId("show-edit").click();
  await page.getByTestId("status").selectOption("confirmed");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.getByTestId("show-edit").click();
  await expect(page.getByTestId("bit-state")).toHaveText("Listed");
  expect((await list()).filter((e) => e.datetime.startsWith(unique))).toHaveLength(1);
  await cancelShow(page, id);
  await expect(page.getByTestId("bit-state")).toHaveText("Not listed");
  expect((await list()).filter((e) => e.datetime.startsWith(unique))).toHaveLength(0);

  // a private show never goes out
  await page.goto(A("/shows/new"));
  await page.getByTestId("show-venue").selectOption({ label: "Lost Lake Lounge · Denver" });
  await page.getByTestId("show-date").fill("2027-04-11");
  await page.getByTestId("show-calendar").uncheck();
  await page.getByTestId("show-save").click();
  await expect(page.getByTestId("bit-state")).toHaveText("Not listed");
  await expect(page.getByTestId("bit-detail")).toContainText("Private shows stay off");
  expect((await list()).filter((e) => e.datetime.startsWith("2027-04-11"))).toHaveLength(0);
  await cancelShow(page, showId(page));
});

test("after the show: rating and attendance saved", async ({ page }) => {
  await signInAs(page, "jeff");
  // the seeded played show (Dairy Arts, Oct 10) is unsettled
  await page.goto(A("/shows"));
  await page.getByTestId("shows-filter-played").click();
  await page.getByTestId("shows-played").getByText("Dairy Arts Center").click();
  await page.getByTestId("after-show").click();
  await page.getByTestId("rate-show-4").click();
  await page.getByTestId("rate-venue-5").click();
  await page.getByTestId("rate-crowd").fill("60");
  await page.getByTestId("rate-paid").fill("58");
  await page.getByTestId("rate-notes").fill("Lovely room");
  // the answers are a draft until Save: they survive a reload
  await expect(page.getByTestId("draft-status").first()).toHaveText("Draft saved");
  await page.reload();
  await expect(page.getByTestId("rate-notes")).toHaveValue("Lovely room");
  await expect(page.getByTestId("rate-show-4")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("draft-restored").first()).toBeVisible();
  await page.getByTestId("rate-save").click();
  await expect(page.getByTestId("rate-saved")).toBeVisible();
  await expect(page.getByTestId("money-step")).toBeVisible();
  await page.getByText("Back to the show").click();
  await expect(page.getByTestId("rating-summary")).toContainText("★★★★☆");
  await expect(page.getByTestId("rating-summary")).toContainText("Crowd about 60");
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
  await expect(page).toHaveURL(new RegExp(`/shows/${id}/after$`));
  // the settlement is a draft for this show: reload keeps it, Start over drops it
  await page.getByTestId("income-door").fill("10");
  await expect(page.getByTestId("money-step").getByTestId("draft-status")).toHaveText("Draft saved");
  await page.reload();
  await expect(page.getByTestId("income-door")).toHaveValue("10");
  await page.getByTestId("money-step").getByTestId("draft-start-over").click();
  await expect(page.getByTestId("income-door")).toHaveValue("");

  const david = await as(browser, "david");
  await expect(david.page.getByTestId(`recent-${id}`)).toContainText("Add expenses from last night");
  await expect(david.page.getByTestId(`enter-money-${id}`)).toHaveCount(0);
  await expect(david.page.getByTestId(`add-expenses-${id}`)).toBeVisible();
  await david.close();

  await page.goto(A(`/shows/${id}`));
  page.once("dialog", (dlg) => dlg.accept());
  await page.getByTestId("show-actions").click();
  await page.getByTestId("show-menu-remove").click();
  await expect(page).toHaveURL(/\/shows$/);
});


test("autosave: edit a show field with no Save button, see Saved, reload, then Undo from the toast puts it back", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/shows/new"));
  await page.getByTestId("show-venue").selectOption({ label: "Hi-Dive · Denver" });
  await page.getByTestId("show-date").fill("2027-05-01");
  await page.getByTestId("show-calendar").uncheck();
  await page.getByTestId("show-save").click();
  await expect(page.getByTestId("show-page")).toBeVisible();
  const id = showId(page);

  // band notes: saves on its own
  const notes = page.getByTestId("notes-input");
  await notes.fill("Park behind the building");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await expect(page.getByTestId("toast")).toContainText("Saved bandNotes");
  await expect(page.getByTestId("undo-button")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("notes-input")).toHaveValue("Park behind the building");

  // the edit form has no Save button either; a field saves after a pause
  await page.getByTestId("show-edit").click();
  await expect(page.getByTestId("show-save")).toHaveCount(0);
  await page.getByTestId("show-set").fill("19:30");
  await page.getByTestId("show-length").fill("50");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.getByTestId("show-edit").click();
  await expect(page.getByTestId("show-info")).toContainText("7:30 pm");

  // Undo in the toast reverts the last save; the notes stay
  await page.getByTestId("undo-button").last().click();
  await expect(page.getByTestId("toast-text").last()).toHaveText("Undone");
  await expect(page.getByTestId("show-info")).not.toContainText("7:30 pm");
  await expect(page.getByTestId("notes-input")).toHaveValue("Park behind the building");

  // typing a note and undoing it puts back what was there before
  await page.getByTestId("notes-input").fill("Park out front");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.getByTestId("undo-button").last().click();
  await expect(page.getByTestId("notes-input")).toHaveValue("Park behind the building");
  await page.reload();
  await expect(page.getByTestId("notes-input")).toHaveValue("Park behind the building");
  await cancelShow(page, id);
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

test("show panels: the deal autosaves, checklist/gear/docs adds are drafts, each change shows a status and Undo", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/shows/new"));
  await page.getByTestId("show-venue").selectOption({ label: "Hi-Dive · Denver" });
  await page.getByTestId("show-date").fill("2027-07-03");
  await page.getByTestId("show-calendar").uncheck();
  await page.getByTestId("show-save").click();
  await expect(page.getByTestId("show-page")).toBeVisible();
  const id = showId(page);

  // deal: no Save button, the field saves on its own, Undo from the toast
  const deal = page.getByTestId("deal-panel");
  await deal.getByTestId("deal-edit").click();
  await expect(deal.getByTestId("deal-save")).toHaveCount(0);
  await deal.getByTestId("deal-edit-type").selectOption("guarantee");
  await deal.getByTestId("deal-edit-guarantee").fill("325");
  await expect(deal.getByTestId("save-status")).toHaveText("Saved");
  await deal.getByTestId("deal-edit").click();
  await expect(deal.getByTestId("deal-summary")).toHaveText("$325.00 guarantee");
  await page.reload();
  await expect(page.getByTestId("deal-summary")).toHaveText("$325.00 guarantee");

  // checklist: the new item is a draft until Add; it survives a reload; adding it clears the draft and offers Undo
  const list = page.getByTestId("checklist");
  await list.getByTestId("check-add").fill("Bring extra cables");
  await expect(list.getByTestId("draft-status")).toHaveText("Draft saved");
  await page.reload();
  await expect(page.getByTestId("check-add")).toHaveValue("Bring extra cables");
  await expect(page.getByTestId("draft-restored").first()).toBeVisible();
  await page.getByTestId("check-add-btn").click();
  await expect(page.getByTestId("checklist").getByTestId("save-status")).toHaveText("Saved");
  await expect(page.getByTestId("check-add")).toHaveValue("");
  await expect(page.locator('[data-testid^="check-label-"][value="Bring extra cables"]')).toHaveCount(1);
  await page.getByTestId("undo-button").last().click();
  await expect(page.locator('[data-testid^="check-label-"][value="Bring extra cables"]')).toHaveCount(0);

  // docs: the same
  await page.getByTestId("doc-title").fill("Stage plot");
  await page.getByTestId("doc-url").fill("https://example.com/plot");
  await expect(page.getByTestId("docs").getByTestId("draft-status")).toHaveText("Draft saved");
  await page.getByTestId("doc-add").click();
  await expect(page.getByTestId("docs")).toContainText("Stage plot");
  await expect(page.getByTestId("doc-title")).toHaveValue("");
  await cancelShow(page, id);
});
