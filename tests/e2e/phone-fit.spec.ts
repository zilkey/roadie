import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

// #22: on a phone every main page fits the width, and the top bar, tab bar and Roadie pill stack without overlapping,
// at 375 and 390px, light and dark, and with larger text (a 20px root, as a browser text-size setting gives rem).

async function signIn(page: Page) {
  await page.goto("/signin");
  await page.getByTestId("dev-ingrid").click();
  await expect(page).toHaveURL(/\/calendar$/);
}

/** The pages to check: Calendar, Money, the shows and songs lists, and the first show and song in them. */
async function pages(page: Page) {
  await page.goto(A("/shows"));
  const show = await page.locator('a[href*="/shows/"]:not([href*="/shows/new"])').first().getAttribute("href");
  await page.goto(A("/songs"));
  const song = await page.locator('a[href*="/songs/"]:not([href$="/new"])').first().getAttribute("href");
  expect(show).toBeTruthy();
  expect(song).toBeTruthy();
  return [A("/calendar"), A("/money"), A("/shows"), show!, A("/songs"), song!];
}

async function check(page: Page, url: string, label: string) {
  await page.goto(url);
  await expect(page.getByTestId("phonebar")).toBeVisible();
  await expect(page.getByTestId("roadie-pill")).toBeVisible();
  await expect(page.locator("main h1").first()).toBeVisible();
  const m = await page.evaluate(() => {
    const box = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
    return { scrollW: document.documentElement.scrollWidth, w: window.innerWidth, bar: box("phonebar"), tabs: box("bottom-tabs"), pill: box("roadie-pill") };
  });
  console.log(`${label}: scrollW ${m.scrollW}/${m.w}, bar ${m.bar.height}, tabs ${m.tabs.height}, pill ${m.pill.height} with ${m.tabs.top - m.pill.bottom}px gap`);
  expect(m.scrollW, `${label}: no sideways scroll`).toBeLessThanOrEqual(m.w);
  expect(m.pill.bottom, `${label}: pill clears the tab bar`).toBeLessThanOrEqual(m.tabs.top);
  expect(m.tabs.top - m.pill.bottom, `${label}: pill sits just above the tab bar`).toBeLessThanOrEqual(12);
  expect(m.pill.right, `${label}: pill fits the width`).toBeLessThanOrEqual(m.w);
  return m;
}

for (const width of [375, 390]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`phone fit at ${width}px, ${scheme}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 812 });
      await page.emulateMedia({ colorScheme: scheme });
      await signIn(page);
      const urls = await pages(page);
      for (const url of urls) {
        const m = await check(page, url, url);
        expect(m.bar.height).toBe(48);
        expect(m.tabs.height).toBe(56);
      }
    });
  }
}

test("phone fit at 375px with larger text", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  // A 20px root is what a 125% browser text size does to rem; sizes in rem grow, the layout still has to fit.
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("style");
    s.textContent = "html { font-size: 20px }";
    document.head.append(s);
  }));
  await signIn(page);
  const urls = await pages(page);
  for (const url of urls) {
    const m = await check(page, url, `${url} @20px`);
    expect(m.tabs.height, "the tab bar grows with the text").toBe(70);
    expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("18.75px");
  }
});
