import { test, expect, type Browser, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

async function as(browser: Browser, key: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInAs(page, key);
  return { page, close: () => ctx.close() };
}

test("Custom fields: define a show field in admin, fill it on a show, see it; deleting the field clears it", async ({ page, browser }) => {
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
  await page.getByTestId("deal-guarantee").fill("100");
  await page.getByTestId("show-save").click();
  await expect(page.getByTestId("show-page")).toBeVisible();
  const card = page.getByTestId("custom-fields");
  await expect(card).toContainText(label);
  // No Edit: tap the value, type, Enter. A Saved tick confirms the write.
  await expect(card.getByTestId("show-edit")).toHaveCount(0);
  const fieldId = await card.locator("[data-testid^=custom-field-]").first().getAttribute("data-testid");
  await card.getByTestId(fieldId!).click();
  await card.getByTestId(`${fieldId}-input`).fill("Lot B, behind the venue");
  await card.getByTestId(`${fieldId}-input`).press("Enter");
  await expect(card.getByTestId(`${fieldId}-saved`)).toBeVisible();
  await expect(card.getByTestId(fieldId!)).toContainText("Lot B, behind the venue");

  // It survives a reload.
  await page.reload();
  await expect(page.getByTestId("custom-fields")).toContainText("Lot B, behind the venue");

  // A member never sees the card (nor any edit control on the page).
  const david = await as(browser, "david");
  await david.page.goto(page.url());
  await expect(david.page.getByTestId("show-page")).toBeVisible();
  await expect(david.page.getByTestId("custom-fields")).toHaveCount(0);
  await expect(david.page.getByTestId("show-edit")).toHaveCount(0);
  await david.close();

  // Deleting the field takes its values with it.
  const showUrl = page.url();
  await page.goto(A("/admin/fields"));
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("show-fields").getByRole("button", { name: `Delete ${label}` }).click();
  await expect(page.getByTestId("show-fields")).not.toContainText(label);
  await page.goto(showUrl);
  await expect(page.getByTestId("custom-fields")).not.toContainText("Lot B, behind the venue");
});

test("Custom fields: a field ticked In table is a column in the Shows and Songs lists", async ({ page, browser }) => {
  const stamp = Date.now();
  const showLabel = `Hotel ${stamp}`, songLabel = `Capo ${stamp}`, title = `Column Song ${stamp}`;
  await signInAs(page, "jeff");
  await page.goto(A("/admin/fields"));
  for (const [kind, label] of [["show", showLabel], ["song", songLabel]] as const) {
    await page.getByTestId(`add-${kind}-field`).click();
    await page.getByTestId(`new-${kind}-field-label`).fill(label);
    await page.getByTestId(`new-${kind}-field-add`).click();
    await expect(page.getByTestId(`${kind}-fields`).getByRole("row", { name: new RegExp(label) })).toBeVisible();
  }
  const showBox = page.getByTestId("show-fields").getByLabel(`Show ${showLabel} in the Shows table`);
  const songBox = page.getByTestId("song-fields").getByLabel(`Show ${songLabel} in the Songs table`);
  await expect(showBox).not.toBeChecked();

  // A show with a value: no column until the field is ticked.
  await page.goto(A("/shows/new"));
  await page.getByTestId("show-venue").selectOption({ label: "Hi-Dive · Denver" });
  await page.getByTestId("show-date").fill("2027-07-17");
  await page.getByTestId("deal-guarantee").fill("100");
  await page.getByTestId("show-save").click();
  const card = page.getByTestId("custom-fields");
  await card.getByRole("button", { name: `Add… ${showLabel}` }).click();
  const input = card.getByRole("textbox", { name: showLabel });
  await input.fill("Holiday Inn");
  await input.press("Enter");
  await expect(card.getByRole("button", { name: `Edit ${showLabel}` })).toContainText("Holiday Inn");
  await page.goto(A("/shows"));
  await expect(page.getByTestId("shows-table-upcoming")).toBeVisible();
  await expect(page.getByTestId("shows-table-upcoming")).not.toContainText(showLabel);

  // A song with a value.
  await page.goto(A("/songs/new"));
  await page.getByTestId("song-title").fill(title);
  await page.getByTestId("save-song").click();
  await expect(page.getByTestId("song-page")).toBeVisible();
  const songField = page.getByTestId("song-fields").getByRole("button", { name: new RegExp(`^(Add…|Edit) ${songLabel}$`) });
  await songField.click();
  await page.getByLabel(songLabel).fill("2");
  await page.getByLabel(songLabel).press("Enter");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");

  // Tick both; each saves on its own.
  await page.goto(A("/admin/fields"));
  await showBox.check();
  await expect(showBox).toBeChecked();
  await songBox.check();
  await expect(songBox).toBeChecked();
  await page.reload();
  await expect(showBox).toBeChecked();

  await page.goto(A("/shows"));
  const shows = page.getByTestId("shows-table-upcoming");
  await expect(shows.getByRole("columnheader", { name: showLabel })).toBeVisible();
  await expect(shows.getByRole("row", { name: /Holiday Inn/ })).toBeVisible();
  await page.goto(A("/songs"));
  const songs = page.getByTestId("songs-list");
  await expect(songs.getByRole("columnheader", { name: songLabel })).toBeVisible();
  await expect(songs.getByRole("row", { name: new RegExp(title) })).toContainText("2");

  // Members see song columns, never show field values.
  const david = await as(browser, "david");
  await david.page.goto(A("/shows"));
  await expect(david.page.getByTestId("shows-table-upcoming")).toBeVisible();
  await expect(david.page.getByTestId("shows-table-upcoming")).not.toContainText(showLabel);
  await david.page.goto(A("/songs"));
  await expect(david.page.getByTestId("songs-list").getByRole("columnheader", { name: songLabel })).toBeVisible();
  await david.close();

  // Untick: the column goes.
  await page.goto(A("/admin/fields"));
  await showBox.uncheck();
  await expect(showBox).not.toBeChecked();
  await page.goto(A("/shows"));
  await expect(page.getByTestId("shows-table-upcoming")).not.toContainText(showLabel);
});
