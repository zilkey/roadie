import { test, expect } from "@playwright/test";
import { DRIVE, openTab } from "./env";

// #85: Settings › Google › Money sheet, then Send to sheet on Money rewrites two tables in the fake Sheets.
test("an admin chooses their own Money sheet, and Send to sheet fills its Roadie tabs", async ({ page, request }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-rudy").click();
  await expect(page).toHaveURL(/\/calendar$/);

  const settings = async () => {
    await page.getByTestId("band-menu").click();
    await page.getByTestId("band-menu-settings").click();
    await page.getByTestId("settings-nav-google").click();
  };
  const card = page.getByTestId("google-money-sheet");
  // A retry starts from a clean slate: the sheet is Rudy's own setting, so let go of one an earlier try chose.
  await settings();
  await expect(card.getByTestId("money-sheet-status")).toBeVisible();
  await expect(card.getByTestId("money-sheet-change")).toBeVisible();
  if (await card.getByTestId("money-sheet-clear").isVisible()) {
    await card.getByTestId("money-sheet-clear").click();
    await expect(card.getByTestId("money-sheet-change")).toHaveText("Choose");
  }

  // Off until a sheet is chosen
  await openTab(page, "money");
  await expect(page.getByTestId("money-sheet-send")).toHaveAttribute("title", /Choose a Money sheet/);
  await expect(page.getByTestId("money-sheet-send")).toBeDisabled();

  await settings();
  await card.getByTestId("money-sheet-change").click();
  // A sheet Rudy can only view is refused
  await card.getByTestId("money-sheet-q").fill("https://docs.google.com/spreadsheets/d/fake-sheet-readonly/edit");
  await card.getByTestId("money-sheet-use").click();
  await expect(card.getByTestId("error")).toContainText("only view");
  await card.getByTestId("money-sheet-q").fill("https://docs.google.com/spreadsheets/d/fake-sheet-books/edit#gid=0");
  await card.getByTestId("money-sheet-use").click();
  await expect(card.getByTestId("money-sheet-link")).toContainText("Nora's books");
  await expect(card.getByTestId("money-sheet-whose-mine")).toBeChecked();
  await card.getByTestId("money-sheet-whose-band").check();
  await expect(card.getByTestId("money-sheet-note")).toContainText("Saved");
  await expect(card.getByTestId("money-sheet-whose-band")).toBeChecked();

  await openTab(page, "money");
  await page.getByTestId("money-sheet-send").click();
  const dlg = page.getByTestId("money-sheet-result");
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("Sent to Nora's books");
  await expect(dlg.getByTestId("money-sheet-income")).toContainText(/\d+ rows?/);
  await dlg.getByTestId("money-sheet-done").click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId("money-sheet-sent")).toContainText("Sent to Nora's books");

  const book = await (await request.get(`${DRIVE}/sheets/v4/spreadsheets/fake-sheet-books`)).json();
  const tabs = (book.sheets as { properties: { title: string }; tables: { name: string }[] }[]);
  expect(tabs.map((t) => t.properties.title)).toEqual(expect.arrayContaining(["Roadie income", "Roadie expenses"]));
  expect(tabs.flatMap((t) => t.tables.map((x) => x.name))).toEqual(expect.arrayContaining(["Roadie_income", "Roadie_expenses"]));
});
