import { test, expect, type Page } from "@playwright/test";
import { A, openTab } from "./env";

// Checklists beyond shows: a release's own lists in its page's sidebar, and the Social Media lists, one set shared by every
// Social Media page (Posts, Photos, a post's editor).

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
/** The card of the list with this exact name. */
const card = (page: Page, name: string) =>
  page.locator('section[data-testid^="checklist-"]').filter({ has: page.getByRole("heading", { name, exact: true }) });
const listId = async (c: ReturnType<typeof card>) => (await c.getAttribute("data-testid"))!.replace("checklist-", "");

async function addBlankList(page: Page, name: string) {
  const side = page.getByTestId("checklists");
  await side.getByTestId("new-list-actions").click();
  await page.getByRole("menuitem", { name: "Blank list", exact: true }).click();
  await side.getByTestId("new-list-name").fill(name);
  await side.getByTestId("new-list-add").click();
  const c = card(page, name);
  await expect(c).toBeVisible();
  return c;
}

test("an admin keeps a checklist on a release: a blank list, an item ticked off, another pinned to To Dos", async ({ page }) => {
  await signInAs(page, "rudy");
  await openTab(page, "releases");
  await page.getByTestId("add-release-btn").click();
  await expect(page.getByTestId("new-release")).toBeVisible();
  await page.getByTestId("new-release").getByTestId("release-title").fill("Checklist Single");
  await page.getByTestId("release-kind-single").check();
  await page.getByTestId("create-release").click();
  await expect(page.getByTestId("release-page")).toBeVisible();

  const side = page.getByRole("complementary", { name: "Checklists" });
  await expect(side.getByTestId("checklists-empty")).toBeVisible();
  const c = await addBlankList(page, "Release week");
  const id = await listId(c);
  await expect(c.getByTestId(`checklist-count-${id}`)).toHaveText("0 of 0");

  const add = c.getByTestId(`checklist-add-${id}`);
  await add.fill("Upload to the distributor");
  await add.press("Enter");
  await expect(c.getByTestId(`checklist-count-${id}`)).toHaveText("0 of 1");
  await add.fill("Pitch to playlists");
  await add.press("Enter");
  await expect(c.getByTestId(`checklist-count-${id}`)).toHaveText("0 of 2");

  const done = c.getByRole("checkbox", { name: "Done: Upload to the distributor" });
  await done.click();
  await expect(done).toBeChecked();
  await expect(c.getByTestId(`checklist-count-${id}`)).toHaveText("1 of 2");

  await c.getByRole("button", { name: "Pin Pitch to playlists to To Dos" }).click();
  await expect(c.getByRole("button", { name: "Unpin Pitch to playlists from To Dos" })).toBeVisible();
  await expect(c.getByText("On To Dos")).toBeVisible();

  // the lists stay with the release, whichever tab is open
  await page.getByTestId("release-tab-files").click();
  await expect(card(page, "Release week").getByTestId(`checklist-count-${id}`)).toHaveText("1 of 2");
  await page.reload();
  await expect(card(page, "Release week").getByRole("checkbox", { name: "Done: Upload to the distributor" })).toBeChecked();
});

test("a Social Media list added on Posts is the same list on Photos", async ({ page }) => {
  await signInAs(page, "rudy");
  const name = `Promo ${Date.now().toString(36)}`;
  await page.goto(A("/posts"));
  await expect(page.getByTestId("posts-tab")).toBeVisible();
  const c = await addBlankList(page, name);
  const id = await listId(c);
  const add = c.getByTestId(`checklist-add-${id}`);
  await add.fill("Share the poster to Stories");
  await add.press("Enter");
  await expect(c.getByTestId(`checklist-count-${id}`)).toHaveText("0 of 1");

  await page.getByTestId("posts-tab-photos").click();
  await expect(page).toHaveURL(/\/posts\/photos/);
  const there = card(page, name);
  await expect(there).toBeVisible();
  await expect(there.getByText("Share the poster to Stories")).toBeVisible();
  // the Photos page itself is still all there beside it
  await expect(page.getByTestId("photos-upload-input")).toBeAttached();
});
