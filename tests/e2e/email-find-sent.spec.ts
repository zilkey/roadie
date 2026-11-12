import { test, expect, type Page } from "@playwright/test";
import { GMAIL, A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

test("Find sent emails: a pitch emailed from Gmail by hand gets its thread ticked, linked, and onto the pitch's Email card", async ({ page, request }) => {
  const subject = `Rocky Mountain Folks Festival 2027: Nora Quill Band ${Date.now()}`;
  // Sent from Gmail, outside Roadie, and answered there.
  const sent = (await (await request.post(`${GMAIL}/messages/send`, { data: { from: "rudy@example.com", to: ["talent@folks.example"], subject, body: "We'd love to play." } })).json()) as { threadId: string };
  await request.post(`${GMAIL}/messages/receive`, { data: { from: "talent@folks.example", to: ["rudy@example.com"], subject: `Re: ${subject}`, body: "Send us a link.", threadId: sent.threadId } });

  await signInAs(page, "rudy");
  await page.goto(A("/booking/pitches"));
  await page.getByTestId("campaign-email-actions").click();
  await page.getByTestId("find-sent-emails").click();
  await expect(page.getByTestId("find-sent-page")).toBeVisible();

  const row = page.getByTestId(/^find-pitch-/).filter({ hasText: "Rocky Mountain Folks Festival 2027" });
  const hit = row.getByTestId(/^find-hit-/).filter({ hasText: subject });
  await expect(hit).toContainText("Name in the subject");
  await expect(hit.getByRole("checkbox")).toBeChecked(); // surely its own: ticked for you
  await expect(page.getByTestId("find-sent-progress")).toContainText("Found emails for");

  // Untick and tick again, then link.
  await hit.getByRole("checkbox").uncheck();
  await hit.getByRole("checkbox").check();
  await page.getByTestId("find-sent-link").click();
  await expect(hit.getByTestId(/^find-linked-/)).toHaveText("Linked");
  await expect(page.getByTestId("find-sent-progress")).toContainText("Linked");

  // The pitch has the thread on its Email card and the reply on its timeline.
  await row.getByRole("link", { name: "Rocky Mountain Folks Festival 2027" }).click();
  await expect(page.getByTestId("pitch-email-card").getByTestId("email-threads")).toContainText(subject);
  await expect(page.getByText("Send us a link.").first()).toBeVisible();
});
