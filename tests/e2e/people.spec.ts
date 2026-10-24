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
  await expect(page).toHaveURL(/\/home$/);
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

test("the page: title, tabs with counts, table columns, you", async ({ page }) => {
  await openPeople(page);
  await expect(page.getByText("play in the band. The")).toBeVisible();
  await expect(page.getByTestId("people-tab-all")).toHaveText(/^All · \d+$/);
  await expect(page.getByTestId("people-tab-band")).toHaveText(/^Band Members · \d+$/);
  await expect(page.getByTestId("people-tab-team")).toHaveText(/^Team · \d+$/);
  await expect(page.getByTestId("people-tab-archived")).toHaveText(/^Archived · \d+$/);
  await expect(page.getByTestId("user-list").locator("th")).toHaveText(["Name", "Email", "Instruments", "Team access", "Actions"]);
  const jeff = rowOf(page, "jeff@example.com");
  await expect(jeff).toContainText("Jeff (you)");
  await expect(jeff).toContainText("keys");
  await expect(jeff.locator(".chip").first()).toHaveText("Admin");
  await expect(rowOf(page, "david@example.com").locator(".chip")).toHaveText("Standard");
  await expect(jeff.getByTestId("person-actions")).toHaveAttribute("aria-label", "Actions for Jeff");
});

test("add a Band Member only", async ({ page }) => {
  const p = uniq();
  await openPeople(page);
  await addPerson(page, { name: p.name, band: "cello, vocals" });
  const row = rowOf(page, p.name);
  await expect(row).toContainText("cello, vocals");
  await expect(row).toContainText("— no sign-in");
});

test("add Team only (Standard), then both (Admin with AI)", async ({ page }) => {
  const t = uniq(), b = uniq();
  await openPeople(page);
  await addPerson(page, { name: t.name, email: t.email });
  await expect(rowOf(page, t.email)).toContainText("— not in band");
  await expect(rowOf(page, t.email).locator(".chip")).toHaveText("Standard");
  await addPerson(page, { name: b.name, email: b.email, band: "banjo", role: "admin", mcp: true });
  const row = rowOf(page, b.email);
  await expect(row).toContainText("banjo");
  await expect(row.locator(".chip")).toHaveText(["Admin", "AI"]);
  await page.reload();
  await expect(rowOf(page, b.email).locator(".chip")).toHaveText(["Admin", "AI"]); // AI shows for this band
});

test("add form: each validation error is inline, and AI is Admin-only", async ({ page }) => {
  await openPeople(page);
  await openAdd(page);
  await page.getByTestId("user-add").click();
  await expect(page.getByTestId("error-name")).toHaveText("Enter a name");
  await expect(page.getByTestId("error-kind")).toHaveText("Pick Band Member, Team, or both");
  await expect(page.getByTestId("user-name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("error")).toHaveCount(0); // not one error box

  await page.getByTestId("user-name").fill("Valerie Check");
  await expect(page.getByTestId("error-name")).toHaveCount(0);
  await page.getByTestId("user-band-member").check();
  await expect(page.getByTestId("error-kind")).toHaveCount(0);
  await page.getByTestId("user-add").click();
  await expect(page.getByTestId("error-instruments")).toHaveText("Add at least one instrument");
  await expect(page.getByTestId("user-instruments")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("user-instruments")).toHaveAttribute("aria-describedby", "add-instruments-err");

  await page.getByTestId("user-instruments").fill("fiddle");
  await page.getByTestId("user-team").check();
  await page.getByTestId("user-email").fill("not-an-email");
  await page.getByTestId("user-add").click();
  await expect(page.getByTestId("error-email")).toHaveText("Email address invalid");
  await expect(page.getByTestId("error-instruments")).toHaveCount(0);

  await expect(page.getByTestId("user-mcp")).toHaveCount(0); // Standard: no AI box
  await page.getByTestId("user-role-admin").check();
  await expect(page.getByTestId("user-mcp")).toBeVisible();
  await page.getByTestId("user-role-member").check();
  await expect(page.getByTestId("user-mcp")).toHaveCount(0);
  await page.getByTestId("user-cancel").click();
  await expect(page.getByTestId("add-user")).toHaveCount(0);
});

test("edit details and instruments in the side sheet", async ({ page }) => {
  const p = uniq();
  await openPeople(page);
  await addPerson(page, { name: p.name, email: p.email, band: "cello" });
  await menu(page, p.email, "edit");
  const sheet = page.getByTestId("person-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("person-sheet-title")).toHaveText(p.name);
  await expect(sheet.locator(".chip")).toHaveText(["Band Member", "Team · Standard"]);
  await expect(page.getByTestId("person-sheet-phone")).toHaveAttribute("placeholder", "Optional");
  // validation is inline
  await page.getByTestId("person-sheet-name").fill("");
  await page.getByTestId("person-sheet-instruments").fill("");
  await page.getByTestId("person-sheet-save").click();
  await expect(sheet.getByTestId("error-name")).toHaveText("Enter a name");
  await expect(sheet.getByTestId("error-instruments")).toHaveText("Add at least one instrument");
  await page.getByTestId("person-sheet-name").fill(`${p.name} Jr`);
  await page.getByTestId("person-sheet-instruments").fill("cello, viola");
  await page.getByTestId("person-sheet-phone").fill("303-555-0142");
  await page.getByTestId("person-sheet-payHandle").fill("@pat");
  await page.getByTestId("person-sheet-save").click();
  await expect(sheet).toBeHidden();
  await expect(rowOf(page, p.email)).toContainText(`${p.name} Jr`);
  await expect(rowOf(page, p.email)).toContainText("cello, viola");
  await menu(page, p.email, "edit");
  await expect(page.getByTestId("person-sheet-phone")).toHaveValue("303-555-0142");
  await expect(page.getByTestId("person-sheet-payHandle")).toHaveValue("@pat");
  await page.getByTestId("person-sheet-cancel").click();
  await expect(sheet).toBeHidden();
});

test("Standard to Admin to Standard: AI can be turned on and is cleared on demotion", async ({ page }) => {
  const p = uniq();
  await openPeople(page);
  await addPerson(page, { name: p.name, email: p.email, role: "admin" });
  const row = rowOf(page, p.email);
  await expect(row.locator(".chip")).toHaveText("Admin");
  await menu(page, p.email, "edit");
  await page.getByTestId("person-sheet-mcp").check();
  await page.getByTestId("person-sheet-save").click();
  await expect(row.locator(".chip")).toHaveText(["Admin", "AI"]);
  await menu(page, p.email, "edit");
  await expect(page.getByTestId("person-sheet-mcp")).toBeChecked();
  await page.getByTestId("person-sheet-role-member").check();
  await expect(page.getByTestId("person-sheet-mcp")).not.toBeChecked();
  await expect(page.getByTestId("person-sheet-mcp")).toBeDisabled();
  await expect(page.getByText("Only Admins can have AI access.")).toBeVisible();
  await page.getByTestId("person-sheet-save").click();
  await expect(page.getByTestId("person-sheet")).toBeHidden();
  await expect(row.locator(".chip", { hasText: "Standard" })).toBeVisible();
  await expect(row.locator(".chip", { hasText: "AI" })).toHaveCount(0);
  await expect(row.locator(".chip", { hasText: "Admin" })).toHaveCount(0);
  await menu(page, p.email, "edit");
  await expect(page.getByTestId("person-sheet-mcp")).not.toBeChecked();
  await page.getByTestId("person-sheet-cancel").click();
});

test("remove Team access, then give it back", async ({ page }) => {
  const p = uniq();
  await openPeople(page);
  await addPerson(page, { name: p.name, email: p.email, band: "bass" });
  await menu(page, p.email, "remove-team");
  await expect(page.getByTestId("confirm-dialog")).toContainText("can't sign in anymore");
  await confirm(page);
  const left = rowOf(page, p.email); // the Band Member record keeps the email
  await expect(left).toContainText("— no sign-in");
  await expect(left).toContainText("bass");
  await left.getByTestId("person-actions").click();
  await expect(page.getByTestId("person-menu-remove-team")).toHaveCount(0);
  await page.getByTestId("person-menu-give-team").click();
  await expect(page.getByTestId("give-email")).toHaveValue(p.email); // prefilled from the Band Member's email
  await page.getByTestId("give-email").fill("nope");
  await page.getByTestId("give-submit").click();
  await expect(page.getByTestId("error-email")).toHaveText("Email address invalid");
  await page.getByTestId("give-email").fill(p.email);
  await page.getByTestId("give-role-admin").check();
  await page.getByTestId("give-submit").click();
  await expect(page.getByTestId("give-team-dialog")).toBeHidden();
  await expect(rowOf(page, p.email).locator(".chip")).toHaveText("Admin");
});

test("remove from band keeps Team access; add to band again", async ({ page }) => {
  const p = uniq();
  await openPeople(page);
  await addPerson(page, { name: p.name, email: p.email, band: "drums" });
  await menu(page, p.email, "remove-band");
  await expect(page.getByTestId("confirm-dialog")).toContainText(`Remove ${p.name} from the band?`);
  await confirm(page);
  const row = rowOf(page, p.email);
  await expect(row).toContainText("— not in band");
  await expect(row.locator(".chip")).toHaveText("Standard");
  await row.getByTestId("person-actions").click();
  await expect(page.getByTestId("person-menu-remove-band")).toHaveCount(0);
  await page.getByTestId("person-menu-add-to-band").click();
  await page.getByTestId("band-submit").click();
  await expect(page.getByTestId("error-instruments")).toHaveText("Add at least one instrument");
  await page.getByTestId("band-instruments").fill("percussion");
  await page.getByTestId("band-submit").click();
  await expect(row).toContainText("percussion");
});

test("archive from the sheet, then restore (Band Member without Team access)", async ({ page }) => {
  const p = uniq();
  await openPeople(page);
  await addPerson(page, { name: p.name, email: p.email, band: "flute" });
  const before = await tabCount(page, "archived");
  await menu(page, p.email, "edit");
  await page.getByTestId("person-sheet-archive").click();
  await expect(page.getByTestId("confirm-dialog")).toContainText(`Archive ${p.name}?`);
  await confirm(page);
  await expect(page.getByTestId("person-sheet")).toBeHidden();
  await expect(rowOf(page, p.email)).toHaveCount(0);
  await expect(page.getByTestId("people-tab-archived")).toHaveText(`Archived · ${before + 1}`);
  await expect(page.getByTestId("people-archived-note")).toContainText("hidden. Past shows and pay still list them.");
  await page.getByTestId("people-show-archived").click();
  await expect(page.getByTestId("people-tab-archived")).toHaveAttribute("aria-selected", "true");
  const arch = rowOf(page, p.email);
  await expect(arch).toBeVisible();
  await arch.getByTestId("person-actions").click();
  await expect(page.getByTestId("person-menu-edit")).toHaveCount(0);
  await page.getByTestId("person-menu-restore").click();
  await expect(arch).toHaveCount(0);
  await page.getByTestId("people-tab-all").click();
  const row = rowOf(page, p.email);
  await expect(row).toContainText("flute"); // Band Member again
  await expect(row).toContainText("— no sign-in"); // Team access does not come back
  await expect(page.getByTestId("people-tab-archived")).toHaveText(`Archived · ${before}`);
});

test("guards: your own row cannot remove its Team access, archive, or demote", async ({ page }) => {
  await openPeople(page);
  const jeff = rowOf(page, "jeff@example.com");
  await jeff.getByTestId("person-actions").click();
  const rm = page.getByTestId("person-menu-remove-team");
  await expect(rm).toHaveAttribute("aria-disabled", "true");
  await expect(rm).toContainText("You can't remove your own Team access");
  await expect(page.getByTestId("person-menu-archive")).toHaveAttribute("aria-disabled", "true");
  await rm.click({ force: true });
  await expect(page.getByTestId("confirm-dialog")).toBeHidden(); // a disabled item does nothing
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("person-menu")).toHaveCount(0);

  await jeff.getByTestId("person-actions").click();
  await page.getByTestId("person-menu-edit").click();
  await expect(page.getByTestId("person-sheet-remove-team")).toBeDisabled();
  await expect(page.getByTestId("person-sheet-remove-team-why")).toHaveText("You can't remove your own Team access");
  await expect(page.getByTestId("person-sheet-role-member")).toBeDisabled();
  await expect(page.getByTestId("person-sheet-role-why")).toHaveText("You can't demote yourself");
});

test("menu: Escape and outside click close it; items follow the person", async ({ page }) => {
  const p = uniq();
  await openPeople(page);
  await addPerson(page, { name: p.name, email: p.email, band: "oboe" });
  const row = rowOf(page, p.email);
  await row.getByTestId("person-actions").click();
  await expect(row.getByTestId("person-actions")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("person-menu")).toHaveAttribute("role", "menu");
  await expect(page.getByTestId("person-menu").getByRole("menuitem")).toHaveText(["Edit", "Remove Team access", "Remove from band", "Archive"]);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("person-menu")).toHaveCount(0);
  await row.getByTestId("person-actions").click();
  await page.getByTestId("page-title").click();
  await expect(page.getByTestId("person-menu")).toHaveCount(0);
});

test("phone layout: rows are cards, no sideways scroll, the sheet is full screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPeople(page);
  const row = rowOf(page, "david@example.com");
  await expect(row).toBeVisible();
  await expect(row.getByTestId("person-actions")).toBeVisible();
  expect((await page.getByTestId("user-list").locator("thead").boundingBox())!.width).toBeLessThanOrEqual(1); // header row is visually hidden
  expect(await row.evaluate((el) => getComputedStyle(el).display)).not.toBe("table-row");
  const box = await row.boundingBox();
  const act = await row.getByTestId("person-actions").boundingBox();
  expect(act!.x + act!.width).toBeLessThanOrEqual(box!.x + box!.width + 1); // ⋯ sits in the card's corner
  expect(act!.y).toBeLessThan(box!.y + 20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await menu(page, "david@example.com", "edit");
  const sheet = await page.getByTestId("person-sheet").boundingBox();
  expect(Math.round(sheet!.width)).toBe(390);
  expect(Math.round(sheet!.height)).toBe(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByTestId("person-sheet-close").click();
  await expect(page.getByTestId("person-sheet")).toBeHidden();
  await page.getByTestId("people-add-open").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
