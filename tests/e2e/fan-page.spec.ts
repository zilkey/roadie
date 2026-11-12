import { test, expect, type Page } from "@playwright/test";
import { A, APP, ARTIST_SLUG } from "./env";

// The Fan Page (/fans): Fans, Price list, Links, Suggested donation, QR code and Settings tabs. Each test puts back what it changed;
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
type View = { artistName: string; logo: string | null; style: { theme: string; accent: string | null }; links: { name: string; url: string }[]; donation: unknown };
const view = async (page: Page) => (await (await page.request.get(`${APP}/api/public/${ARTIST_SLUG}/list`)).json()) as View;

test("tabs, with Preview on every one; the old Merch page lands on Price list; members only get Fans", async ({ page, browser }) => {
  await signIn(page);
  await page.goto(A("/fans"));
  await expect(page.getByTestId("page-title")).toHaveText("Fan Page");
  for (const k of ["fans", "price", "links", "donation", "qr", "settings"]) {
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

test("suggested donation: future shows only, amount, show name, on and off", async ({ page }) => {
  await signIn(page);
  await page.goto(A("/fans?tab=donation"));
  // Only shows from today on are offered (the seed has some ahead).
  await expect.poll(() => page.getByTestId("donation-show").locator("option").count()).toBeGreaterThan(1);
  await page.getByTestId("donation-show").selectOption({ index: 1 });
  await expect(page.getByTestId("donation-name")).not.toHaveValue("");
  await page.getByTestId("donation-name").fill("Jennifer House Concert");
  await page.getByTestId("donation-amount").fill("20");
  await saved(page);
  expect((await view(page)).donation).toBeNull(); // still off
  await page.getByTestId("donation-on").check();
  await saved(page);
  // The seeded artist has no Venmo link, so the public page shows no button (tests/emulator/fans.test.ts covers the view); the saved fields are checked here.
  await page.reload();
  await expect(page.getByTestId("donation-on")).toBeChecked();
  await expect(page.getByTestId("donation-amount")).toHaveValue("20");
  await expect(page.getByTestId("donation-name")).toHaveValue("Jennifer House Concert");
  await page.getByTestId("donation-on").uncheck();
  await page.getByTestId("donation-amount").fill("");
  await page.getByTestId("donation-name").fill("");
  await page.getByTestId("donation-show").selectOption("");
  await saved(page);
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
