import { test, expect, type Page } from "@playwright/test";
import { A } from "./env";

// Each test makes its own people (unique names and emails) so the order of tests doesn't matter.
let n = 0;
const stamp = () => `${Date.now().toString(36)}${n++}`;
const uniq = () => {
  const s = stamp();
  return { name: `Pat ${s}`, email: `pat-${s}@example.com` };
};

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
async function openPeople(page: Page, key = "jeff") {
  await signInAs(page, key);
  await page.goto(A("/admin/people"));
  await expect(page.getByTestId("page-title")).toHaveText("People");
}
async function openAdd(page: Page) {
  await page.getByTestId("people-add-open").click();
  await expect(page.getByTestId("add-user")).toBeVisible();
  const startOver = page.getByTestId("draft-start-over");
  if (await startOver.isVisible()) await startOver.click(); // a draft left by an earlier test
}
type Kind = { name: string; email?: string; band?: string; role?: "member" | "admin"; mcp?: boolean };
async function addPerson(page: Page, k: Kind) {
  await openAdd(page);
  await page.getByTestId("user-name").fill(k.name);
  if (k.band !== undefined) {
    await page.getByTestId("user-band-member").check();
    await page.getByTestId("user-instruments").fill(k.band);
  }
  if (k.email) {
    await page.getByTestId("user-team").check();
    await page.getByTestId("user-email").fill(k.email);
    if (k.role === "admin") await page.getByTestId("user-role-admin").check();
    if (k.mcp) await page.getByTestId("user-mcp").check();
  }
  await page.getByTestId("user-add").click();
  await expect(page.getByTestId("add-user")).toHaveCount(0);
}
const rowOf = (page: Page, key: string) => page.getByTestId(`person-row-${key}`);
async function menu(page: Page, key: string, item: string) {
  await rowOf(page, key).getByTestId("person-actions").click();
  await page.getByTestId(`person-menu-${item}`).click();
}
async function tabCount(page: Page, tab: string) {
  const t = (await page.getByTestId(`people-tab-${tab}`).textContent()) ?? "";
  return Number(t.split("·")[1]);
}
async function confirm(page: Page) {
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("confirm-dialog")).toBeHidden();
}


test("People: the page, add a Band Member and a Team admin, edit in the sheet, archive and restore", async ({ page }) => {
  const band = uniq(), adm = uniq();
  await openPeople(page);

  // the page
  await expect(page.getByText("play in the band. The")).toBeVisible();
  await expect(page.getByTestId("people-tab-all")).toHaveText(/^All · \d+$/);
  await expect(page.getByTestId("people-tab-band")).toHaveText(/^Band Members · \d+$/);
  await expect(page.getByTestId("people-tab-team")).toHaveText(/^Team · \d+$/);
  await expect(page.getByTestId("people-tab-archived")).toHaveText(/^Archived · \d+$/);
  await expect(page.getByTestId("user-list").locator("th")).toHaveText(["Name", "Email", "Instruments", "Team access", "Actions"]);
  await expect(rowOf(page, "jeff@example.com")).toContainText("Jeff (you)");

  // add a Band Member only
  await addPerson(page, { name: band.name, band: "cello, vocals" });
  await expect(rowOf(page, band.name)).toContainText("cello, vocals");
  await expect(rowOf(page, band.name)).toContainText("— no sign-in");

  // add a person who is both: Admin with AI
  await addPerson(page, { name: adm.name, email: adm.email, band: "banjo", role: "admin", mcp: true });
  await expect(rowOf(page, adm.email)).toContainText("banjo");
  await expect(rowOf(page, adm.email).locator(".chip")).toHaveText(["Admin", "AI"]);

  // edit in the side sheet
  await menu(page, adm.email, "edit");
  const sheet = page.getByTestId("person-sheet");
  await expect(sheet).toBeVisible();
  await page.getByTestId("person-sheet-name").fill(`${adm.name} Jr`);
  await page.getByTestId("person-sheet-instruments").fill("cello, viola");
  await page.getByTestId("person-sheet-phone").fill("303-555-0142");
  await page.getByTestId("person-sheet-payHandle").fill("@pat");
  await page.getByTestId("person-sheet-save").click();
  await expect(sheet).toBeHidden();
  await expect(rowOf(page, adm.email)).toContainText(`${adm.name} Jr`);
  await expect(rowOf(page, adm.email)).toContainText("cello, viola");

  // archive from the sheet, then restore
  const before = await tabCount(page, "archived");
  await menu(page, adm.email, "edit");
  await page.getByTestId("person-sheet-archive").click();
  await confirm(page);
  await expect(sheet).toBeHidden();
  await expect(rowOf(page, adm.email)).toHaveCount(0);
  await expect(page.getByTestId("people-tab-archived")).toHaveText(`Archived · ${before + 1}`);
  await page.getByTestId("people-show-archived").click();
  const arch = rowOf(page, adm.email);
  await expect(arch).toBeVisible();
  await arch.getByTestId("person-actions").click();
  await page.getByTestId("person-menu-restore").click();
  await expect(arch).toHaveCount(0);
  await page.getByTestId("people-tab-all").click();
  const row = rowOf(page, adm.email);
  await expect(row).toContainText("cello, viola");
  await expect(row).toContainText("— no sign-in"); // Team access does not come back
  await expect(page.getByTestId("people-tab-archived")).toHaveText(`Archived · ${before}`);
});
