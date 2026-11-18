import { test, expect, type Page } from "@playwright/test";
import { openTab } from "./env";

// Wes Marlow (scripts/seed.ts) is a member of both seeded bands. His default expense project is Duo in Nora Quill Band and Recording in
// Fern Valley Trio; neither is a band's default project (General), so the card's project tells his default from the band's.
// Each band's Money page must show only that band's expense, and each expense must land on that band's project.

const BANDS = [
  { slug: "nora-quill-band", name: "Nora Quill Band", project: "Duo", what: `Capo and strings ${Date.now()}` },
  { slug: "fern-valley-trio", name: "Fern Valley Trio", project: "Recording", what: `Banjo picks ${Date.now()}` },
] as const;

/** Signs in as Wes. Two bands means the sign-in lands on the band picker. */
async function signInAsWes(page: Page) {
  await page.goto("/signin");
  await page.getByTestId("dev-wes").click();
  await expect(page.getByTestId("artist-picker")).toBeVisible();
}

/** The "+ New expense" form on the open band's Money page: category and project are left alone, so the project is his default there. */
async function addExpense(page: Page, what: string) {
  await page.getByTestId("add-expense-link").click();
  await page.getByTestId("exp-amount").fill("18");
  await page.getByTestId("expense-what").fill(what);
  await page.getByTestId("exp-save").click();
  await expect(page).toHaveURL(/\/money$/);
}

/** The open band's Money page shows this band's expense (on the project) and none of the other band's. */
async function expectOnlyThisBand(page: Page, mine: (typeof BANDS)[number], other: (typeof BANDS)[number]) {
  const main = page.locator("main");
  const row = page.getByTestId("my-money-table").locator('[data-testid^="my-money-row-"]', { hasText: mine.what });
  await expect(row).toContainText(mine.project);
  await expect(row).toContainText("$18.00");
  await expect(main).not.toContainText(other.what);
  await expect(main).not.toContainText("Fern Valley van rental"); // Olga's, in Fern Valley Trio: never Wes's
}

test("a member of two bands logs an expense in each, on that band's project, and each Money page shows only its own", async ({ page }) => {
  const [nora, fern] = BANDS;
  await signInAsWes(page);
  await page.getByTestId(`artist-${nora.slug}`).click();
  await expect(page).toHaveURL(new RegExp(`/artists/${nora.slug}/calendar$`));
  await expect(page.getByTestId("current-artist")).toHaveText(nora.name);

  await openTab(page, "money");
  await addExpense(page, nora.what);
  await expectOnlyThisBand(page, nora, fern);

  // Switch with the band menu.
  await page.getByTestId("band-menu").click();
  await page.getByTestId(`band-menu-artist-${fern.slug}`).click();
  await expect(page).toHaveURL(new RegExp(`/artists/${fern.slug}/`));
  await expect(page.getByTestId("current-artist")).toHaveText(fern.name);

  await openTab(page, "money");
  await expect(page.getByTestId("add-expense-link").first()).toBeVisible();
  await expect(page.locator("main")).not.toContainText(nora.what); // nothing of Nora Quill Band's here
  await addExpense(page, fern.what);
  await expectOnlyThisBand(page, fern, nora);

  // And back: Nora Quill Band still has only its own.
  await page.getByTestId("band-menu").click();
  await page.getByTestId(`band-menu-artist-${nora.slug}`).click();
  await expect(page.getByTestId("current-artist")).toHaveText(nora.name);
  await openTab(page, "money");
  await expectOnlyThisBand(page, nora, fern);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Switch band in the account menu reaches the other band, whose Money page shows only its own expense", async ({ page }) => {
    const [nora, fern] = BANDS;
    const noraWhat = `Phone tuner ${Date.now()}`;
    const fernWhat = `Phone cable ${Date.now()}`;
    await signInAsWes(page);
    await page.getByTestId(`artist-${nora.slug}`).click();
    await expect(page).toHaveURL(new RegExp(`/artists/${nora.slug}/calendar$`));

    await page.goto(`/artists/${nora.slug}/money`);
    await addExpense(page, noraWhat);

    await page.getByTestId("account-menu-mobile").click();
    await page.getByTestId("switch-artist-mobile").click();
    await expect(page.getByTestId("artist-picker")).toBeVisible();
    await page.getByTestId(`artist-${fern.slug}`).click();
    await expect(page).toHaveURL(new RegExp(`/artists/${fern.slug}/calendar$`));

    await page.goto(`/artists/${fern.slug}/money`);
    await expect(page.getByTestId("add-expense-link").first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText(noraWhat);
    await addExpense(page, fernWhat);
    const row = page.getByTestId("my-money-table").locator('[data-testid^="my-money-row-"]', { hasText: fernWhat });
    await expect(row).toContainText(fern.project);
    await expect(page.locator("main")).not.toContainText(noraWhat);
  });
});
