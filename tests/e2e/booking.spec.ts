import { test, expect, type Page } from "@playwright/test";
import { GMAIL, A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
}

test("flag a venue, move the pitch along, search finds it", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("tab-booking").click();
  await page.getByTestId("booking-search").fill("swallow");
  const row = page.getByTestId(/^row-venue-/);
  await expect(row).toHaveCount(1);
  const flag = row.locator("[data-testid^='flag-'][data-flagged]"); // the flag button itself, not its form's fields
  await expect(flag).toHaveAttribute("data-flagged", "0");
  // tapping the flag opens a small form; nothing is added until "Add to list"
  await flag.click();
  await expect(row.getByTestId(/^flag-form-/)).toBeVisible();
  await expect(flag).toHaveAttribute("data-flagged", "0");
  await row.getByTestId(/^flag-submit-/).click();
  await expect(flag).toHaveAttribute("data-flagged", "1");
  await expect(row.getByTestId(/^flag-form-/)).toHaveCount(0);

  await page.getByTestId("booking-search").fill("");
  await page.getByTestId("booking-seg-pitches").click();
  await expect(page.getByTestId("group-toPitch")).toContainText("Swallow Hill Music");
  await page.getByTestId("group-toPitch").getByText("Swallow Hill Music").click();

  await expect(page.getByTestId("pitch-page")).toBeVisible();
  await page.getByTestId("pitched-as").selectOption("duo");
  await expect(page.getByTestId("person-Ingrid")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("person-David")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("next-text").fill("Follow up");
  await page.getByTestId("next-due").fill("2026-11-09");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.getByTestId("status-pitched").click();
  await expect(page.getByTestId("status-pitched")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("timeline")).toContainText("Moved to Pitched");
  await page.getByTestId("comment-input").fill("Great room for the trio");
  await page.getByTestId("comment-send").click();
  await expect(page.getByTestId("timeline")).toContainText("Great room for the trio");
  await expect(page.getByTestId("comment-input")).toHaveValue("");

  await page.goto(A("/home"));
  await expect(page.getByTestId("todos")).toContainText("Follow up · Swallow Hill Music");
  await expect(page.getByTestId("deadlines")).toBeVisible();
});

test("a duplicate venue merges into the existing one and its page shows people", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-search").fill("lost lake");
  // a venue row expands in place; its full record is one link further
  await page.getByTestId(/^row-venue-/).getByTestId(/^venue-expand-/).click();
  await page.getByTestId(/^row-venue-/).getByTestId(/^venue-full-/).click();
  const url = page.url();
  await expect(page.getByTestId("venue-page")).toContainText("Haylee Jackson");
  await expect(page.getByTestId("copy-email")).toHaveAttribute("data-copy", "haylee@lostlake.example");
  await page.goto(A("/booking"));
  await page.getByTestId("add-venue").click();
  await page.getByTestId("new-venue-name").fill("Lost Lake Lounge");
  await page.getByTestId("new-venue-city").fill("Denver");
  await page.getByTestId("new-venue-submit").click();
  await expect(page).toHaveURL(url);
});

test("send an email from a pitch; it shows in fake Gmail, on the timeline, and replies come back", async ({ page, request }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId("group-pitched").getByText("Lost Lake Lounge").click();
  await page.getByTestId("email-toggle").click();
  const templates = page.getByTestId("template");
  await expect(templates).toBeVisible();
  await templates.getByRole("button", { name: "First pitch" }).click();
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

test("members cannot reach booking pages", async ({ page }) => {
  await signInAs(page, "david");
  await page.goto(A("/booking/templates"));
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId("booking-home")).toHaveCount(0);
});

test("a venue's edit form autosaves (no Save button), survives a reload, and a new contact is a draft until Add", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-search").fill("lost lake");
  // a venue row expands in place; its full record is one link further
  await page.getByTestId(/^row-venue-/).getByTestId(/^venue-expand-/).click();
  await page.getByTestId(/^row-venue-/).getByTestId(/^venue-full-/).click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
  const url = page.url();
  await page.getByTestId("edit-toggle").click();
  await expect(page.getByTestId("venue-edit-submit")).toHaveCount(0);
  const note = `Load in through the alley ${Date.now()}`;
  await page.getByTestId("venue-edit-loadInNotes").fill(note);
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByTestId("edit-toggle").click();
  await expect(page.getByTestId("venue-edit-loadInNotes")).toHaveValue(note);
  // an empty required field is not saved (and does not blank the venue)
  await page.getByTestId("venue-edit-city").fill("");
  await page.getByTestId("venue-edit-notes").fill("still here");
  await expect(page.getByTestId("save-status")).toContainText("City is required");
  await page.getByTestId("venue-edit-city").fill("Denver");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByTestId("edit-toggle").click();
  await expect(page.getByTestId("venue-edit-notes")).toHaveValue("still here");
  await expect(page.getByTestId("page-title")).toHaveText("Lost Lake Lounge");

  // inline "New contact" = draft: closed and reopened, the typing is still there; Add creates it and clears the draft
  await page.getByTestId("contact-new").click();
  await page.getByTestId("contact-form-name").fill("Draft Person");
  await expect(page.getByTestId("draft-status")).toHaveText("Draft saved");
  await page.reload();
  await expect(page.getByTestId("contact-form-name")).toHaveValue("Draft Person"); // form reopens by itself
  await page.getByTestId("contact-form-submit").click();
  await expect(page.getByTestId("contact-Draft Person")).toBeVisible();
  await page.goto(url);
  await expect(page.getByTestId("contact-form")).toHaveCount(0);
});

test("a new promoter and a new year are drafts; existing promoter, festival and contact autosave", async ({ page }) => {
  await signInAs(page, "jeff");
  const stamp = Date.now();
  const name = `Draft Promo ${stamp}`;
  await page.goto(A("/booking"));
  await page.getByTestId("add-promoter").click();
  await page.getByTestId("new-promoter-name").fill(name);
  await expect(page.getByTestId("draft-status")).toHaveText("Draft saved");
  await page.reload();
  await expect(page.getByTestId("new-promoter-name")).toHaveValue(name); // the form reopens by itself
  await page.goto(A("/home"));
  await expect(page.getByTestId("unfinished")).toContainText(name);
  await page.goto(A("/booking"));
  await page.getByTestId("new-promoter-submit").click();
  await expect(page.getByTestId("promoter-page")).toBeVisible();
  await page.goto(A("/home"));
  await expect(page.getByTestId("unfinished")).toHaveCount(0);

  await page.goto(A("/booking"));
  await page.getByTestId("booking-search").fill(name);
  await page.getByTestId(/^row-promoter-/).getByRole("link").click();
  await page.getByTestId("edit-toggle").click();
  await expect(page.getByTestId("promoter-edit-submit")).toHaveCount(0);
  await page.getByTestId("promoter-edit-notes").fill("Books Fridays");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByTestId("edit-toggle").click();
  await expect(page.getByTestId("promoter-edit-notes")).toHaveValue("Books Fridays");

  // a festival: edit autosaves, "Add a year" is a draft until Add year
  await page.goto(A("/booking"));
  await page.getByTestId("add-festival").click();
  await page.getByTestId("new-festival-name").fill(`Fest ${stamp}`);
  await page.getByTestId("new-festival-submit").click();
  await expect(page.getByTestId("festival-page")).toBeVisible();
  await page.getByTestId("edit-toggle").click();
  await page.getByTestId("festival-edit-genres").fill("folk");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.getByTestId("add-edition").click();
  await page.getByTestId("new-edition-label").fill("2099");
  await expect(page.getByTestId("draft-status")).toHaveText("Draft saved");
  await page.reload();
  await expect(page.getByTestId("new-edition-label")).toHaveValue("2099");
  await page.getByTestId("new-edition-submit").click();
  await expect(page.getByTestId(/^edition-/).first()).toContainText("2099");
  await page.getByTestId(/^edition-/).first().getByRole("link").click();
  await expect(page.getByTestId("edition-page")).toBeVisible();
  await page.getByTestId("edit-toggle").click();
  await page.getByTestId("edition-edit-payNotes").fill("$500");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByTestId("edit-toggle").click();
  await expect(page.getByTestId("edition-edit-payNotes")).toHaveValue("$500");
  await page.getByTestId("edition-edit-payNotes").fill("$900");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.getByTestId("undo-button").first().click(); // edits within 2 minutes fold into one history entry, so Undo reverts both
  await expect(page.getByTestId("edition-edit-payNotes")).toHaveValue("");

  // a contact page autosaves too
  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-contacts").click();
  await page.getByTestId(/^row-contact-/).first().getByRole("link").click();
  await expect(page.getByTestId("contact-page")).toBeVisible();
  await page.getByTestId("edit-toggle").click();
  const note = `call after 5 ${stamp}`;
  await page.getByTestId("contact-edit-notes").fill(note);
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByTestId("edit-toggle").click();
  await expect(page.getByTestId("contact-edit-notes")).toHaveValue(note);
});

test("pitch comments and email templates: existing templates autosave, new ones and comments are drafts", async ({ page }) => {
  await signInAs(page, "jeff");
  const stamp = Date.now();
  await page.goto(A("/booking/templates"));
  await page.getByTestId("template-new").click();
  await page.getByTestId("template-name").fill(`Tpl ${stamp}`);
  await expect(page.getByTestId("draft-status")).toHaveText("Draft saved");
  await page.reload();
  await expect(page.getByTestId("template-name")).toHaveValue(`Tpl ${stamp}`);
  await page.getByTestId("template-subject").fill("Hello");
  await page.getByTestId("template-save").click();
  const card = page.getByTestId(`template-Tpl ${stamp}`);
  await expect(card).toContainText("Hello");
  await card.getByTestId("template-edit").click();
  await page.getByTestId("template-subject").fill("Hello again");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId(`template-Tpl ${stamp}`)).toContainText("Hello again");

  await page.goto(A("/booking"));
  await page.getByTestId("booking-seg-pitches").click();
  await page.getByTestId(/^pitch-(?!list)/).first().click();
  await page.getByTestId("comment-input").fill(`typing ${stamp}`);
  await expect(page.getByTestId("draft-status").first()).toHaveText("Draft saved");
  await page.reload();
  await expect(page.getByTestId("comment-input")).toHaveValue(`typing ${stamp}`);
});
