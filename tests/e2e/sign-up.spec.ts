import { test, expect } from "@playwright/test";

// The dev "stranger" (stranger@example.com) is a Google account on no band's list. This is the only spec that signs in as
// them: starting a band changes who they are, so it all happens in one test.
test("a stranger signs in, starts a band, and ends up its admin", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-stranger").click();

  // No band yet: stays signed in, no dead end
  await expect(page).toHaveURL(/\/no-band$/);
  await expect(page.getByTestId("no-band-email")).toHaveText("stranger@example.com");
  await expect(page.getByTestId("no-band")).not.toContainText("Ask Jeff");
  await page.goto("/artists/someone-elses-band/calendar"); // band pages send them back here
  await expect(page).toHaveURL(/\/no-band$/);
  await page.getByTestId("check-again").click();
  await expect(page.getByTestId("still-no-band")).toBeVisible();

  // Name your band: nothing is created until Start a band
  await page.getByTestId("start-band").click();
  await expect(page).toHaveURL(/\/start-band$/);
  await expect(page.getByTestId("terms-link")).toHaveAttribute("href", /\/terms$/);
  await page.getByTestId("create-band").click();
  await expect(page.getByTestId("band-name-error")).toBeVisible();
  await page.getByTestId("band-name").fill("The Night Owls");
  await expect(page.getByTestId("band-slug-preview")).toHaveText("the-night-owls");
  // a taken slug is refused under the field (the seeded band already has this one)
  await page.getByTestId("slug-change").click();
  await page.getByTestId("band-slug").fill("ingrid-avison-band");
  await page.getByTestId("create-band").click();
  await expect(page.getByTestId("band-slug-error")).toHaveText("Already taken");
  await page.getByTestId("band-slug").fill("the-night-owls");
  await page.getByTestId("band-play").fill("guitar, vocals");
  await page.getByTestId("create-band").click();

  // Ready, then the app
  await expect(page).toHaveURL(/\/artists\/the-night-owls\/welcome$/);
  await expect(page.getByTestId("page-title")).toHaveText("The Night Owls is ready");
  await expect(page.getByTestId("setup-rows").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("setup-import-soon")).toBeVisible();
  await page.getByTestId("go-to-app").click();
  await expect(page).toHaveURL(/\/artists\/the-night-owls\/calendar$/);

  // Home asks them to finish setting up: three rows (import is hidden), none done. Dismiss hides it for good.
  const card = page.getByTestId("finish-setup");
  await expect(card).toContainText("Finish setting up The Night Owls");
  await expect(card.getByTestId("setup-rows").locator("li")).toHaveCount(3);
  await expect(card.getByTestId("setup-import")).toHaveCount(0);
  await expect(card.getByText("Done")).toHaveCount(0);
  await page.getByTestId("finish-setup-dismiss").click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("calendar-page")).toBeVisible();
  await expect(page.getByTestId("finish-setup")).toHaveCount(0);

  // they are the band's first admin
  await page.goto("/artists/the-night-owls/admin/people");
  await expect(page.getByTestId("page-title")).toHaveText("People");
  const row = page.getByTestId("person-row-stranger@example.com");
  await expect(row).toBeVisible();
  await expect(row.locator(".chip").first()).toHaveText("Admin");

  // and the Ready screen is still reachable later
  await page.goto("/artists/the-night-owls/welcome");
  await expect(page.getByTestId("welcome")).toBeVisible();
});
