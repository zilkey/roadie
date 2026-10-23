import { test, expect, type Page } from "@playwright/test";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
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
  const [p, s] = await Promise.all([panel.boundingBox(), page.getByTestId("sidebar").boundingBox()]);
  expect(p!.x).toBe(0);
  expect(p!.width).toBeGreaterThan(280);
  expect(p!.width).toBeLessThan(320);
  expect(s!.x).toBeGreaterThanOrEqual(p!.x + p!.width - 1); // sidebar sits to the right of Roadie
  await expect(page.getByTestId("roadie-input")).toHaveAttribute("placeholder", "Ask or tell me anything…");

  await page.getByTestId("roadie-new").click();
  await ask(page, "hi");
  await expect(page.getByTestId("roadie-msg-assistant")).toContainText("Roadie here");
  await expect(page.getByTestId("roadie-msg-user")).toHaveText("hi");

  await ask(page, "what's the weather");
  await expect(page.getByTestId("roadie-msg-assistant").last()).toContainText("I just haul the band's stuff");

  await page.getByTestId("tab-songs").click(); // the panel (and chat) stay put
  await expect(page).toHaveURL(/\/songs$/);
  await expect(page.getByTestId("roadie-msg-assistant")).toHaveCount(2);

  await page.reload();
  await expect(page.getByTestId("roadie-msg-user")).toHaveCount(2);
  await expect(page.getByTestId("roadie-msg-assistant").first()).toContainText("Roadie here");
});

test("admin: narrowing persists across reload, and expands back", async ({ page }) => {
  await signInAs(page, "ingrid");
  await page.getByTestId("roadie-narrow").click();
  await expect(page.getByTestId("roadie-panel")).toHaveAttribute("data-width", "narrow");
  await expect(page.getByTestId("roadie-input")).toHaveCount(0);
  // saved in the users doc, not just the browser: wait for it, then drop local storage
  await expect.poll(async () => (await page.request.get("http://127.0.0.1:8280/v1/projects/demo-band-tracker/databases/(default)/documents/users", { headers: { authorization: "Bearer owner" } })).text()).toContain("narrow");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("roadie-panel")).toHaveAttribute("data-width", "narrow");
  await page.getByTestId("roadie-expand").click();
  await expect(page.getByTestId("roadie-panel")).toHaveAttribute("data-width", "full");
  await expect(page.getByTestId("roadie-input")).toBeVisible();
  await page.waitForTimeout(500); // let the pref write finish before the test ends
});

test("admin: 'show me the shows' navigates and says so", async ({ page }) => {
  await signInAs(page, "ingrid");
  await page.getByTestId("roadie-new").click();
  await ask(page, "show me the shows");
  await expect(page).toHaveURL(/\/shows$/);
  await expect(page.getByTestId("roadie-action")).toHaveText("→ Opened Shows");
  await ask(page, "go to narnia");
  await expect(page).toHaveURL(/\/shows$/);
  await expect(page.getByTestId("roadie-msg-assistant").last()).toContainText("can't do that");
});

test("member never sees Roadie", async ({ page }) => {
  await signInAs(page, "david");
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByTestId("roadie-panel")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("bottom-tabs")).toBeVisible();
  await expect(page.getByTestId("roadie-pill")).toHaveCount(0);
});

test("phone: pill opens a sheet; navigating collapses it back to the pill", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, "ingrid");
  await expect(page.getByTestId("roadie-panel")).toHaveCount(0);
  const pill = page.getByTestId("roadie-pill");
  await expect(pill).toBeVisible();
  const [pb, tb] = await Promise.all([pill.boundingBox(), page.getByTestId("bottom-tabs").boundingBox()]);
  expect(pb!.y + pb!.height).toBeLessThanOrEqual(tb!.y + 1); // above the tabs
  await pill.click();
  await expect(page.getByTestId("roadie-sheet")).toBeVisible();
  await ask(page, "hi");
  await expect(page.getByTestId("roadie-msg-assistant").last()).toContainText("Roadie here");
  await ask(page, "take me to money");
  await expect(page).toHaveURL(/\/money$/);
  await expect(page.getByTestId("roadie-sheet")).toHaveCount(0);
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(page.getByTestId("roadie-action").last()).toHaveText("→ Opened Money");
});
