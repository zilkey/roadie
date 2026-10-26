import { test, expect, type Page } from "@playwright/test";
import { A, openTab } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
async function ask(page: Page, text: string) {
  await page.getByTestId("roadie-input").fill(text);
  await page.getByTestId("roadie-input").press("Enter");
}

test("admin: panel on the left, canned reply, survives navigation and reload", async ({ page }) => {
  await signInAs(page, "ingrid");
  const panel = page.getByTestId("roadie-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-width", "full");
  await expect(page.getByTestId("roadie-input")).toHaveAttribute("placeholder", "Ask or tell me anything…");

  await page.getByTestId("roadie-new").click();
  await ask(page, "hi");
  await expect(page.getByTestId("roadie-msg-assistant")).toContainText("Roadie here");
  await expect(page.getByTestId("roadie-msg-user")).toHaveText("hi");

  await ask(page, "what's the weather");
  await expect(page.getByTestId("roadie-msg-assistant").last()).toContainText("I just haul the band's stuff");

  await ask(page, "show me the shows");
  await expect(page).toHaveURL(/\/shows$/);
  await expect(page.getByTestId("roadie-action")).toHaveText("→ Opened Shows");

  await page.getByTestId("tab-songs").click(); // the panel (and chat) stay put
  await expect(page).toHaveURL(/\/songs$/);
  await expect(page.getByTestId("roadie-msg-user")).toHaveCount(3); // the chat stays put across navigation

  await page.reload();
  await expect(page.getByTestId("roadie-msg-user")).toHaveCount(3);
  await expect(page.getByTestId("roadie-msg-assistant").first()).toContainText("Roadie here");
});

const STAMP = Date.now();

test("'add $50 gas': read-back line, the expense appears on Money live, Undo removes it", async ({ page }) => {
  await signInAs(page, "ingrid");
  await page.getByTestId("roadie-new").click();
  await openTab(page, "money");
  await expect(page).toHaveURL(/\/money$/);
  const what = `gas ${STAMP}`;
  await ask(page, `add $50 ${what}`);
  await expect(page.getByTestId("roadie-readback")).toContainText(`Logged $50 ${what}, paid by`);
  await expect(page.locator("main").getByText(what).first()).toBeVisible(); // the Money page updated by itself, no reload
  await page.getByTestId("roadie-undo").click();
  await expect(page.getByTestId("roadie-undone")).toBeVisible();
  await expect(page.locator("main").getByText(what)).toHaveCount(0);
});

test("'cancel the show': confirm card, Cancel leaves it, Yes cancels it", async ({ page }) => {
  await signInAs(page, "ingrid");
  // a show of its own, so the seeded ones stay as they are
  await page.goto(A("/shows/new"));
  await page.getByTestId("show-venue").selectOption({ label: "Swallow Hill Music · Denver" });
  await page.getByTestId("show-date").fill("2028-03-05");
  await page.getByTestId("show-loadIn").fill("17:00");
  await page.getByTestId("show-set").fill("20:00");
  await page.getByTestId("billed-as").selectOption("full-band");
  await page.getByTestId("show-save").click();
  await expect(page.getByTestId("show-page")).toBeVisible();
  const status = page.getByTestId("show-status");
  await expect(status).not.toHaveText("Canceled");

  await page.getByTestId("roadie-new").click();
  await ask(page, "cancel the show");
  const card = page.getByTestId("roadie-confirm").last();
  await expect(card).toContainText("Cancel the show");
  await expect(card).toContainText("Swallow Hill Music");
  await expect(card).toHaveAttribute("data-status", "pending");
  await expect(status).not.toHaveText("Canceled"); // asking first: nothing happened yet
  await card.getByTestId("roadie-confirm-cancel").click();
  await expect(card).toHaveAttribute("data-status", "canceled");
  await expect(status).not.toHaveText("Canceled");

  await ask(page, "cancel the show");
  const second = page.getByTestId("roadie-confirm").last();
  await expect(second).toHaveAttribute("data-status", "pending");
  await second.getByTestId("roadie-confirm-yes").click();
  await expect(second).toHaveAttribute("data-status", "done");
  await expect(status).toHaveText("Canceled");
  await expect(page.getByTestId("roadie-readback").last()).toContainText("Canceled the show");
});

test("'google ...': the source in the reply is a link that opens in a new tab", async ({ page }) => {
  await signInAs(page, "ingrid");
  await page.getByTestId("roadie-new").click();
  await ask(page, "google the Doghouse booking contact");
  const link = page.getByTestId("roadie-msg-assistant").last().getByTestId("roadie-link");
  await expect(link).toHaveText("https://example.com/roadie-fake-result");
  await expect(link).toHaveAttribute("href", "https://example.com/roadie-fake-result");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
});
