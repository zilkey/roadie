import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { APP, AUTH, FIRESTORE, A, ARTIST_SLUG } from "./env";
import { BREAK_ITEM, FIVE, S1, S2, type FixtureSong } from "../fixtures/print-setlists";

// Printable setlists. The fixture data is the print wireframes' (tests/fixtures/print-setlists.ts), created through the
// app's own commands so the seeded records stay as they are. No screenshots: those are taken by hand.

let api: APIRequestContext;
let token: string;
let artistId: string;
let capoId: string;
let midiId: string;
let template25: string;
let template5: string;
const madeSongs: string[] = [];

/** An ID token for a seeded person, the way the dev "Sign in as" buttons get one (the emulator takes the JSON as the Google credential). */
async function tokenFor(key: string, name: string) {
  const res = await api.post(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo`, {
    data: {
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: `dev-${key}`, email: `${key}@example.com`, email_verified: true, name }))}&providerId=google.com`,
      requestUri: "http://localhost", returnIdpSignInMethod: true, returnSecureToken: true,
    },
  });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { idToken: string }).idToken;
}

async function artistIdOf(slug: string) {
  const res = await api.get(`http://${FIRESTORE}/v1/projects/demo-band-tracker/databases/(default)/documents/artists`, { headers: { authorization: "Bearer owner" } });
  const docs = ((await res.json()) as { documents: { name: string; fields: { slug?: { stringValue: string } } }[] }).documents;
  const d = docs.find((x) => x.fields.slug?.stringValue === slug);
  expect(d).toBeTruthy();
  return d!.name.split("/").pop()!;
}

async function cmd<T = Record<string, any>>(name: string, input: unknown): Promise<T> {
  const res = await api.post(`${APP}/api/commands/${name}`, { data: input, headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } });
  expect(res.ok(), `${name}: ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { result: T }).result;
}

async function makeSongs(rows: FixtureSong[], withFields: boolean) {
  const ids: string[] = [];
  for (const [i, [title, shortTitle, key]] of rows.entries()) {
    const fields = withFields ? [{ fieldId: capoId, value: String((i % 4) + 1) }, { fieldId: midiId, value: `PC ${i + 1}` }] : [];
    const { id } = await cmd<{ id: string }>("songs.create", { title, key, lengthSec: 214, status: "active", ...(shortTitle ? { shortTitle } : {}), fields });
    ids.push(id);
    madeSongs.push(id);
  }
  return ids;
}

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext();
  token = await tokenFor("jeff", "Jeff");
  artistId = await artistIdOf(ARTIST_SLUG);
  capoId = (await cmd<{ fieldId: string }>("artists.addSongField", { id: artistId, label: "Capo" })).fieldId;
  midiId = (await cmd<{ fieldId: string }>("artists.addSongField", { id: artistId, label: "MIDI" })).fieldId;

  const ids25 = await makeSongs([...S1, ...S2], true);
  const items25 = [
    ...ids25.slice(0, 13).map((songId) => ({ type: "song", songId })),
    { type: "break", title: BREAK_ITEM.title, note: BREAK_ITEM.note, lengthSec: BREAK_ITEM.lengthSec },
    ...ids25.slice(13).map((songId) => ({ type: "song", songId })),
  ];
  template25 = (await cmd<{ id: string }>("setlistTemplates.create", { name: "Print 25", items: items25 })).id;
  // The 5-song opener reuses five of the 25 songs.
  const idOf = (row: FixtureSong) => ids25[[...S1, ...S2].indexOf(row)];
  template5 = (await cmd<{ id: string }>("setlistTemplates.create", { name: "Print 5", items: FIVE.map((row) => ({ type: "song", songId: idOf(row) })) })).id;
});

test.afterAll(async () => {
  for (const id of [template25, template5]) if (id) await cmd("setlistTemplates.remove", { id });
  for (const id of madeSongs) await cmd("songs.remove", { id });
  for (const fieldId of [capoId, midiId]) if (fieldId) await cmd("artists.removeSongField", { id: artistId, fieldId });
  await api.dispose();
});

test.beforeEach(async ({ page }) => {
  // Never open a real print dialog; count the calls instead.
  await page.addInitScript(() => {
    (window as unknown as { __printCalls: number }).__printCalls = 0;
    window.print = () => { (window as unknown as { __printCalls: number }).__printCalls++; };
  });
});

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
const printCalls = (page: Page) => page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls);
const query = (o: Record<string, string>) => new URLSearchParams(o).toString();
const field = (page: Page, id: string) => page.getByTestId("print-dialog").locator(`[data-testid="print-field"][data-field="${id}"]`);

async function openPrintPage(page: Page, id: string, q: Record<string, string>) {
  await page.emulateMedia({ media: "print" });
  await page.goto(A(`/setlists/${id}/print?${query(q)}`));
  await expect(page.locator('[data-testid="print-page"][data-ready="true"]')).toBeVisible();
}

/** The sheets on the print route fit their boxes; returns the base text size. */
async function expectFitted(page: Page, sheets: number) {
  await expect(page.getByTestId("print-sheet")).toHaveCount(sheets);
  const overflow = await page.getByTestId("print-sheet-body").evaluateAll((els) => els.map((e) => e.scrollHeight - e.clientHeight));
  expect(overflow).toHaveLength(sheets);
  for (const o of overflow) expect(o).toBeLessThanOrEqual(1);
  const px = Number(await page.getByTestId("print-sheets").getAttribute("data-text-px"));
  expect(px).toBeGreaterThan(0);
  await expect(page.getByTestId("print-sheets")).toHaveAttribute("data-overflow", "false");
  return px;
}
const near = (px: number, want: number) => { expect(px).toBeGreaterThanOrEqual(want * 0.7); expect(px).toBeLessThanOrEqual(want * 1.3); };

test("the dialog's options each change the preview, and each toggle flips", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A(`/setlists/${template25}`));
  await page.getByTestId("print-setlist").click();
  const dialog = page.getByTestId("print-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("print-preview")).toBeVisible();
  await expect(page.getByTestId("print-go")).toHaveText(/^Print$/);
  await expect(page.getByTestId("print-sheet-count")).toHaveText(/^1 sheet$/);
  await expect(page.getByTestId("print-size")).toBeVisible();
  const rows = page.getByTestId("print-preview").getByTestId("print-row");
  await expect(rows).toHaveCount(25);
  await expect(page.getByTestId("print-preview").getByTestId("print-break")).toHaveCount(1);

  // Segmented buttons: one is pressed at a time; sheets per set splits the list in two.
  const pressed = (id: string) => expect(page.getByTestId(id));
  await pressed("print-copy-band").toHaveAttribute("aria-pressed", "true");
  await pressed("print-copy-mine").toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("print-sheets-perSet").click();
  await pressed("print-sheets-perSet").toHaveAttribute("aria-pressed", "true");
  await pressed("print-sheets-one").toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("print-sheet-count")).toHaveText(/^2 sheets$/);
  await expect(page.getByTestId("print-preview").getByTestId("print-sheet")).toHaveCount(2);
  const size2 = await page.getByTestId("print-size").textContent();
  await page.getByTestId("print-sheets-one").click();
  await pressed("print-sheets-one").toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("print-sheet-count")).toHaveText(/^1 sheet$/);
  expect(size2).toBeTruthy();

  // Short titles.
  await expect(rows.nth(2)).not.toContainText("700 Miles (Reprise)");
  await page.getByTestId("print-titles-short").click();
  await pressed("print-titles-short").toHaveAttribute("aria-pressed", "true");
  await pressed("print-titles-wrap").toHaveAttribute("aria-pressed", "false");
  await expect(rows.nth(2)).toContainText("700 Miles (Reprise)");
  await expect(rows.nth(0)).toContainText("Open Road Hymn");
  await page.getByTestId("print-titles-wrap").click();
  await expect(rows.nth(2)).not.toContainText("700 Miles (Reprise)");

  // Fields: Key shows the key after the title; every field checkbox flips.
  await expect(rows.nth(0).getByTestId("print-key")).toHaveCount(0);
  await field(page, "key").check();
  await expect(field(page, "key")).toBeChecked();
  await expect(rows.nth(0).getByTestId("print-key")).toHaveText("G");
  await field(page, "key").uncheck();
  await expect(rows.nth(0).getByTestId("print-key")).toHaveCount(0);
  // A song field prints after the title on the band copy too, named.
  await expect(rows.nth(0).getByTestId("print-fields")).toHaveCount(0);
  await field(page, `field:${capoId}`).check();
  await expect(rows.nth(0).getByTestId("print-fields")).toHaveText("Capo 1");
  await field(page, `field:${capoId}`).uncheck();
  await expect(rows.nth(0).getByTestId("print-fields")).toHaveCount(0);
  for (const id of ["key", "length", `field:${capoId}`, `field:${midiId}`, "breaks"]) {
    const box = field(page, id);
    const was = await box.isChecked();
    await box.setChecked(!was);
    await expect(box).toBeChecked({ checked: !was });
    await box.setChecked(was);
    await expect(box).toBeChecked({ checked: was });
  }
  // Breaks off: the break box goes.
  await field(page, "breaks").uncheck();
  await expect(page.getByTestId("print-preview").getByTestId("print-break")).toHaveCount(0);
  await field(page, "breaks").check();
  await expect(page.getByTestId("print-preview").getByTestId("print-break")).toHaveCount(1);

  // Header and paper.
  const header = page.getByTestId("print-header");
  const headerWas = await header.isChecked();
  await header.setChecked(!headerWas);
  await expect(header).toBeChecked({ checked: !headerWas });
  await header.setChecked(headerWas);
  await expect(header).toBeChecked({ checked: headerWas });
  // Transitions on by default; off, the footer's total gets shorter.
  const transitions = page.getByTestId("print-transitions");
  await expect(transitions).toBeChecked();
  const footer = page.getByTestId("print-preview").getByTestId("print-footer").first();
  const withGaps = await footer.textContent();
  await transitions.uncheck();
  await expect(footer).not.toHaveText(withGaps ?? "");
  await transitions.check();
  await expect(footer).toHaveText(withGaps ?? "");
  await expect(page.getByTestId("print-paper")).toHaveValue("letter");
  await page.getByTestId("print-paper").selectOption("a4");
  await expect(page.getByTestId("print-paper")).toHaveValue("a4");
  await expect(page.getByTestId("print-preview").getByTestId("print-sheet")).toHaveCount(1);
  await page.getByTestId("print-paper").selectOption("letter");

  // My copy is offered to Jeff (he is a musician of this band).
  await page.getByTestId("print-copy-mine").click();
  await expect(page.getByTestId("print-copy-mine")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("print-copy-band")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("print-copy-band").click();
  await expect(page.getByTestId("print-copy-band")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("print-close").click();
  await expect(dialog).toHaveCount(0);
});

test("print route: 25 songs, band copy, one sheet", async ({ page }) => {
  await signInAs(page, "jeff");
  await openPrintPage(page, template25, { copy: "band", sheets: "one", fields: "breaks", titles: "wrap", header: "1", paper: "letter" });
  near(await expectFitted(page, 1), 32);
  await expect(page.getByTestId("print-row")).toHaveCount(25);
  await expect(page.getByTestId("print-break")).toContainText("Merch + tip jar · BREAK 15");
  await expect.poll(() => printCalls(page)).toBe(1);
});

test("print route: 25 songs, band copy, one sheet per set", async ({ page }) => {
  await signInAs(page, "jeff");
  await openPrintPage(page, template25, { copy: "band", sheets: "perSet", fields: "breaks", titles: "wrap", header: "1", paper: "letter" });
  near(await expectFitted(page, 2), 44);
  await expect(page.getByTestId("print-row")).toHaveCount(25);
  await expect.poll(() => printCalls(page)).toBe(1);
});

test("print route: 25 songs, my copy with song fields, one sheet as a table", async ({ page }) => {
  await signInAs(page, "jeff"); // Jeff is a seeded musician of the band; a person with no musician would fall back to the band copy
  await openPrintPage(page, template25, { copy: "mine", sheets: "one", fields: ["key", "length", `field:${capoId}`, `field:${midiId}`, "breaks"].join(","), titles: "short", header: "1", paper: "letter" });
  near(await expectFitted(page, 1), 24);
  await expect(page.getByTestId("print-row")).toHaveCount(25);
  await expect(page.getByTestId("print-page")).toContainText("Jeff's copy");
  await expect(page.getByTestId("print-sheets")).toHaveAttribute("data-layout", "table");
  await expect.poll(() => printCalls(page)).toBe(1);
});

test("print route: 5 songs, band copy, big type on one sheet", async ({ page }) => {
  await signInAs(page, "jeff");
  await openPrintPage(page, template5, { copy: "band", sheets: "one", fields: "", titles: "wrap", header: "1", paper: "letter" });
  near(await expectFitted(page, 1), 76);
  await expect(page.getByTestId("print-row")).toHaveCount(5);
  await expect.poll(() => printCalls(page)).toBe(1);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the dialog is a bottom sheet with a summary, and Print or share PDF opens the print page in the same tab", async ({ page }) => {
    await signInAs(page, "jeff");
    await page.goto(A(`/setlists/${template25}`));
    await page.getByTestId("print-setlist").click();
    await expect(page.getByTestId("print-dialog")).toBeVisible();
    await expect(page.getByTestId("print-summary")).toBeVisible();
    await expect(page.getByTestId("print-preview")).toHaveCount(0);
    await expect(page.getByTestId("print-go")).toHaveText("Print or share PDF");
    await page.getByTestId("print-go").click();
    await expect(page).toHaveURL(new RegExp(`/artists/${ARTIST_SLUG}/setlists/${template25}/print\\?`));
    await expect(page.locator('[data-testid="print-page"][data-ready="true"]')).toBeVisible();
    await expect(page.getByTestId("print-sheet")).toHaveCount(1);
  });
});

test("a member can open the print dialog and the print page and gets the band copy", async ({ page }) => {
  await signInAs(page, "david");
  await page.goto(A(`/setlists/${template25}`));
  await page.getByTestId("print-setlist").click();
  await expect(page.getByTestId("print-dialog")).toBeVisible();
  await expect(page.getByTestId("print-copy-band")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("print-preview").getByTestId("print-row")).toHaveCount(25);
  await page.getByTestId("print-close").click();

  await openPrintPage(page, template25, { copy: "band", sheets: "one", fields: "breaks", titles: "wrap", header: "1", paper: "letter" });
  await expectFitted(page, 1);
  await expect(page.getByTestId("print-row")).toHaveCount(25);
  await expect(page.getByTestId("print-page")).not.toContainText("Jeff's copy");
  await expect.poll(() => printCalls(page)).toBe(1);
});
