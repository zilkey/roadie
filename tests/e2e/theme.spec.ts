import { test, expect, type Page } from "@playwright/test";

// Theme: the avatar menu's Auto / Light / Dark. It's saved on the person (userPrefs), so it survives a reload and a
// fresh browser; Auto leaves the colours to the device.

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

const theme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
const bg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("the avatar menu pins Dark or Light on every device, and Auto follows the device again", async ({ page, browser }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signInAs(page, "nora");
  const light = await bg(page);
  await page.getByTestId("account-menu").click();
  await expect(page.getByTestId("theme-auto")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("theme-dark").click();
  // the menu stays open, and the page turns dark although the device says light
  await expect(page.getByTestId("theme-dark")).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => theme(page)).toBe("dark");
  await expect.poll(() => bg(page)).not.toBe(light);

  // it's on the profile: another browser signed in as the same person gets it too
  const other = await browser.newPage();
  await other.emulateMedia({ colorScheme: "light" });
  await signInAs(other, "nora");
  await expect.poll(() => theme(other)).toBe("dark");
  await other.close();

  // Light pins light on a dark device
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByTestId("theme-light").click();
  await expect.poll(() => theme(page)).toBe("light");
  await expect.poll(() => bg(page)).toBe(light);
  await page.reload();
  await expect.poll(() => theme(page)).toBe("light");

  // Auto: back to the device's (dark) colours
  await page.getByTestId("account-menu").click();
  await page.getByTestId("theme-auto").click();
  await expect.poll(() => theme(page)).toBeNull();
  await expect.poll(() => bg(page)).not.toBe(light);
});
