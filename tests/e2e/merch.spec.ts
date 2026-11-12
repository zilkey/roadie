import { test, expect, type Page } from "@playwright/test";
import { A, APP, ARTIST_SLUG } from "./env";

// Merch (#34, first cut): the price list, the name and look of the fan page, its preview link and QR code. The seeded artist has
// merch off; this file turns it on, works, and puts everything back, one test at a time.
test.describe.configure({ mode: "serial" });

async function signIn(page: Page) {
  await page.goto("/signin");
  await page.getByTestId("dev-rudy").click();
  await expect(page).toHaveURL(/\/calendar$/);
}
const saved = (page: Page) => expect(page.getByTestId("save-status").first()).toHaveText("Saved");
const names = (page: Page) => page.getByTestId("merch-item-name").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
async function setMerch(page: Page, on: boolean) {
  await page.goto(A("/admin/artist"));
  const box = page.getByTestId("feature-merch");
  if ((await box.isChecked()) !== on) { await box.setChecked(on); await saved(page); }
}
const view = async (page: Page) => (await (await page.request.get(`${APP}/api/public/${ARTIST_SLUG}/list`)).json()) as { artistName: string; style: { theme: string; accent: string | null } };

test("the Merch item shows only when merch is on; the price list adds with Add, edits in place, reorders and deletes", async ({ page }) => {
  await signIn(page);
  await setMerch(page, false);
  await expect(page.locator('a[href$="/merch"]')).toHaveCount(0);
  await setMerch(page, true);
  await page.goto(A("/merch"));
  await expect(page.getByTestId("page-title")).toHaveText("Merch");
  await expect(page.getByTestId("merch-setup")).toContainText("Venmo");
  await expect(page.getByTestId("merch-preview")).toHaveAttribute("href", `/f/${ARTIST_SLUG}`);
  await expect(page.getByTestId("merch-fan-url")).toHaveText(new RegExp(`/f/${ARTIST_SLUG}$`));
  await expect(page.getByTestId("merch-qr-canvas")).toBeVisible();

  await expect(page.getByTestId("merch-add")).toBeDisabled();
  for (const [n, p] of [["Coozie", "5"], ["Sticker", "5"], ["T-Shirt", "25"]]) {
    await page.getByTestId("merch-new-name").fill(n);
    await page.getByTestId("merch-new-price").fill(p);
    await page.getByTestId("merch-add").click();
  }
  await saved(page);
  await expect.poll(() => names(page)).toEqual(["Coozie", "Sticker", "T-Shirt"]);

  await page.getByTestId("merch-item-price").nth(2).fill("27.50");
  await page.getByTestId("merch-item-name").nth(2).fill("Tee");
  await saved(page);
  await page.getByTestId("merch-item-grip").nth(2).dragTo(page.getByTestId("merch-item").nth(0));
  await expect.poll(() => names(page)).toEqual(["Tee", "Coozie", "Sticker"]);
  await saved(page);
  await page.reload();
  await expect.poll(() => names(page)).toEqual(["Tee", "Coozie", "Sticker"]);
  await expect(page.getByTestId("merch-item-price").nth(0)).toHaveValue("27.50");

  while (await page.getByTestId("merch-item-delete").count()) await page.getByTestId("merch-item-delete").first().click();
  await saved(page);
  await expect(page.getByTestId("merch-empty")).toBeVisible();
});

test("the fan page's name and style save and reach the public page", async ({ page }) => {
  await signIn(page);
  await page.goto(A("/merch"));
  await page.getByTestId("merch-public-name").fill("Nora Quill");
  await page.getByTestId("merch-theme-dark").click();
  await page.getByTestId("merch-accent-swatch").nth(1).click();
  await saved(page);
  await expect.poll(async () => (await view(page)).artistName).toBe("Nora Quill");
  expect((await view(page)).style).toEqual({ theme: "dark", accent: "#e8590c" });

  await page.getByTestId("merch-public-name").fill("");
  await page.getByTestId("merch-theme-auto").click();
  await page.getByTestId("merch-accent-default").click();
  await saved(page);
  await expect.poll(async () => (await view(page)).artistName).toBe("Nora Quill Band");
  expect((await view(page)).style).toEqual({ theme: "auto", accent: null });
  await setMerch(page, false);
});
