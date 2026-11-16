import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";
import { SEED, mmmD } from "./dates";

// Song to-dos: a song's own lists (song page › To dos), the same lists in a section per song on a show whose setlist has the
// song, and a group per list in To Dos › Songs.

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
const card = (page: Page, name: string) =>
  page.locator('section[data-testid^="checklist-"]').filter({ has: page.getByRole("heading", { name, exact: true }) });

test("a song's to-do shows on the song, on a show it's on the setlist of, and in To Dos › Songs; ticking anywhere ticks it", async ({ page }) => {
  const name = `MIDI ${Date.now().toString(36)}`;
  const label = `Configure Nord/MC6/H90/Iridium MIDI ${name}`;
  await signInAs(page, "rudy");

  // Glass Coast is on the seeded Deep End show's setlist (and on the one music.spec seeds over it).
  await page.goto(A("/songs"));
  await page.getByTestId("songs-list").getByRole("link", { name: "Glass Coast", exact: true }).click();
  await expect(page.getByTestId("song-page")).toBeVisible();
  const songUrl = page.url();
  const side = page.getByTestId("song-todos");
  await expect(side.getByRole("heading", { name: /^To dos/ })).toBeVisible();
  await side.getByTestId("new-list-actions").click();
  await page.getByRole("menuitem", { name: "Blank list", exact: true }).click();
  await side.getByTestId("new-list-name").fill(name);
  await side.getByTestId("new-list-add").click();
  const c = card(page, name);
  await expect(c).toBeVisible();
  const id = (await c.getAttribute("data-testid"))!.replace("checklist-", "");
  await c.getByTestId(`checklist-add-${id}`).fill(label);
  await c.getByTestId(`checklist-add-${id}`).press("Enter");
  await expect(c.getByTestId(`checklist-count-${id}`)).toHaveText("0 of 1");

  // To Dos › Songs: a group "Glass Coast › MIDI …".
  await page.goto(A("/todos"));
  const songs = page.getByTestId("todos-col-songs");
  await expect(songs.getByRole("heading", { name: "Songs", exact: true })).toBeVisible();
  await expect(songs.getByText(label)).toBeVisible();
  await expect(songs.getByRole("link", { name: "Glass Coast" }).first()).toBeVisible();

  // The show: a Songs section, Glass Coast its own section; ticking there ticks the song's list.
  await page.goto(A("/shows"));
  await page.getByTestId("shows-row").filter({ hasText: "Deep End" }).filter({ hasText: mmmD(SEED.deepEnd) }).first().locator("td.date a").click();
  await expect(page.getByTestId("show-page")).toBeVisible();
  const section = page.getByTestId("song-todos").locator('[data-testid^="song-todos-"]').filter({ hasText: "Glass Coast" });
  await expect(section.getByTestId("song-todos-title")).toHaveText("Glass Coast");
  const box = section.getByRole("checkbox", { name: `Done: ${label}` });
  await box.click();
  // Its last item ticked, the list folds shut to its title and count (and stays on the show until the page is left).
  await expect(section.getByTestId(`checklist-count-${id}`)).toHaveText("1 of 1");

  await page.goto(songUrl);
  await expect(card(page, name).getByTestId(`checklist-count-${id}`)).toHaveText("1 of 1");
});
