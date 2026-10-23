import { test, expect, type Browser, type Page } from "@playwright/test";
import { A } from "./env";

// Unsubmitted drafts: unsubmittedDrafts/{uid}__{path}. Every "browser" below is a NEW context = another machine (no shared localStorage).
async function as(browser: Browser, key: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
  return { ctx, page, close: () => ctx.close() };
}
const isDraftCall = (name: string) => (r: { url(): string; status(): number }) => r.url().endsWith(`/api/commands/${name}`) && r.status() === 200;

async function newShow(page: Page, date: string) {
  await page.goto(A("/shows/new"));
  await page.getByTestId("show-venue").selectOption({ label: "Hi-Dive · Denver" });
  await page.getByTestId("show-date").fill(date);
  await page.getByTestId("show-calendar").uncheck();
  await page.getByTestId("show-save").click();
  await expect(page.getByTestId("show-page")).toBeVisible();
  return page.url().split("/shows/")[1].split(/[/?]/)[0];
}

test("an edit that never reached the server survives a closed tab: it comes back in a new browser and saves", async ({ browser }) => {
  const a = await as(browser, "jeff");
  const id = await newShow(a.page, "2027-08-14");
  // The autosave request never gets through (the tab is going away); the draft copy still lands.
  await a.page.route("**/api/commands/shows.update", (r) => r.abort());
  const saved = a.page.waitForResponse(isDraftCall("drafts.save"));
  await a.page.getByTestId("notes-input").fill("Load in through the alley");
  await saved;
  await a.close();

  const b = await as(browser, "jeff");
  await b.page.goto(A("/home"));
  await expect(b.page.getByTestId("unfinished")).toContainText("Unsaved changes to Hi-Dive");
  const cleared = b.page.waitForResponse(isDraftCall("drafts.clear"));
  await b.page.goto(A(`/shows/${id}`));
  await expect(b.page.getByTestId("notes-input")).toHaveValue("Load in through the alley");
  await expect(b.page.getByTestId("save-status")).toHaveText("Saved");
  await cleared; // every patch saved: the draft is gone
  await b.page.reload();
  await expect(b.page.getByTestId("notes-input")).toHaveValue("Load in through the alley");
  await b.page.goto(A("/home"));
  await expect(b.page.getByTestId("unfinished")).toHaveCount(0);
  await b.close();
});

test("closing the page right after typing does not lose the edit", async ({ browser }) => {
  const a = await as(browser, "jeff");
  const id = await newShow(a.page, "2027-08-15");
  await a.page.getByTestId("notes-input").fill("Bring the long cables");
  await a.page.close(); // before the 500ms / 800ms timers
  const b = await as(browser, "jeff");
  await b.page.goto(A(`/shows/${id}`));
  await expect(b.page.getByTestId("notes-input")).toHaveValue("Bring the long cables", { timeout: 20_000 });
  await expect(b.page.getByTestId("save-status")).toHaveText("Saved");
  await b.close(); await a.close();
});

test("a new expense typed and abandoned comes back in a new browser; Add clears it and Home stops listing it", async ({ browser }) => {
  const a = await as(browser, "david");
  await a.page.goto(A("/money/expense"));
  await a.page.getByTestId("expense-what").fill("Spare snare stand");
  await a.page.getByTestId("expense-amount").fill("34.50");
  await expect(a.page.getByTestId("draft-status")).toHaveText("Draft saved");
  await a.close();

  const b = await as(browser, "david");
  await expect(b.page.getByTestId("unfinished")).toContainText("New expense · Spare snare stand");
  await b.page.getByTestId("unfinished").getByRole("link").first().click();
  await expect(b.page.getByTestId("expense-what")).toHaveValue("Spare snare stand");
  await expect(b.page.getByTestId("expense-amount")).toHaveValue("34.50");
  await expect(b.page.getByTestId("draft-restored")).toBeVisible();
  await b.page.getByTestId("expense-send").click();
  await expect(b.page).toHaveURL(/\/money$/);
  await b.page.goto(A("/home"));
  await expect(b.page.getByTestId("unfinished")).toHaveCount(0);

  // the form starts empty again
  await b.page.goto(A("/money/expense"));
  await expect(b.page.getByTestId("expense-what")).toHaveValue("");
  await expect(b.page.getByTestId("draft-restored")).toHaveCount(0);
  await b.close();
});

test("last write wins: two machines typing into the same new form, a third sees the later one, unmerged", async ({ browser }) => {
  const one = await as(browser, "david");
  const two = await as(browser, "david");
  await one.page.goto(A("/money/expense"));
  await two.page.goto(A("/money/expense"));
  await expect(one.page.getByTestId("expense-what")).toBeVisible();
  await expect(two.page.getByTestId("expense-what")).toBeVisible();
  await one.page.getByTestId("expense-what").fill("From the first machine");
  await one.page.getByTestId("expense-amount").fill("11");
  await expect(one.page.getByTestId("draft-status")).toHaveText("Draft saved");
  await two.page.getByTestId("expense-what").fill("From the second machine");
  await expect(two.page.getByTestId("draft-status")).toHaveText("Draft saved");

  const three = await as(browser, "david");
  await three.page.goto(A("/money/expense"));
  await expect(three.page.getByTestId("expense-what")).toHaveValue("From the second machine");
  await expect(three.page.getByTestId("expense-amount")).toHaveValue(""); // the first machine's amount was overwritten, not merged
  await three.page.getByTestId("draft-start-over").click();
  await expect(three.page.getByTestId("expense-what")).toHaveValue("");
  await one.close(); await two.close(); await three.close();
});
