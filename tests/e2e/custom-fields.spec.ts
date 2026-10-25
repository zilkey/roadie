import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

test("Custom fields: define a show field in admin, fill it on a show, see it; deleting the field clears it", async ({ page }) => {
  const label = `Parking ${Date.now()}`;
  await signInAs(page, "jeff");

  // Admin > Custom fields has a card for shows and one for songs.
  await page.goto(A("/admin/fields"));
  await expect(page.getByTestId("show-fields")).toBeVisible();
  await expect(page.getByTestId("song-fields")).toBeVisible();
  await page.getByTestId("add-show-field").click();
  await page.getByTestId("new-show-field-label").fill(label);
  await page.getByTestId("new-show-field-add").click();
  const row = page.getByTestId("show-fields").getByRole("row", { name: new RegExp(label) });
  await expect(row).toBeVisible();
  await expect(page.getByTestId("song-fields")).not.toContainText(label);

  // The field is on the show page's Custom fields card; fill it in.
  await page.goto(A("/shows/new"));
  await page.getByTestId("show-venue").selectOption({ label: "Hi-Dive · Denver" });
  await page.getByTestId("show-date").fill("2027-06-12");
  await page.getByTestId("show-calendar").uncheck();
  await page.getByTestId("deal-guarantee").fill("100");
  await page.getByTestId("show-save").click();
  await expect(page.getByTestId("show-page")).toBeVisible();
  const card = page.getByTestId("custom-fields");
  await expect(card).toContainText(label);
  await card.getByTestId("custom-fields-edit").click();
  await card.getByLabel(label).fill("Lot B, behind the venue");
  await card.getByTestId("custom-fields-save").click();
  await expect(card.getByTestId("custom-fields-save")).toHaveCount(0);
  await expect(card).toContainText("Lot B, behind the venue");

  // It survives a reload.
  await page.reload();
  await expect(page.getByTestId("custom-fields")).toContainText("Lot B, behind the venue");

  // Deleting the field takes its values with it.
  const showUrl = page.url();
  await page.goto(A("/admin/fields"));
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("show-fields").getByRole("button", { name: `Delete ${label}` }).click();
  await expect(page.getByTestId("show-fields")).not.toContainText(label);
  await page.goto(showUrl);
  await expect(page.getByTestId("custom-fields")).not.toContainText("Lot B, behind the venue");
});
