import { test, expect, type Page } from "@playwright/test";
import { A, APP, ARTIST_SLUG } from "./env";

// The Fan Page (/fans): Email List, Merch Prices, Money, QR code, Links and Settings tabs. Each test puts back what it changed;
// the file runs one test at a time because they all edit the same artist.
test.describe.configure({ mode: "serial" });

async function signIn(page: Page, key = "rudy") {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
const saved = (page: Page) => expect(page.getByTestId("save-status").first()).toHaveText("Saved");
const values = (page: Page, testid: string) => page.getByTestId(testid).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
const tab = async (page: Page, k: string) => { await page.getByTestId(`fan-page-tab-${k}`).click(); await expect(page).toHaveURL(new RegExp(`tab=${k}`)); };
type View = { artistName: string; logo: string | null; style: { theme: string; accent: string | null }; links: { name: string; url: string }[]; shows: unknown; tip: { venmo: string } | null };
const view = async (page: Page) => (await (await page.request.get(`${APP}/api/public/${ARTIST_SLUG}/list`)).json()) as View;

test("tabs, with Preview on every one; the old Merch page lands on Price list; members only get Fans", async ({ page, browser }) => {
  await signIn(page);
  await page.goto(A("/fans"));
  await expect(page.getByTestId("page-title")).toHaveText("Fan Page");
  for (const k of ["fans", "price", "money", "qr", "links", "settings"]) {
    await tab(page, k);
    await expect(page.getByTestId("fan-page-preview")).toHaveAttribute("href", `/f/${ARTIST_SLUG}`);
  }
  await expect(page.getByTestId("merch-qr-canvas")).toHaveCount(0);
  await tab(page, "qr");
  await expect(page.getByTestId("merch-qr-canvas")).toBeVisible();
  await expect(page.getByTestId("merch-fan-url")).toHaveText(new RegExp(`/f/${ARTIST_SLUG}$`));
  await page.goto(A("/merch"));
  await expect(page).toHaveURL(/\/fans\?tab=price$/);

  const ctx = await browser.newContext();
  const hugo = await ctx.newPage();
  await signIn(hugo, "hugo");
  await hugo.goto(A("/fans?tab=price"));
  await expect(hugo.getByTestId("page-title")).toHaveText("Fan Page");
  await expect(hugo.getByTestId("fan-page-tabs")).toHaveCount(0);
  await expect(hugo.getByTestId("merch-price-list")).toHaveCount(0);
  await expect(hugo.getByTestId("fan-page-preview")).toBeVisible();
  await ctx.close();
});

test("price list: Add, edit in place, drag to reorder, delete", async ({ page }) => {
  await signIn(page);
  await page.goto(A("/fans?tab=price"));
  await expect(page.getByTestId("merch-item-add")).toBeDisabled();
  for (const [n, p] of [["Coozie", "5"], ["Sticker", "5"], ["T-Shirt", "25"]]) {
    await page.getByTestId("merch-item-new-a").fill(n);
    await page.getByTestId("merch-item-new-b").fill(p);
    await page.getByTestId("merch-item-add").click();
  }
  await saved(page);
  await expect.poll(() => values(page, "merch-item-a")).toEqual(["Coozie", "Sticker", "T-Shirt"]);
  await page.getByTestId("merch-item-b").nth(2).fill("27.50");
  await page.getByTestId("merch-item-a").nth(2).fill("Tee");
  await saved(page);
  await page.getByTestId("merch-item-grip").nth(2).dragTo(page.getByTestId("merch-item-item").nth(0));
  await expect.poll(() => values(page, "merch-item-a")).toEqual(["Tee", "Coozie", "Sticker"]);
  await saved(page);
  await page.reload();
  await expect.poll(() => values(page, "merch-item-a")).toEqual(["Tee", "Coozie", "Sticker"]);
  await expect(page.getByTestId("merch-item-b").nth(0)).toHaveValue("27.50");
  while (await page.getByTestId("merch-item-delete").count()) await page.getByTestId("merch-item-delete").first().click();
  await saved(page);
  await expect(page.getByTestId("merch-item-empty")).toBeVisible();
});

test("links: a name and a full URL, reorderable, on the public page in order", async ({ page }) => {
  await signIn(page);
  await page.goto(A("/fans?tab=links"));
  await page.getByTestId("fan-link-new-a").fill("New single");
  await page.getByTestId("fan-link-new-b").fill("example.com");
  await expect(page.getByTestId("fan-link-add")).toBeDisabled();
  await page.getByTestId("fan-link-new-b").fill("https://example.com/single");
  await page.getByTestId("fan-link-add").click();
  await page.getByTestId("fan-link-new-a").fill("Tour poster");
  await page.getByTestId("fan-link-new-b").fill("https://example.com/poster");
  await page.getByTestId("fan-link-add").click();
  await saved(page);
  await page.getByTestId("fan-link-grip").nth(1).dragTo(page.getByTestId("fan-link-item").nth(0));
  await saved(page);
  await expect.poll(async () => (await view(page)).links.map((l) => l.name)).toEqual(["Tour poster", "New single"]);
  while (await page.getByTestId("fan-link-delete").count()) await page.getByTestId("fan-link-delete").first().click();
  await saved(page);
  await expect.poll(async () => (await view(page)).links).toEqual([]);
});

test("a show's Fan Page card: on, name, amount, button, preview link; the Money tab lists it", async ({ page }) => {
  await signIn(page);
  await page.goto(A("/shows"));
  await page.getByTestId("shows-row").filter({ hasText: "Marisol" }).filter({ hasText: "Dec 12" }).first().locator("td.date a").click();
  await page.getByTestId("show-tab-promotion").click();
  const card = page.getByTestId("show-fan-page");
  await expect(card.getByTestId("show-fan-when")).toHaveText("This will appear on the Fan Page 1 hour before the show and 3 hours after.");
  await expect(card.getByTestId("show-fan-preview-none")).toBeVisible();
  const showId = await page.getByTestId("show-page").getAttribute("data-show-id");

  await card.getByTestId("show-fan-on").check();
  await expect(card.getByTestId("show-fan-on")).toBeChecked();
  await card.getByTestId("show-fan-name").click();
  await card.getByTestId("show-fan-name-input").fill("Marisol Late Show");
  await card.getByTestId("show-fan-name-input").press("Enter");
  await expect(card.getByTestId("show-fan-name")).toHaveText(/Marisol Late Show/);
  await card.getByTestId("show-fan-amount").click();
  await card.getByTestId("show-fan-amount-input").fill("0.50");
  await card.getByTestId("show-fan-amount-input").press("Enter");
  await expect(card.getByTestId("show-fan-amount-error")).toBeVisible();
  await card.getByTestId("show-fan-amount-input").fill("15");
  await card.getByTestId("show-fan-amount-input").press("Enter");
  await expect(card.getByTestId("show-fan-amount")).toHaveText(/\$15/);
  await expect(card.getByTestId("show-fan-button-ticket")).toHaveAttribute("aria-pressed", "true");
  await card.getByTestId("show-fan-button-donation").click();
  await expect(card.getByTestId("show-fan-button-donation")).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByTestId("show-fan-preview")).toHaveAttribute("href", `/f/${ARTIST_SLUG}?showId=${showId}`);

  await page.reload();
  await expect(page.getByTestId("show-fan-on")).toBeChecked();
  await expect(page.getByTestId("show-fan-amount")).toHaveText(/\$15/);
  await expect(page.getByTestId("show-fan-button-donation")).toHaveAttribute("aria-pressed", "true");

  // The Fan Page tab lists it with the same preview link; the preview asks the public view for that show.
  await page.goto(A("/fans?tab=money"));
  const row = page.getByTestId("donation-show").filter({ hasText: "Marisol Late Show" });
  await expect(row).toContainText("$15");
  await expect(row).toContainText("Suggested Donation");
  await expect(row.getByTestId("donation-show-preview")).toHaveAttribute("href", `/f/${ARTIST_SLUG}?showId=${showId}`);
  const asked = page.waitForRequest((r) => r.url().includes(`/api/public/${ARTIST_SLUG}/list?showId=${showId}`));
  await page.goto(`/f/${ARTIST_SLUG}?showId=${showId}`);
  await asked;

  // Put it back.
  await page.goBack();
  await page.getByTestId("donation-show-link").filter({ hasText: "Marisol Late Show" }).click();
  const c2 = page.getByTestId("show-fan-page");
  await c2.getByTestId("show-fan-on").uncheck();
  await expect(c2.getByTestId("show-fan-on")).not.toBeChecked();
  await c2.getByTestId("show-fan-name").click();
  await c2.getByTestId("show-fan-name-input").fill("");
  await c2.getByTestId("show-fan-name-input").press("Enter");
  await c2.getByTestId("show-fan-amount").click();
  await c2.getByTestId("show-fan-amount-input").fill("");
  await c2.getByTestId("show-fan-amount-input").press("Enter");
  await expect(c2.getByTestId("show-fan-preview-none")).toBeVisible();
  await c2.getByTestId("show-fan-button-ticket").click();
  await expect(c2.getByTestId("show-fan-button-ticket")).toHaveAttribute("aria-pressed", "true");
});

test("tab names in order; Money's Hide Tips takes the Leave a tip button off the public page", async ({ page }) => {
  await signIn(page);
  await page.goto(A("/fans"));
  await expect(page.getByTestId("fan-page-tabs").getByRole("tab")).toHaveText(["Email List", "Merch Prices", "Money", "QR code", "Links", "Settings"]);
  await tab(page, "money");
  const before = (await view(page)).tip;
  const box = page.getByTestId("fan-hide-tips");
  await expect(box).not.toBeChecked();
  await box.check();
  await saved(page);
  await expect.poll(async () => (await view(page)).tip).toBeNull();
  await page.goto(`/f/${ARTIST_SLUG}`);
  await expect(page.getByTestId("fans-join")).toBeVisible();
  await expect(page.getByTestId("fans-tip")).toHaveCount(0);

  // Put it back.
  await page.goto(A("/fans?tab=money"));
  await page.getByTestId("fan-hide-tips").uncheck();
  await saved(page);
  await expect.poll(async () => (await view(page)).tip).toEqual(before);
  if (before) {
    await page.goto(`/f/${ARTIST_SLUG}`);
    await expect(page.getByTestId("fans-tip-pay")).toHaveText("Leave a tip");
    await expect(page.getByTestId("fans-tip-pay")).toHaveAttribute("href", `https://venmo.com/${before.venmo}?txn=pay&note=Tip`);
  }
});

test("settings: logo upload replaces the name, name and style reach the public page", async ({ page }) => {
  await signIn(page);
  await page.goto(A("/fans?tab=settings"));
  // A 2x2 red PNG.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");
  await page.getByTestId("logo-upload").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await expect(page.getByTestId("logo-preview")).toBeVisible();
  await saved(page);
  await expect.poll(async () => (await view(page)).logo ?? "").toMatch(/^data:image\/(webp|png);base64,/);
  await page.getByTestId("merch-public-name").fill("Nora Quill");
  await page.getByTestId("merch-theme-dark").click();
  await page.getByTestId("merch-accent-swatch").nth(1).click();
  await saved(page);
  await expect.poll(async () => (await view(page)).artistName).toBe("Nora Quill");
  expect((await view(page)).style).toEqual({ theme: "dark", accent: "#e8590c" });

  await page.getByTestId("logo-remove").click();
  await page.getByTestId("merch-public-name").fill("");
  await page.getByTestId("merch-theme-auto").click();
  await page.getByTestId("merch-accent-default").click();
  await saved(page);
  await expect.poll(async () => (await view(page)).logo).toBeNull();
  expect((await view(page)).artistName).toBe("Nora Quill Band");
  expect((await view(page)).style).toEqual({ theme: "auto", accent: null });
});
