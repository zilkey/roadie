import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

const ARTIST = "Ingrid Avison Band";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
}

async function openSettings(page: Page) {
  await signInAs(page, "jeff");
  await expect(page).toHaveURL(/\/home$/);
  await page.goto(A("/admin/artist"));
  await expect(page.getByTestId("configs")).toBeVisible();
  await expect(page.getByTestId("config-trio")).toBeVisible(); // seeded, so the card has loaded
}

/** Create a configuration with no members through the New form. A previous Cancel leaves a draft, so always overwrite the name. */
async function createConfig(page: Page, name: string) {
  await page.getByTestId("add-config").click();
  const form = page.getByTestId("new-config");
  await expect(form).toBeVisible();
  await form.getByTestId("new-config-name").fill(name);
  await form.getByTestId("new-config-add").click();
  await expect(form).toHaveCount(0);
}

async function removeConfig(page: Page, id: string, name: string) {
  await page.getByTestId(`config-remove-${id}`).click();
  await expect(page.getByText(`Remove ${name}?`)).toBeVisible();
  await page.getByTestId(`config-remove-yes-${id}`).click();
  await expect(page.getByTestId(`config-${id}`)).toHaveCount(0);
}

test("configurations: add needs a name, billed-as falls back to the artist name", async ({ page }) => {
  await openSettings(page);
  await page.getByTestId("add-config").click();
  const form = page.getByTestId("new-config");
  await expect(form).toBeVisible();
  await expect(form).toContainText("New configuration");
  await expect(page.getByTestId("add-config")).toBeHidden();

  const name = form.getByTestId("new-config-name");
  const billing = form.getByTestId("new-config-billing");
  const add = form.getByTestId("new-config-add");
  await expect(billing).toHaveAttribute("placeholder", ARTIST);

  await name.fill("");
  await expect(add).toBeDisabled();
  await name.fill("   ");
  await expect(add).toBeDisabled();
  await name.fill("Sextet Add");
  await expect(add).toBeEnabled();

  // start from a known member state (a leftover draft may have some on), then turn David and Ingrid on
  for (const who of ["David", "Ingrid"]) {
    const chip = form.getByRole("button", { name: who });
    if ((await chip.getAttribute("aria-pressed")) !== "true") await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
  }
  await billing.fill("");

  await add.click();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId("add-config")).toBeVisible();

  const row = page.getByTestId("config-sextet-add");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Sextet Add");
  await expect(row).toContainText(ARTIST);
  await expect(row).toContainText("David");
  await expect(row).toContainText("Ingrid");

  await page.reload();
  await expect(page.getByTestId("config-sextet-add")).toBeVisible();
  await expect(page.getByTestId("config-sextet-add")).toContainText(ARTIST);
  await expect(page.getByTestId("config-sextet-add")).toContainText("David");

  await removeConfig(page, "sextet-add", "Sextet Add");
});

test("configurations: Cancel closes the new form without adding a row", async ({ page }) => {
  await openSettings(page);
  await page.getByTestId("add-config").click();
  const form = page.getByTestId("new-config");
  await expect(form).toBeVisible();
  await form.getByTestId("new-config-name").fill("Sextet Cancel");
  await form.getByTestId("new-config-cancel").click();

  await expect(form).toHaveCount(0);
  await expect(page.getByTestId("add-config")).toBeVisible();
  await expect(page.getByTestId("config-sextet-cancel")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("config-trio")).toBeVisible();
  await expect(page.getByTestId("config-sextet-cancel")).toHaveCount(0);

  // Cancel discards the draft: the form stays closed on load and opens empty
  await expect(page.getByTestId("add-config")).toBeVisible();
  await expect(page.getByTestId("new-config")).toHaveCount(0);
  await page.getByTestId("add-config").click();
  await expect(page.getByTestId("new-config-name")).toHaveValue("");
  await page.getByTestId("new-config-cancel").click();
});

test("configurations: editing autosaves and Done closes the form", async ({ page }) => {
  await openSettings(page);
  await createConfig(page, "Sextet Edit");
  const row = page.getByTestId("config-sextet-edit");
  await expect(row).toBeVisible();
  await expect(row).not.toHaveAttribute("data-editing", "1");

  await page.getByTestId("config-edit-sextet-edit").click();
  const form = page.getByTestId("edit-config");
  await expect(form).toBeVisible();
  await expect(form).toContainText("Edit Sextet Edit");
  await expect(row).toHaveAttribute("data-editing", "1");
  await expect(page.getByTestId("add-config")).toBeHidden();
  await expect(form.getByTestId("edit-config-done")).toHaveText("Done");

  await form.getByTestId("edit-config-billing").fill("Ingrid Avison Sextet");
  await expect(page.getByTestId("save-status").first()).toHaveText("Saved");
  await form.getByTestId("edit-config-done").click();
  await expect(form).toHaveCount(0);
  await expect(row).not.toHaveAttribute("data-editing", "1");
  await expect(page.getByTestId("add-config")).toBeVisible();
  await expect(row).toContainText("Ingrid Avison Sextet");

  await page.reload();
  await expect(page.getByTestId("config-sextet-edit")).toContainText("Ingrid Avison Sextet");

  // a blank Billed as falls back to the artist name on Done
  await page.getByTestId("config-edit-sextet-edit").click();
  await expect(form).toBeVisible();
  await form.getByTestId("edit-config-billing").fill("");
  await form.getByTestId("edit-config-done").click();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId("config-sextet-edit")).toContainText(ARTIST);
  await expect(page.getByTestId("config-sextet-edit")).not.toContainText("Ingrid Avison Sextet");

  await page.reload();
  await expect(page.getByTestId("config-sextet-edit")).toContainText(ARTIST);
  await expect(page.getByTestId("config-sextet-edit")).not.toContainText("Ingrid Avison Sextet");

  await removeConfig(page, "sextet-edit", "Sextet Edit");
});

test("configurations: remove asks first, Keep backs out", async ({ page }) => {
  await openSettings(page);
  await createConfig(page, "Sextet Remove");
  const row = page.getByTestId("config-sextet-remove");
  await expect(row).toBeVisible();

  await page.getByTestId("config-remove-sextet-remove").click();
  await expect(page.getByText("Remove Sextet Remove?")).toBeVisible();
  await page.getByTestId("config-remove-keep-sextet-remove").click();
  await expect(page.getByText("Remove Sextet Remove?")).toHaveCount(0);
  await expect(row).toBeVisible();
  await expect(page.getByTestId("config-edit-sextet-remove")).toBeVisible();
  await expect(page.getByTestId("config-remove-sextet-remove")).toBeVisible();

  await page.getByTestId("config-remove-sextet-remove").click();
  await expect(page.getByText("Remove Sextet Remove?")).toBeVisible();
  await page.getByTestId("config-remove-yes-sextet-remove").click();
  await expect(row).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("config-trio")).toBeVisible();
  await expect(page.getByTestId("config-sextet-remove")).toHaveCount(0);
});

test("links: add one (https added), edit it, delete it; it survives a reload", async ({ page }) => {
  await openSettings(page);
  const card = page.getByTestId("links");
  await expect(card.getByTestId("link-spotify")).toBeVisible(); // seeded
  await card.getByTestId("link-add-kind").selectOption("tiktok");
  await card.getByTestId("link-add-url").fill("tiktok.com/@ingridavison");
  await card.getByTestId("link-add-save").click();
  await expect(card.getByTestId("link-tiktok-url")).toHaveValue("https://tiktok.com/@ingridavison");
  // Taken platforms leave the Add list.
  await expect(card.getByTestId("link-add-kind").locator("option[value=tiktok]")).toHaveCount(0);
  await card.getByTestId("link-tiktok-url").fill("https://www.tiktok.com/@ingrid");
  await card.getByTestId("link-tiktok-url").blur();
  await expect(page.getByTestId("save-status").first()).toHaveText("Saved");
  await page.reload();
  await expect(card.getByTestId("link-tiktok-url")).toHaveValue("https://www.tiktok.com/@ingrid");

  await card.getByTestId("link-tiktok-delete").click();
  await expect(card.getByTestId("link-tiktok")).toHaveCount(0);
  await expect(page.getByTestId("save-status").first()).toHaveText("Saved");
  await page.reload();
  await expect(card.getByTestId("link-spotify")).toBeVisible();
  await expect(card.getByTestId("link-tiktok")).toHaveCount(0);
});
