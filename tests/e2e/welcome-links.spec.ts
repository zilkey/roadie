import { test, expect } from "@playwright/test";
import { A } from "./env";

test("links from the sign-up flow: validate, save once, land on Ready, shown in Settings", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-jeff").click();
  await expect(page).toHaveURL(/\/calendar$/);

  await page.goto(A("/welcome/links"));
  await expect(page.getByTestId("welcome-links")).toBeVisible();
  await expect(page.getByTestId("wl-more-fields")).toHaveCount(0);
  await page.getByTestId("wl-more").click();
  await expect(page.getByTestId("wl-more-fields")).toBeVisible();

  await page.getByTestId("wl-website").fill("welcome-links.example");
  await page.getByTestId("wl-instagram").fill("@welcomelinks");
  await page.getByTestId("wl-signal").fill("https://example.com/not-signal");
  await expect(page.getByTestId("wl-signal-hint")).toBeVisible();
  await expect(page.getByTestId("wl-save")).toBeDisabled();
  await page.getByTestId("wl-signal").fill("https://signal.group/#CjQKIabc");
  await expect(page.getByTestId("wl-signal-hint")).toHaveCount(0);
  await page.getByTestId("wl-save").click();

  await expect(page).toHaveURL(/\/welcome$/);
  await page.goto(A("/admin/artist"));
  await expect(page.getByTestId("link-instagram-url")).toHaveValue("https://instagram.com/welcomelinks");
  await expect(page.getByTestId("link-website-url")).toHaveValue("https://welcome-links.example");
  await expect(page.getByTestId("signal-group-url")).toHaveValue("https://signal.group/#CjQKIabc");
});
