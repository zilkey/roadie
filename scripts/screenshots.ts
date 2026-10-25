/**
 * Takes the docs/screenshots/*.png set. Needs `npm run dev:all` and `npm run seed` running.
 * Usage: npx tsx scripts/screenshots.ts [outDir]
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3100";
const OUT = process.argv[2] ?? "docs/screenshots";
const SIZES = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } } as const;
const DARK = new Set(["booking-list", "money"]);

async function session(browser: Browser, who: string, size: keyof typeof SIZES, dark: boolean) {
  const ctx = await browser.newContext({ viewport: SIZES[size], colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/signin`);
  await page.getByTestId(`dev-${who}`).click();
  await page.waitForURL(/\/calendar$/);
  return { ctx, page };
}

async function _unused(page: Page, prefix: string) {
  const h = await page.locator(`a[href^="${prefix}"]`).first().getAttribute("href");
  if (!h) throw new Error(`no link ${prefix}`);
  return h;
}

async function main() {
  // Off while the site is being redesigned: the shell and pages are mid-change, so these would only be retaken again.
  if (!process.env.SCREENSHOTS_ANYWAY) { console.log("Screenshots are off until the redesign is done (set SCREENSHOTS_ANYWAY=1 to take them)."); return; }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const report: string[] = [];
  for (const size of Object.keys(SIZES) as (keyof typeof SIZES)[]) {
    const admin = await session(browser, "jeff", size, false);
    const resolve = admin.page;
    await resolve.goto(`${BASE}/booking`);
    await resolve.getByTestId("booking-seg-pitches").click();
    await resolve.getByTestId("group-talking").getByText("Fox Theatre").click();
    await resolve.waitForURL(/\/booking\/pitches\//);
    const pitch = new URL(resolve.url()).pathname;
    await resolve.goto(`${BASE}/shows`);
    await resolve.getByTestId("shows-upcoming").locator("a").first().click();
    await resolve.waitForURL(/\/shows\/[^/]+$/);
    const show = new URL(resolve.url()).pathname;
    await resolve.goto(`${BASE}/setlists`);
    await resolve.getByTestId("setlists-list").getByText("Hi-Dive 45 min").click();
    await resolve.waitForURL(/\/setlists\//);
    const setlist = new URL(resolve.url()).pathname;
    await admin.ctx.close();

    const shots: { name: string; who: string; path: string; prep?: (p: Page) => Promise<void> }[] = [
      { name: "calendar-admin", who: "jeff", path: "/calendar" },
      { name: "booking-list", who: "jeff", path: "/booking", prep: async (p) => { await p.getByTestId("booking-seg-pitches").click(); } },
      { name: "pitch", who: "jeff", path: pitch },
      { name: "show", who: "jeff", path: show! },
      { name: "songs", who: "jeff", path: "/songs" },
      { name: "setlist", who: "jeff", path: setlist },
      { name: "money", who: "jeff", path: "/money" },
      { name: "stats", who: "jeff", path: "/stats" },
      { name: "history", who: "jeff", path: "/admin/history" },
    ];
    for (const s of shots) {
      for (const dark of DARK.has(s.name) ? [false, true] : [false]) {
        const { ctx, page } = await session(browser, s.who, size, dark);
        await page.goto(BASE + s.path);
        await page.waitForLoadState("networkidle").catch(() => {});
        await s.prep?.(page);
        await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
        await page.waitForTimeout(1200);
        const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        const label = `${s.name}${dark ? "-dark" : ""}-${size}`;
        if (sw.sw > sw.cw) report.push(`HORIZONTAL SCROLL ${label}: ${sw.sw} > ${sw.cw}`);
        // Fixed bottom nav: grow the viewport to the page height so it sits at the bottom, not mid-image.
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width: SIZES[size].width, height: Math.min(Math.max(h, SIZES[size].height), 4000) });
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/${label}.png` });
        await ctx.close();
      }
    }
  }
  await browser.close();
  console.log(report.join("\n") || "no horizontal scroll detected");
}
main().catch((e) => { console.error(e); process.exit(1); });
