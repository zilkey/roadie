import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

test("Pitch List filters: category, city or state, venue type (hidden for festivals)", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/booking/pitches"));
  const list = page.getByTestId("pitch-list");
  const row = (name: string) => list.locator("tr", { hasText: name });
  await expect(row("Fox Theatre")).toHaveCount(1);

  await page.getByTestId("pitch-category-filter").selectOption("festival");
  await expect(row("Rocky Mountain Folks Festival")).toHaveCount(1);
  await expect(row("Fox Theatre")).toHaveCount(0);
  await expect(page.getByTestId("pitch-type-filter")).toHaveCount(0); // venue types mean nothing to festivals
  await page.getByTestId("pitch-category-filter").selectOption("venue");
  await expect(row("Rocky Mountain Folks Festival")).toHaveCount(0);
  await expect(row("Fox Theatre")).toHaveCount(1);

  // Place: states first, then towns, from what is on the list; a festival's town counts too.
  const place = page.getByTestId("pitch-place-filter");
  await expect(place.locator("optgroup[label='States'] option")).toHaveText(["CO"]);
  await place.selectOption({ label: "Boulder, CO" });
  await expect(row("Fox Theatre")).toHaveCount(1);
  await expect(row("Dairy Arts Center")).toHaveCount(1);
  await expect(row("Lost Lake Lounge")).toHaveCount(0);

  await page.getByTestId("pitch-type-filter").selectOption({ label: "Theater" });
  await expect(row("Fox Theatre")).toHaveCount(1);
  await expect(row("Dairy Arts Center")).toHaveCount(0);

  await page.getByTestId("pitch-category-filter").selectOption("");
  await place.selectOption("");
  await page.getByTestId("pitch-type-filter").selectOption("");
  await place.selectOption({ label: "Lyons, CO" });
  await expect(row("Rocky Mountain Folks Festival")).toHaveCount(1);
  await expect(list.locator("tbody tr")).toHaveCount(1);
});

test("Festivals tab: deadline and dates columns sort on the server, kept in ?sort=", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/booking/festivals"));
  const names = page.getByTestId("booking-list").locator("tbody tr td.name");
  await expect(names).toHaveText(["Levitt Pavilion Summer Series", "Rocky Mountain Folks Festival", "Underground Music Showcase"]);

  await page.getByTestId("sort-deadline").click();
  await expect(page).toHaveURL(/sort=deadline/);
  await expect(names).toHaveText(["Rocky Mountain Folks Festival", "Underground Music Showcase", "Levitt Pavilion Summer Series"]);
  await expect(page.getByTestId("booking-list").locator("tr", { hasText: "Underground" }).locator("[data-testid^='deadline-']")).toHaveText("Jan 15 (target)");
  await page.getByTestId("sort-deadline").click();
  await expect(page).toHaveURL(/sort=-deadline/);
  await expect(names).toHaveText(["Levitt Pavilion Summer Series", "Underground Music Showcase", "Rocky Mountain Folks Festival"]);

  // By date: Levitt has no dates, so it goes last either way.
  await page.getByTestId("sort-date").click();
  await expect(names).toHaveText(["Underground Music Showcase", "Rocky Mountain Folks Festival", "Levitt Pavilion Summer Series"]);
  await expect(page.getByTestId("booking-list").locator("tr", { hasText: "Rocky" }).locator("[data-testid^='dates-']")).toHaveText("Aug 20–Aug 22");

  // The sort survives a reload; the search runs on the server too.
  await page.reload();
  await expect(names).toHaveText(["Underground Music Showcase", "Rocky Mountain Folks Festival", "Levitt Pavilion Summer Series"]);
  await page.getByTestId("booking-search").fill("priya");
  await expect(names).toHaveText(["Underground Music Showcase"]);
});

test("venue type: Other… adds a type for everyone; Settings lists it", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-add-actions").click();
  await page.getByTestId("add-venue").click();
  const type = page.getByTestId("new-venue-type");
  await expect(type.locator("option", { hasText: "Winery" })).toHaveCount(1); // the seed added it
  await type.selectOption("__new");
  await page.getByTestId("new-venue-type-new").fill("Cidery");
  await page.getByTestId("new-venue-type-add").click();
  await expect(type).toHaveValue("cidery");
  await page.getByTestId("new-venue-name").fill("Stem Ciders");
  await page.getByTestId("new-venue-city").fill("Lafayette");
  await page.getByTestId("new-venue-submit").click();
  await expect(page.getByTestId("venue-page")).toContainText("Cidery");

  await page.goto(A("/admin/venue-types"));
  await expect(page.getByTestId("venue-type-cidery")).toContainText("1");
  await expect(page.getByTestId("venue-type-remove-cidery")).toBeDisabled();
  await expect(page.getByTestId("venue-type-remove-winery")).toBeEnabled();
});
