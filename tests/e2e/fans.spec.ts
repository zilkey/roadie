import { test, expect, type Browser, type Page } from "@playwright/test";
import { A } from "./env";

// The seeded artist has Fans on and four fans: Ann (already in Bandzoogle), Bo, Cy, Dee. Each test makes its own fans with unique emails.
// The nav test switches the module off and back on, so this file runs one test at a time.
test.describe.configure({ mode: "serial" });

let n = 0;
const uniq = () => `${Date.now().toString(36)}${n++}`;

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
async function as(browser: Browser, key: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInAs(page, key);
  return { page, ctx, close: () => ctx.close() };
}
async function openFans(page: Page) {
  await page.goto(A("/fans"));
  await expect(page.getByTestId("page-title")).toHaveText("Fans");
}
/** Start a clean "Add a fan" form (a draft from an earlier test is thrown away). */
async function openAdd(page: Page) {
  await page.getByTestId("fan-add").click();
  await expect(page.getByTestId("fan-add-form")).toBeVisible();
  const startOver = page.getByTestId("draft-start-over");
  if (await startOver.isVisible()) await startOver.click();
}
async function addFan(page: Page, f: { email: string; firstName?: string; city?: string }) {
  await openAdd(page);
  await page.getByTestId("fan-add-email").fill(f.email);
  if (f.firstName) await page.getByTestId("fan-add-first-name").fill(f.firstName);
  if (f.city) await page.getByTestId("fan-add-city").fill(f.city);
  await page.getByTestId("fan-add-submit").click();
  await expect(page.getByTestId("fan-add-form")).toHaveCount(0);
}
const rowOf = (page: Page, email: string) => page.locator(`[data-testid="fan-row"][data-email="${email}"]`);

test("admin sees the totals, counts by city and show, and the fan list", async ({ page }) => {
  await signInAs(page, "jeff");
  await openFans(page);
  expect(Number(await page.getByTestId("fans-total").textContent())).toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId("fans-by-city")).toContainText("Boulder, CO");
  await expect(page.getByTestId("fans-by-city")).toContainText("No city");
  await expect(page.getByTestId("fans-by-show")).toContainText("Dairy Arts Center");
  await expect(rowOf(page, "ann@example.com")).toBeVisible();
  await expect(rowOf(page, "ann@example.com").getByTestId("fan-bandzoogle")).not.toHaveText("Not yet");
  await expect(rowOf(page, "bo@example.com").getByTestId("fan-bandzoogle")).toHaveText("Not yet");
  await expect(rowOf(page, "dee@example.com").getByTestId("fan-cities")).toHaveText("No city");
});

test("admin adds a fan with Add, and edits the first name in place", async ({ page }) => {
  const email = `paper-${uniq()}@example.com`;
  await signInAs(page, "jeff");
  await openFans(page);
  const before = Number(await page.getByTestId("fans-total").textContent());
  await openAdd(page);
  await page.getByTestId("fan-add-email").fill(email);
  await page.getByTestId("fan-add-city").fill("Salida, CO");
  // typing alone creates nothing
  await page.reload();
  await expect(page.getByTestId("fan-add-form")).toBeVisible(); // the draft brought the form back
  await expect(page.getByTestId("fan-add-email")).toHaveValue(email);
  await expect(rowOf(page, email)).toHaveCount(0);
  await page.getByTestId("fan-add-submit").click();
  await expect(page.getByTestId("fan-add-form")).toHaveCount(0);
  const row = rowOf(page, email);
  await expect(row).toBeVisible();
  await expect(row.getByTestId("fan-cities")).toHaveText("Salida, CO");
  await expect(row).toContainText("Paper");
  await expect(page.getByTestId("fans-total")).toHaveText(String(before + 1));
  // autosave the name
  await row.getByTestId("fan-first-name").fill("Pat");
  await expect(row.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  await page.reload();
  await expect(rowOf(page, email).getByTestId("fan-first-name")).toHaveValue("Pat");
});

test("Cancel on the add form clears its draft", async ({ page }) => {
  await signInAs(page, "jeff");
  await openFans(page);
  await openAdd(page);
  await page.getByTestId("fan-add-email").fill(`never-${uniq()}@example.com`);
  await page.getByTestId("fan-add-cancel").click();
  await expect(page.getByTestId("fan-add-form")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("page-title")).toHaveText("Fans");
  await expect(page.getByTestId("fan-add-form")).toHaveCount(0); // nothing came back
  await page.getByTestId("fan-add").click();
  await expect(page.getByTestId("fan-add-email")).toHaveValue("");
});

test("admin deletes a fan after confirming", async ({ page }) => {
  const email = `gone-${uniq()}@example.com`;
  await signInAs(page, "jeff");
  await openFans(page);
  await addFan(page, { email });
  const row = rowOf(page, email);
  await row.getByTestId("fan-delete").click();
  await expect(page.getByTestId("fan-delete-dialog")).toBeVisible();
  await page.getByTestId("fan-delete-cancel").click();
  await expect(row).toBeVisible(); // Cancel keeps them
  await row.getByTestId("fan-delete").click();
  await page.getByTestId("fan-delete-ok").click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(rowOf(page, email)).toHaveCount(0);
});

test("Send to Bandzoogle: Copy puts the addresses on the clipboard; Mark as added removes the group", async ({ browser }) => {
  const email = `zoo-${uniq()}@example.com`;
  const city = `Zooville ${uniq()}`; // a city of its own, so its group holds only this fan
  const admin = await as(browser, "jeff");
  const page = admin.page;
  await admin.ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openFans(page);
  await addFan(page, { email, city: `${city}, MT` });
  await page.getByTestId("bandzoogle-open").click();
  const group = page.locator(`[data-testid="bandzoogle-group"][data-group="${city}, MT"]`);
  await expect(group).toBeVisible();
  await expect(group).toContainText(email);
  await expect(page.getByTestId("bandzoogle-group").filter({ hasText: "ann@example.com" })).toHaveCount(0); // already added fans never appear
  await group.getByTestId("bandzoogle-copy").click();
  await expect(group.getByTestId("bandzoogle-copy")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(email);
  await group.getByTestId("bandzoogle-mark").click();
  await expect(group).toHaveCount(0);
  await page.getByTestId("bandzoogle-done").click();
  await expect(rowOf(page, email).getByTestId("fan-bandzoogle")).not.toHaveText("Not yet");
  await page.getByTestId("bandzoogle-open").click();
  await expect(page.locator(`[data-testid="bandzoogle-group"][data-group="${city}, MT"]`)).toHaveCount(0);
  await admin.close();
});

test("member sees counts but no email, and no admin buttons", async ({ browser }) => {
  const david = await as(browser, "david");
  const page = david.page;
  await openFans(page);
  await expect(page.getByTestId("fans-total")).toBeVisible();
  await expect(page.getByTestId("fans-by-city")).toContainText("Boulder, CO");
  await expect(page.getByTestId("fans-by-show")).toContainText("Dairy Arts Center");
  await expect(page.getByTestId("fan-row")).toHaveCount(0);
  await expect(page.getByTestId("fan-add")).toHaveCount(0);
  await expect(page.getByTestId("bandzoogle-open")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("@example.com");
  await david.close();
});

test("the Fans nav item and its badge show for admins; the item is gone when the module is off", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/calendar"));
  const item = page.locator('[data-testid="nav-fans"]:visible');
  // Fans sits last, so on a narrow bar it can be inside More
  if (!(await item.count())) await page.getByTestId("more-toggle").click();
  await expect(item).toBeVisible();
  await expect(item.getByTestId("nav-fans-badge")).toBeVisible(); // Bo, Cy and Dee are not in Bandzoogle
  const badge = Number(await item.getByTestId("nav-fans-badge").textContent());
  expect(badge).toBeGreaterThanOrEqual(3);

  const setFans = async (on: boolean) => {
    await page.goto(A("/admin/artist"));
    const box = page.getByTestId("feature-fans");
    await expect(box).toBeVisible();
    if ((await box.isChecked()) !== on) {
      await box.setChecked(on);
      await expect(page.getByTestId("save-status").first()).toHaveText("Saved"); // a full page load right after would drop the pending save
    }
    await expect(box).toBeChecked({ checked: on });
  };
  await setFans(false);
  try {
    await page.goto(A("/calendar"));
    await expect(page.getByTestId("topbar")).toBeVisible();
    await page.getByTestId("more-toggle").click();
    await expect(page.getByTestId("nav-fans")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.goto(A("/fans"));
    await expect(page.getByTestId("fans-off")).toBeVisible();
  } finally {
    await setFans(true);
  }
  await page.reload();
  await page.goto(A("/calendar"));
  await expect(page.getByTestId("topbar")).toBeVisible();
  // Fans can sit inside the closed More menu, so open it like the start of the test
  const back = page.locator('[data-testid="nav-fans"]:visible');
  if (!(await back.count())) await page.getByTestId("more-toggle").click();
  await expect(back).toBeVisible();
});

test("a show with new fans shows the banner; members see the count, admins the Send link", async ({ browser }) => {
  const email = `banner-${uniq()}@example.com`;
  const admin = await as(browser, "jeff");
  const page = admin.page;
  await openFans(page);
  await openAdd(page);
  await page.getByTestId("fan-add-email").fill(email);
  await page.getByTestId("fan-add-show").selectOption({ label: "Dairy Arts Center · Sat, Oct 10" });
  await page.getByTestId("fan-add-submit").click();
  await expect(rowOf(page, email)).toBeVisible();

  const openDairy = async (p: Page) => {
    await p.goto(A("/shows#played"));
    await p.locator('[data-testid="shows-row"]', { hasText: "Dairy Arts Center" }).first().getByRole("link").first().click();
    await expect(p.getByTestId("show-page")).toBeVisible();
  };
  await openDairy(page);
  const banner = page.getByTestId("show-fans-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Dairy Arts Center");
  await expect(banner.getByTestId("show-fans-send")).toBeVisible();
  await banner.getByTestId("show-fans-send").click();
  await expect(page.getByTestId("bandzoogle-dialog")).toBeVisible();
  await expect(page.getByTestId("bandzoogle-group").filter({ hasText: email })).toHaveCount(1);

  const david = await as(browser, "david");
  await openDairy(david.page);
  await expect(david.page.getByTestId("show-fans-banner")).toBeVisible();
  await expect(david.page.getByTestId("show-fans-send")).toHaveCount(0);
  await david.close();
  await admin.close();
});
