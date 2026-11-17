import { test, expect, type Page } from "@playwright/test";

// Tenancy phase 5: the browser asks Firestore only for the open artist. Olga is the only admin of Fern Valley Trio, the seed's second
// artist. Firestore's rules are per artist too (an admin reads only the artists she belongs to), and the hooks' artist filter
// narrows each screen to the open one, so Nora Quill Band's songs, money and people stay off hers.

const FERN = (p: string) => `/artists/fern-valley-trio${p}`;
/** Nora Quill Band's, from scripts/seed.ts: none may show up in Fern Valley. */
const NORA_SONGS = ["Halfway Home", "Untitled (bridge idea)"];
const NORA_MONEY = ["Bass strings and cables", "3 days tracking", "Room rental"];
const NORA_PEOPLE = ["Rudy", "Nora", "Hugo", "Felix", "Iris"];

async function signInAsOlga(page: Page) {
  await page.goto("/signin");
  await page.getByTestId("dev-olga").click();
  await expect(page).toHaveURL(/\/calendar$/);
}

async function noneOf(page: Page, names: string[]) {
  const text = await page.locator("main").innerText();
  for (const n of names) expect(text, `${n} is Nora Quill Band's`).not.toContain(n);
}

test("the second artist's admin sees only that artist's songs, money and people", async ({ page }) => {
  await signInAsOlga(page);
  await expect(page).toHaveURL(new RegExp(`${FERN("/calendar")}$`));

  await page.goto(FERN("/songs"));
  await expect(page.locator("main")).toContainText("Low Meadow");
  await noneOf(page, NORA_SONGS);

  await page.goto(FERN("/money"));
  await expect(page.locator("main")).toContainText("Fern Valley van rental");
  await noneOf(page, NORA_MONEY);

  await page.goto(FERN("/money/people"));
  await expect(page.locator("main")).toContainText("Olga");
  await noneOf(page, NORA_PEOPLE.filter((n) => n !== "Nora")); // "Nora" may be part of other words; checked on People below

  await page.goto(FERN("/admin/people"));
  await expect(page.locator("main")).toContainText("Olga Park");
  await noneOf(page, ["Rudy", "Hugo", "Felix", "Iris", "nora@example.com"]);
});
