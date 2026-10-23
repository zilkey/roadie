import { test, expect, type Page } from "@playwright/test";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
}
const GMAIL = "http://127.0.0.1:3201";

test("flag a venue, move the pitch along, search finds it", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.getByTestId("tab-booking").click();
  await page.getByTestId("booking-search").fill("swallow");
  const row = page.getByTestId(/^row-venue-/);
  await expect(row).toHaveCount(1);
  const flag = row.getByTestId(/^flag-/);
  await expect(flag).toHaveAttribute("data-flagged", "0");
  await flag.click();
  await expect(flag).toHaveAttribute("data-flagged", "1");

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
  await page.getByTestId("next-save").click();
  await page.getByTestId("status-pitched").click();
  await expect(page.getByTestId("status-pitched")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("timeline")).toContainText("Moved to Pitched");
  await page.getByTestId("comment-input").fill("Great room for the trio");
  await page.getByTestId("comment-send").click();
  await expect(page.getByTestId("timeline")).toContainText("Great room for the trio");

  await page.goto("/home");
  await expect(page.getByTestId("todos")).toContainText("Follow up · Swallow Hill Music");
  await expect(page.getByTestId("deadlines")).toBeVisible();
});

test("a duplicate venue merges into the existing one and its page shows people", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto("/booking");
  await page.getByTestId("booking-search").fill("lost lake");
  await page.getByTestId(/^row-venue-/).getByRole("link").click();
  const url = page.url();
  await expect(page.getByTestId("venue-page")).toContainText("Haylee Jackson");
  await expect(page.getByTestId("copy-email")).toHaveAttribute("data-copy", "haylee@lostlake.example");
  await page.goto("/booking");
  await page.getByTestId("add-venue").click();
  await page.getByTestId("new-venue-name").fill("Lost Lake Lounge");
  await page.getByTestId("new-venue-city").fill("Denver");
  await page.getByTestId("new-venue-submit").click();
  await expect(page).toHaveURL(url);
});

test("send an email from a pitch; it shows in fake Gmail, on the timeline, and replies come back", async ({ page, request }) => {
  await signInAs(page, "jeff");
  await page.goto("/booking");
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
  await page.goto("/booking/templates");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId("booking-home")).toHaveCount(0);
});
