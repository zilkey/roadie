import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { A, APP, AUTH, FIRESTORE, ARTIST_SLUG } from "./env";

const ARTIST = "Nora Quill Band";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
}

/**
 * Drops Rudy's unsaved Lineups draft, if an earlier test left one (a page closed before its last save's draft was
 * cleared): opening the page would restore it and replay it over what this test does.
 */
async function clearLineupsDraft(request: APIRequestContext) {
  const t = await request.post(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo`, {
    data: { postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: "dev-rudy", email: "rudy@example.com", email_verified: true, name: "Rudy" }))}&providerId=google.com`, requestUri: "http://localhost", returnIdpSignInMethod: true, returnSecureToken: true },
  });
  const token = ((await t.json()) as { idToken: string }).idToken;
  const a = await request.get(`http://${FIRESTORE}/v1/projects/demo-band-tracker/databases/(default)/documents/artists`, { headers: { authorization: "Bearer owner" } });
  const docs = ((await a.json()) as { documents: { name: string; fields: { slug?: { stringValue: string } } }[] }).documents;
  const artistId = docs.find((x) => x.fields.slug?.stringValue === ARTIST_SLUG)!.name.split("/").pop()!;
  const r = await request.post(`${APP}/api/commands/drafts.clear`, { data: { path: `artists/${artistId}#lineups` }, headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } });
  expect(r.ok(), await r.text()).toBeTruthy();
}

async function openSettings(page: Page) {
  await clearLineupsDraft(page.request);
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

test("Lineups: add a configuration (needs a name, billed-as falls back), edit autosaves and Done closes, remove asks first", async ({ page }) => {
  // a name of its own, so a retry never meets the first attempt's row
  const stamp = String(Date.now() % 100000);
  const NAME = `Sextet E2E ${stamp}`, ID = `sextet-e2e-${stamp}`;
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
  await name.fill(NAME);
  await expect(add).toBeEnabled();
  for (const who of ["Hugo", "Nora"]) {
    const chip = form.getByRole("button", { name: who });
    if ((await chip.getAttribute("aria-pressed")) !== "true") await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
  }
  await billing.fill("");
  await add.click();
  await expect(form).toHaveCount(0);

  const row = page.getByTestId(`config-${ID}`);
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
  await page.getByTestId(`config-edit-${ID}`).click();
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
  await page.getByTestId(`config-edit-${ID}`).click();
  await expect(edit).toBeVisible();
  await edit.getByTestId("edit-config-billing").fill("");
  await edit.getByTestId("edit-config-done").click();
  await expect(edit).toHaveCount(0);
  await expect(row).toContainText(ARTIST);
  await expect(row).not.toContainText("Nora Quill Sextet");

  // remove asks first; Keep backs out
  await page.getByTestId(`config-remove-${ID}`).click();
  await expect(page.getByText(`Remove ${NAME}?`)).toBeVisible();
  await page.getByTestId(`config-remove-keep-${ID}`).click();
  await expect(page.getByText(`Remove ${NAME}?`)).toHaveCount(0);
  await expect(row).toBeVisible();
  await removeConfig(page, ID, NAME);
  await page.reload();
  await expect(page.getByTestId("config-trio")).toBeVisible();
  await expect(page.getByTestId(`config-${ID}`)).toHaveCount(0);
});

test("Links on General Settings: add a link, edit it, delete it", async ({ page }) => {
  await signInAs(page, "rudy");
  await expect(page).toHaveURL(/\/calendar$/);
  await openArtist(page);
  const card = page.getByTestId("links");
  await expect(card.getByTestId("link-spotify")).toBeVisible(); // seeded
  // a failed earlier attempt may have left the TikTok link
  if (await card.getByTestId("link-tiktok").count()) {
    await card.getByTestId("link-tiktok-delete").click();
    await expect(card.getByTestId("link-tiktok")).toHaveCount(0);
    await expect(page.getByTestId("save-status").first()).toHaveText("Saved");
    await page.reload();
    await expect(card.getByTestId("link-spotify")).toBeVisible();
  }
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
  if (await card.getByTestId("genre-indie folk").count()) { // a failed earlier attempt left it
    await card.getByTestId("genre-remove-indie folk").click();
    await expect(card.getByTestId("genres-empty")).toBeVisible();
    await expect(page.getByTestId("save-status").first()).toHaveText("Saved");
    await page.reload();
  }
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

test("Lineups: a remove made while the last edit is still saving survives a reload at once (the draft replays that save first)", async ({ page }) => {
  const stamp = String(Date.now() % 100000);
  const NAME = `Gone E2E ${stamp}`, ID = `gone-e2e-${stamp}`;
  await openSettings(page);
  await page.getByTestId("add-config").click();
  await page.getByTestId("new-config-name").fill(NAME);
  await page.getByTestId("new-config-add").click();
  const row = page.getByTestId(`config-${ID}`);
  await expect(row).toBeVisible();

  // A slow server: the edit's save is still out when Remove is tapped and the page reloads.
  let edits = 0;
  await page.route("**/api/commands/artists.update", async (r) => {
    edits++;
    await new Promise((done) => setTimeout(done, 1500));
    await r.continue().catch(() => {}); // the page that sent it may be gone by now
  });
  await page.getByTestId(`config-edit-${ID}`).click();
  await page.getByTestId("edit-config-billing").fill("Gone Billing");
  await page.getByTestId("edit-config-done").click();
  await expect.poll(() => edits).toBeGreaterThan(0); // the edit is on its way
  await page.getByTestId(`config-remove-${ID}`).click();
  await page.getByTestId(`config-remove-yes-${ID}`).click();
  await expect(row).toHaveCount(0);
  await page.reload();

  // Reopened: the draft sends the edit again (it lands once) and the removal after it, with no conflict against our own save.
  await expect(page.getByTestId("config-trio")).toBeVisible();
  await expect(page.getByTestId("save-status").first()).toHaveText("Saved", { timeout: 30_000 });
  await expect(row).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.reload();
  await expect(page.getByTestId("config-trio")).toBeVisible();
  await expect(row).toHaveCount(0);
});

test("Lineups: an Edit opened on a new configuration before its add has answered stays open", async ({ page }) => {
  const stamp = String(Date.now() % 100000);
  const NAME = `Quick E2E ${stamp}`, ID = `quick-e2e-${stamp}`;
  await openSettings(page);
  // A slow answer: the new row shows (live data) well before the add's response arrives.
  let answered = false;
  await page.route("**/api/commands/artists.update", async (r) => {
    const res = await r.fetch();
    await new Promise((done) => setTimeout(done, 2000));
    await r.fulfill({ response: res });
    answered = true;
  });
  await page.getByTestId("add-config").click();
  await page.getByTestId("new-config-name").fill(NAME);
  await page.getByTestId("new-config-add").click();
  await page.getByTestId(`config-edit-${ID}`).click();
  const edit = page.getByTestId("edit-config");
  await expect(edit).toBeVisible();
  expect(answered).toBe(false);
  await page.unrouteAll({ behavior: "wait" }); // lets the held answer through
  expect(answered).toBe(true);
  await page.waitForTimeout(300);
  await expect(edit).toBeVisible(); // the add's answer closed it before
  await edit.getByTestId("edit-config-done").click();
  await expect(edit).toHaveCount(0);
  await removeConfig(page, ID, NAME);
});
