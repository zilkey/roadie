import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

const ARTIST = "Nora Quill Band";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
}

async function openSettings(page: Page) {
  await signInAs(page, "rudy");
  await expect(page).toHaveURL(/\/calendar$/);
  await page.goto(A("/admin/lineups"));
  await expect(page.getByTestId("configs")).toBeVisible();
  await expect(page.getByTestId("config-trio")).toBeVisible(); // seeded, so the card has loaded
}

async function openArtist(page: Page) {
  await page.goto(A("/admin/artist"));
  await expect(page.getByTestId("links")).toBeVisible();
}

async function removeConfig(page: Page, id: string, name: string) {
  await page.getByTestId(`config-remove-${id}`).click();
  await expect(page.getByText(`Remove ${name}?`)).toBeVisible();
  await page.getByTestId(`config-remove-yes-${id}`).click();
  await expect(page.getByTestId(`config-${id}`)).toHaveCount(0);
}

test("Lineups and links: add a configuration (needs a name, billed-as falls back), edit autosaves and Done closes, remove asks first; then add, edit and delete a link", async ({ page }) => {
  await openSettings(page);
  await page.getByTestId("add-config").click();
  const form = page.getByTestId("new-config");
  await expect(form).toBeVisible();
  const name = form.getByTestId("new-config-name");
  const billing = form.getByTestId("new-config-billing");
  const add = form.getByTestId("new-config-add");
  await expect(billing).toHaveAttribute("placeholder", ARTIST);
  await name.fill("");
  await expect(add).toBeDisabled();
  await name.fill("   ");
  await expect(add).toBeDisabled();
  await name.fill("Sextet E2E");
  await expect(add).toBeEnabled();
  for (const who of ["Hugo", "Nora"]) {
    const chip = form.getByRole("button", { name: who });
    if ((await chip.getAttribute("aria-pressed")) !== "true") await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
  }
  await billing.fill("");
  await add.click();
  await expect(form).toHaveCount(0);

  const row = page.getByTestId("config-sextet-e2e");
  await expect(row).toContainText(ARTIST);
  await expect(row).toContainText("Hugo");
  await expect(row).toContainText("Nora");
  await page.reload();
  await expect(row).toContainText(ARTIST);
  await expect(row).toContainText("Hugo");
  await expect(row).toContainText("Nora");

  // Cancel adds no row and discards the draft
  await page.getByTestId("add-config").click();
  await expect(form).toBeVisible();
  await name.fill("Sextet Cancel");
  await form.getByTestId("new-config-cancel").click();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId("config-sextet-cancel")).toHaveCount(0);
  await page.getByTestId("add-config").click();
  await expect(name).toHaveValue("");
  await form.getByTestId("new-config-cancel").click();

  // edit autosaves, Done closes
  await page.getByTestId("config-edit-sextet-e2e").click();
  const edit = page.getByTestId("edit-config");
  await expect(edit).toBeVisible();
  await edit.getByTestId("edit-config-billing").fill("Nora Quill Sextet");
  await expect(page.getByTestId("save-status").first()).toHaveText("Saved");
  await edit.getByTestId("edit-config-done").click();
  await expect(edit).toHaveCount(0);
  await expect(row).toContainText("Nora Quill Sextet");
  await page.reload();
  await expect(row).toContainText("Nora Quill Sextet");

  // a blank Billed as falls back to the artist name
  await page.getByTestId("config-edit-sextet-e2e").click();
  await expect(edit).toBeVisible();
  await edit.getByTestId("edit-config-billing").fill("");
  await edit.getByTestId("edit-config-done").click();
  await expect(edit).toHaveCount(0);
  await expect(row).toContainText(ARTIST);
  await expect(row).not.toContainText("Nora Quill Sextet");

  // remove asks first; Keep backs out
  await page.getByTestId("config-remove-sextet-e2e").click();
  await expect(page.getByText("Remove Sextet E2E?")).toBeVisible();
  await page.getByTestId("config-remove-keep-sextet-e2e").click();
  await expect(page.getByText("Remove Sextet E2E?")).toHaveCount(0);
  await expect(row).toBeVisible();
  await removeConfig(page, "sextet-e2e", "Sextet E2E");
  await page.reload();
  await expect(page.getByTestId("config-trio")).toBeVisible();
  await expect(page.getByTestId("config-sextet-e2e")).toHaveCount(0);

  // Same sign-in, next page: the artist settings' links.
  await openArtist(page);
  const card = page.getByTestId("links");
  await expect(card.getByTestId("link-spotify")).toBeVisible(); // seeded
  await card.getByTestId("link-add-kind").selectOption("tiktok");
  await card.getByTestId("link-add-url").fill("tiktok.com/@noraquill");
  await card.getByTestId("link-add-save").click();
  await expect(card.getByTestId("link-tiktok-url")).toHaveValue("https://tiktok.com/@noraquill");
  // Taken platforms leave the Add list.
  await expect(card.getByTestId("link-add-kind").locator("option[value=tiktok]")).toHaveCount(0);
  await card.getByTestId("link-tiktok-url").fill("https://www.tiktok.com/@nora");
  await card.getByTestId("link-tiktok-url").blur();
  await expect(page.getByTestId("save-status").first()).toHaveText("Saved");
  await page.reload();
  await expect(card.getByTestId("link-tiktok-url")).toHaveValue("https://www.tiktok.com/@nora");

  await card.getByTestId("link-tiktok-delete").click();
  await expect(card.getByTestId("link-tiktok")).toHaveCount(0);
  await expect(page.getByTestId("save-status").first()).toHaveText("Saved");
  await page.reload();
  await expect(card.getByTestId("link-spotify")).toBeVisible();
  await expect(card.getByTestId("link-tiktok")).toHaveCount(0);
});

test("Genres on General Settings: added in lowercase, no duplicates, autosaved, removed with ×", async ({ page }) => {
  await signInAs(page, "rudy");
  await expect(page).toHaveURL(/\/calendar$/); // signed in before the next page load
  await openArtist(page);
  const card = page.getByTestId("genres");
  await card.getByTestId("genre-add-input").fill("  Indie   Folk ");
  await card.getByTestId("genre-add-save").click();
  await card.getByTestId("genre-add-input").fill("indie folk");
  await card.getByTestId("genre-add-input").press("Enter");
  await expect(card.getByTestId("genres-list").locator(".chip")).toHaveText(["indie folk×"]);
  await expect(page.getByTestId("save-status").first()).toHaveText("Saved");
  await page.reload();
  await expect(card.getByTestId("genre-indie folk")).toBeVisible();
  await card.getByTestId("genre-remove-indie folk").click();
  await expect(card.getByTestId("genres-empty")).toBeVisible();
  await expect(page.getByTestId("save-status").first()).toHaveText("Saved");
  await page.reload();
  await expect(card.getByTestId("genres-empty")).toBeVisible();
});
