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
  await page.getByTestId("show-where-house").click();
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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("House concert · Dana Ortiz");
  await expect(page.getByTestId("show-address")).toHaveText("4 Canyon Rd");
  const url = page.url();

  // Edit: switch to a venue (autosave), then back to the house.
  await page.getByTestId("show-edit").click();
  await page.getByTestId("show-where-venue").click();
  await page.getByTestId("show-venue").selectOption({ label: "Hi-Dive · Denver" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hi-Dive");
  await page.getByTestId("show-where-house").click();
  await page.getByTestId("show-city").fill("Lyons"); // the form keeps what was typed; a fresh blur saves it
  await page.getByTestId("show-city").blur();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("House concert · Dana Ortiz");

  // The host's contact page lists the show.
  await page.goto(A("/booking"));
  await page.getByPlaceholder(/Search/).fill("Dana Ortiz");
  await page.getByText("Dana Ortiz").first().click();
  await expect(page.getByTestId("hosted-shows")).toContainText("House concert · Dana Ortiz");
  await page.getByTestId("hosted-shows").getByText("House concert · Dana Ortiz").click();
  await expect(page).toHaveURL(url);
});
