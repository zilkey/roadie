import { test, expect, type Page } from "@playwright/test";
import { GMAIL, A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

test("flag a venue, move the pitch along, search finds it", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("tab-booking").click();
  await page.getByTestId("booking-search").fill("swallow");
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
  // dates from the flag form: chips, sorted
  const chips = page.getByTestId("pitch-dates").locator('[data-testid*="-chip-"]');
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(1)).toHaveText("Fri, May 1");
  // add and remove on the pitch page autosave
  await page.getByTestId("pitch-dates-date").fill("2099-04-01");
  await page.getByTestId("pitch-dates-add").click();
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(chips).toHaveCount(3);
  await expect(page.getByTestId("pitch-dates-chip-1")).toHaveText("Wed, Apr 1"); // sorted: past, April, May
  await page.getByTestId("pitch-dates-remove-1").click();
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(chips).toHaveCount(2);
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
