import { test, expect, type Page } from "@playwright/test";
import { GMAIL, A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

test("search buckets the results by kind, marks the match, and clearing brings the tab back", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("tab-booking").click();
  await page.getByTestId("booking-search").fill("lost");
  await expect(page.getByTestId("search-summary")).toContainText("for \u201Clost\u201D");
  const venues = page.getByTestId("bucket-venues");
  await expect(venues).toContainText("Lost Lake Lounge");
  await expect(venues.locator("mark").first()).toHaveText(/lost/i);
  await expect(page.getByTestId("bucket-festivals")).toHaveCount(0);
  const lost = venues.locator("tr", { hasText: "Lost Lake Lounge" });
  await expect(lost.locator("[data-testid^='flag-'][data-flagged='1']")).toHaveCount(1);
  await expect(lost.locator("a.nm")).toHaveAttribute("href", /\/booking\/pitches\//); // the name opens the pitch
  await page.getByTestId("booking-search").fill("folks");
  const fests = page.getByTestId("bucket-festivals");
  await expect(fests).toContainText("2027");
  await expect(page.getByTestId("bucket-venues")).toHaveCount(0);
  await page.getByTestId("bucket-all-festivals").click();
  await expect(page).toHaveURL(/\/booking\/festivals\?q=folks/);
  await page.getByTestId("booking-search").fill("");
  await expect(page.getByTestId("search-buckets")).toHaveCount(0);
  await expect(page).not.toHaveURL(/q=/);
  await page.getByTestId("booking-seg-pitches").click();
  await expect(page.getByTestId("pitch-list")).toBeVisible();
  await expect(page).not.toHaveURL(/q=/);
});

test("flag a venue, move the pitch along, search finds it", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("tab-booking").click();
  await expect(page.getByTestId("booking-seg-pitches")).toHaveAttribute("aria-selected", "true"); // Booking opens on the Pitch List
  await page.getByTestId("booking-search").fill("swallow");
  await expect(page.getByTestId("bucket-venues")).toBeVisible(); // a search replaces the tab with buckets
  await page.getByTestId("booking-seg-venues").click(); // and it follows to every tab
  await expect(page).toHaveURL(/\/booking\/venues\?q=swallow/); // the tab's own page has mounted
  const row = page.getByTestId(/^row-venue-/);
  await expect(row).toHaveCount(1);
  const flag = row.locator("[data-testid^='flag-'][data-flagged]"); // the flag button itself, not its form's fields
  await expect(flag).toHaveAttribute("data-flagged", "0");
  // tapping the flag opens a modal dialog (outside the row); nothing is added until "Add to Pitch List"
  const form = page.getByTestId(/^flag-form-/);
  await flag.click();
  await expect(form).toBeVisible();
  await expect(flag).toHaveAttribute("data-flagged", "0");
  // Escape closes it
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await expect(flag).toHaveAttribute("data-flagged", "0");
  await flag.click();
  // configuration is a dropdown of the artist's configurations; its value is the configuration id
  await page.getByTestId(/^flag-pitchedAs-/).selectOption({ label: "Duo" });
  // possible dates: one date input and a round +; chips are sorted, the + is off while the input is empty, duplicates are ignored
  const dates = page.getByTestId(/^flag-dates-[^-]+$/);
  const dateInput = dates.getByTestId(/-date$/);
  const plus = dates.getByTestId(/-add$/);
  await expect(plus).toBeDisabled();
  await expect(dates.getByText(/Through|Note \(optional\)|Add a date/)).toHaveCount(0);
  await dateInput.fill("2099-05-01");
  await expect(plus).toBeEnabled();
  await plus.click();
  await expect(dateInput).toHaveValue("");
  await expect(plus).toBeDisabled();
  await dateInput.fill("2020-05-01");
  await dateInput.press("Enter"); // Enter adds too
  await expect(dates.getByTestId(/-chip-\d$/)).toHaveCount(2);
  await page.getByTestId(/^flag-comment-/).fill("Emailed Sam, they book 3 months out");
  await page.getByTestId(/^flag-submit-/).click();
  await expect(form).toHaveCount(0);
  await expect(flag).toHaveAttribute("data-flagged", "1");
  // the row's Pitch cell now shows the configuration and the dates as plain text
  const cell = row.getByTestId(/^pitch-cell-/);
  await expect(cell).toContainText("Duo");
  await expect(cell).toContainText("Fri, May 1"); // dates are text like "Sat, Nov 21"
  await expect(page.getByTestId("pitch-count")).toBeVisible();

  await page.getByTestId("booking-search").fill("");
  await page.getByTestId("booking-seg-pitches").click();
  const swallow = page.getByTestId("pitch-list").locator("tr", { hasText: "Swallow Hill Music" });
  await expect(swallow).toHaveCount(1);
  await swallow.locator("[data-testid^='flag-'][data-flagged='1']").click(); // the filled flag opens the pitch

  await expect(page.getByTestId("pitch-page")).toBeVisible();
  await expect(page.getByTestId("pitched-as")).toHaveValue("duo"); // chosen on the flag form
  await expect(page.getByTestId("person-Ingrid")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("person-David")).toHaveAttribute("aria-pressed", "false");
  // dates from the flag form: Who's free columns, sorted
  const cols = page.getByTestId("pitch-dates").locator('[data-testid^="pitch-dates-col-"]');
  await expect(cols).toHaveCount(2);
  await expect(cols.nth(1)).toHaveText("Fri, May 1");
  // add and remove on the pitch page autosave
  await page.getByTestId("pitch-dates-date").fill("2099-04-01");
  await page.getByTestId("pitch-dates-add").click();
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(cols).toHaveCount(3);
  await expect(page.getByTestId("pitch-dates-col-1")).toHaveText("Wed, Apr 1"); // sorted: past, April, May
  await page.getByTestId("pitch-dates-remove-1").click();
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(cols).toHaveCount(2);
  await page.getByTestId("next-text").fill("Follow up");
  await page.getByTestId("next-due").fill("2026-11-09");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.getByTestId("status").selectOption("pitched");
  await expect(page.getByTestId("status")).toHaveValue("pitched");
  await expect(page.getByTestId("timeline")).toContainText("Moved to Pitched");
  await page.getByTestId("comment-input").fill("Great room for the trio");
  await page.getByTestId("comment-send").click();
  await expect(page.getByTestId("timeline")).toContainText("Great room for the trio");
  await expect(page.getByTestId("comment-input")).toHaveValue("");
});

test("Pitch List: last contact column, quiet rows turn yellow, statuses without Waiting", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto("/booking/pitches");
  const list = page.getByTestId("pitch-list");
  await expect(list.locator("th:not(.flag)")).toHaveText(["Name", "Type", "City", "Pitch", "Last contact", "Next step"]);
  const dairy = list.locator("tr", { hasText: "Dairy Arts Center" }).first();
  await expect(dairy.getByTestId(/^next-step-/)).toContainText("Fill out the spring submission form");
  await expect(dairy.getByTestId(/^next-step-/)).toContainText("by Nov 5");
  // seed: Bluebird pitched, last contact 20 days ago; Fox talking, 3 days ago; Cervantes a Future Pitch, never contacted
  const bluebird = list.locator("tr", { hasText: "Bluebird Room" });
  await expect(bluebird).toHaveAttribute("data-quiet", "1");
  await expect(bluebird.getByTestId(/^last-contact-/)).toHaveText(/^[A-Z][a-z]{2} \d{1,2}$/);
  const fox = list.locator("tr", { hasText: "Fox Theatre" });
  await expect(fox.getByTestId(/^last-contact-/)).toHaveText(/^[A-Z][a-z]{2} \d{1,2}$/);
  await expect(fox).not.toHaveAttribute("data-quiet", "1");
  const cervantes = list.locator("tr", { hasText: "Cervantes" });
  await expect(cervantes.getByTestId("status-chip")).toHaveText("Future Pitch");
  await expect(cervantes.getByTestId(/^last-contact-/)).toHaveText("—");
  await expect(cervantes).not.toHaveAttribute("data-quiet", "1");
  const filter = page.getByTestId("pitch-status-filter");
  await expect(filter.locator("option", { hasText: "Waiting" })).toHaveCount(0);
  await expect(filter.locator("option", { hasText: "To Pitch" })).toHaveCount(1);
});

test("names open the pitch when there is one, the place page one click under; no pitch opens the place", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await expect(page.getByTestId("booking-seg-all")).toHaveCount(0);
  const lost = (p: Page) => p.getByTestId(/^row-venue-/).filter({ hasText: "Lost Lake Lounge" });
  await lost(page).getByTestId(/^venue-full-/).click();
  await expect(page.getByTestId("pitch-page")).toBeVisible();

  await page.goto(A("/booking/venues"));
  await lost(page).getByTestId(/^venue-full-/).click();
  await expect(page.getByTestId("pitch-page")).toBeVisible();
  await page.goto(A("/booking/venues"));
  await lost(page).getByTestId(/^page-link-/).click();
  await expect(page.getByTestId("venue-page")).toBeVisible();

  // a venue with no pitch: the name is the place page
  const name = `No Pitch ${Date.now()}`;
  await page.goto(A("/booking"));
  await page.getByTestId("booking-add-actions").click();
  await page.getByTestId("add-venue").click();
  await page.getByTestId("new-venue-name").fill(name);
  await page.getByTestId("new-venue-city").fill("Boulder");
  await page.getByTestId("new-venue-submit").click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
  await page.goto(A("/booking/venues"));
  await page.getByTestId("booking-search").fill(name);
  const row = page.getByTestId(/^row-venue-/).filter({ hasText: name });
  await expect(row.getByTestId(/^page-link-/)).toHaveCount(0);
  await row.getByTestId(/^venue-full-/).click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
});

test("send an email from a pitch; it shows in fake Gmail, on the timeline, and replies come back", async ({ page, request }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Lost Lake Lounge" }).locator("[data-testid^='flag-'][data-flagged='1']").click();
  await page.getByTestId("email-toggle").click();
  const templates = page.getByTestId("template");
  await expect(templates).toBeVisible();
  await templates.selectOption({ label: "First pitch" });
  await expect(page.getByTestId("email-subject")).toHaveValue("Lost Lake Lounge · Ingrid Avison Band");
  await expect(page.getByTestId("email-body")).toHaveValue(/Hi Haylee,/);
  await expect(page.getByTestId("email-body")).toHaveValue(/Live video: https:\/\/ingridavison\.example/);
  await expect(page.getByTestId("email-missing")).toHaveCount(0);
  const subject = `Support slot ${Date.now()}`;
  await page.getByTestId("email-subject").fill(subject);
  await page.getByTestId("email-send").click();
  await expect(page.getByTestId("email-sent")).toBeVisible();
  await expect(page.getByTestId("timeline").getByTestId("tl-emailSent")).toContainText(subject);

  const msgs = (await (await request.get(`${GMAIL}/messages?account=jeff@example.com`)).json()) as { subject: string; to: string[]; threadId: string }[];
  const mine = msgs.find((m) => m.subject === subject);
  expect(mine?.to).toEqual(["haylee@lostlake.example"]);
  await page.goto(GMAIL);
  await expect(page.getByText(subject).first()).toBeVisible();

  await request.post(`${GMAIL}/threads/${mine!.threadId}/reply`, { data: { from: "haylee@lostlake.example", body: "Mid-November works." } });
  await page.goBack();
  await page.getByTestId("check-replies").click();
  await expect(page.getByTestId("replies-result")).toHaveText("1 new reply");
  await expect(page.getByTestId("tl-emailReply")).toContainText("Mid-November works.");
});

test("create a promoter, a festival with a year, and open a contact", async ({ page }) => {
  await signInAs(page, "jeff");
  const stamp = Date.now();
  await page.goto(A("/booking"));
  await page.getByTestId("booking-add-actions").click();
  await page.getByTestId("add-promoter").click();
  await page.getByTestId("new-promoter-name").fill(`Promo ${stamp}`);
  await page.getByTestId("new-promoter-submit").click();
  await expect(page.getByTestId("promoter-page")).toBeVisible();

  await page.goto(A("/booking"));
  await page.getByTestId("booking-add-actions").click();
  await page.getByTestId("add-festival").click();
  await page.getByTestId("new-festival-name").fill(`Fest ${stamp}`);
  await page.getByTestId("new-festival-city").fill("Greeley");
  await page.getByTestId("new-festival-submit").click();
  await expect(page.getByTestId("festival-page")).toBeVisible();
  await page.getByTestId("years-edit").click();
  await page.getByTestId("add-edition").click();
  await page.getByTestId("new-edition-label").fill("2099");
  await page.getByTestId("new-edition-submit").click();
  await page.getByTestId("years-done").click();
  const edition = page.getByTestId(/^edition-/).first();
  await expect(edition).toContainText("2099");
  await edition.getByRole("link").click();
  await expect(page.getByTestId("edition-page")).toBeVisible();

  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-contacts").click();
  await page.getByTestId(/^row-contact-/).first().getByTestId(/^contact-full-/).click();
  await expect(page.getByTestId("contact-page")).toBeVisible();
});

test("Email templates: create one and edit it", async ({ page }) => {
  await signInAs(page, "jeff");
  const stamp = Date.now();
  await page.goto(A("/booking/templates"));
  await page.getByTestId("template-new").click();
  await page.getByTestId("template-name").fill(`Tpl ${stamp}`);
  await page.getByTestId("template-subject").fill("Hello");
  await page.getByTestId("template-save").click();
  const card = page.getByTestId(`template-Tpl ${stamp}`);
  await expect(card).toContainText("Hello");
  await card.getByTestId("template-edit").click();
  await page.getByTestId("template-subject").fill("Hello again");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId(`template-Tpl ${stamp}`)).toContainText("Hello again");
});

test("the pitch page has Booked it in its header (a form under it) and Abandon pitch at the foot", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/booking/pitches"));
  await page.getByTestId("pitch-list").locator("tr", { hasText: "Lost Lake Lounge" }).locator("[data-testid^='flag-'][data-flagged='1']").click();
  await expect(page.getByTestId("pitch-page")).toBeVisible();
  const status = (await page.getByTestId("status-chip").textContent()) ?? "";
  await page.getByTestId("booked-it").click();
  await expect(page.getByTestId("book-form")).toBeVisible();
  await expect(page.getByTestId("book-submit")).toBeVisible();
  await page.getByTestId("book-cancel").click();
  await expect(page.getByTestId("book-form")).toHaveCount(0);
  page.once("dialog", (d) => void d.dismiss()); // look, don't abandon: other specs use this pitch
  await page.getByTestId("pitch-abandon").click();
  await expect(page.getByTestId("status-chip")).toHaveText(status);
});
