import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";
import { dateInBandZone } from "../../src/lib/timezone";
import { addDays } from "../../src/lib/shows";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
}

test("a house concert has hosts and a city, no venue; it can move to a venue and back", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/shows/new"));
  await page.getByTestId("show-where").selectOption("house");
  await expect(page.getByTestId("show-venue")).toHaveCount(0);
  await page.getByTestId("show-host-add").selectOption({ label: "Dana Ortiz" });
  await expect(page.getByTestId("show-hosts")).toContainText("Dana Ortiz");
  await expect(page.getByTestId("show-save")).toBeDisabled(); // no city yet
  await page.getByTestId("show-city").fill("Lyons");
  await page.getByTestId("show-address-input").fill("4 Canyon Rd");
  await page.getByTestId("show-date").fill(addDays(dateInBandZone(), 230));
  await page.getByTestId("show-calendar").uncheck();
  await page.getByTestId("show-save").click();

  await expect(page.getByTestId("show-page")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("House concert · Dana Ortiz");
  await expect(page.getByTestId("where-maps")).toContainText("4 Canyon Rd");
  const url = page.url();

  // Where & when: switch to a venue (Save), then back to the house.
  const ww = page.getByTestId("where-when");
  await ww.getByTestId("where-when-edit").click();
  await ww.getByTestId("where-kind").selectOption("venue");
  await ww.getByTestId("where-venue-select").selectOption({ label: "Hi-Dive · Denver" });
  await ww.getByTestId("where-when-save").click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hi-Dive");
  await ww.getByTestId("where-when-edit").click();
  await ww.getByTestId("where-kind").selectOption("house");
  await ww.getByTestId("where-city").fill("Lyons");
  await ww.getByTestId("where-when-save").click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("House concert · Dana Ortiz");

  // The host's contact page lists the show.
  await page.goto(A("/booking"));
  await page.getByPlaceholder(/Search/).fill("Dana Ortiz");
  await page.getByText("Dana Ortiz").first().click();
  await expect(page.getByTestId("hosted-shows")).toContainText("House concert · Dana Ortiz");
  await page.getByTestId("hosted-shows").getByText("House concert · Dana Ortiz").click();
  await expect(page).toHaveURL(url);
});
