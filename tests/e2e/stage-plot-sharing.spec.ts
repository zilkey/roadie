import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { APP, AUTH, FIRESTORE, A, ARTIST_SLUG } from "./env";

// Stage plots on a show: pick a plot, download the PDF, turn the engineer link on, open it logged out, turn it off. No screenshots.

let api: APIRequestContext;
let token: string;
let artistId: string;
let plotId: string;

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
async function openShow(page: Page, venue: string, date: string) {
  await page.goto("/signin");
  await page.getByTestId("dev-jeff").click();
  await expect(page).toHaveURL(/\/calendar$/);
  await page.goto(A("/shows"));
  await page.getByTestId("shows-row").filter({ hasText: venue }).filter({ hasText: date }).first().locator("td.date a").click();
  await expect(page.getByTestId("sound")).toBeVisible();
}

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext();
  token = await tokenFor("jeff", "Jeff");
  artistId = await artistIdOf(ARTIST_SLUG);
  plotId = (await cmd<{ id: string }>("stagePlots.create", { name: "Sharing test plot", inputs: 4 })).id;
  await cmd("stagePlots.updateInputs", { id: plotId, inputs: [{ n: 1, source: "Kick drum", gear: "Beta 52" }, { n: 2, source: "Snare", gear: "SM57" }, { n: 3, source: "Bass DI", gear: "DI" }] });
  await cmd("stagePlots.move", { id: plotId, moves: [{ id: (await cmd<{ inputs: { id: string }[] }>("stagePlots.get", { id: plotId })).inputs[0].id, x: 12, y: 4 }] });
  await cmd("stagePlots.setBringNeed", { id: plotId, bring: "Keys rig", need: "Four wedges" });
});
test.afterAll(async () => {
  if (plotId) await cmd("stagePlots.remove", { id: plotId });
  await api.dispose();
});

test("pick a plot on a show, download the PDF, engineer link on, open it logged out, off kills it", async ({ page, browser }) => {
  await openShow(page, "Lost Lake Lounge", "Jan 16");
  const card = page.getByTestId("stage-plot");
  await expect(card).toContainText("Pick a stage plot");
  await card.getByTestId("plot-pick").selectOption(plotId);
  await expect(card.getByTestId("plot-name")).toHaveText("Sharing test plot");
  await expect(card.getByTestId("plot-version")).toHaveText(/^v\d+$/);
  await expect(card.getByTestId("plot-thumb")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("plot-name")).toHaveText("Sharing test plot");

  // The PDF: the button downloads application/pdf on the picked paper; the route answers with the same.
  await card.getByTestId("plot-paper").selectOption("a4");
  const [download, req] = await Promise.all([page.waitForEvent("download"), page.waitForRequest(/\/pdf\?paper=a4$/), page.getByTestId("plot-download").click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  expect(req.url()).toContain("paper=a4");
  const pdf = await api.get(`${APP}/api/stage-plots/${plotId}/pdf`, { headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } });
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  expect((await api.get(`${APP}/api/stage-plots/${plotId}/pdf`)).status()).toBe(401);

  // Engineer link: off by default, on, then it opens with no login.
  await expect(page.getByTestId("plot-copy-link")).toHaveCount(0);
  await page.getByTestId("plot-link-on").click();
  await expect(page.getByTestId("plot-copy-link")).toBeVisible();
  const { url } = await cmd<{ on: boolean; url: string }>("stagePlots.engineerLink", { id: plotId });
  expect(url).toMatch(/\/plot\/[^/]+\/[A-Za-z0-9_-]+$/);
  expect((await cmd<{ url: string }>("stagePlots.engineerLink", { id: plotId })).url).toBe(url); // one stable link

  const path = new URL(url).pathname;
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(path);
  await expect(anon.getByTestId("plot-channel")).toHaveCount(4);
  await expect(anon.getByTestId("plot-channels")).toContainText("Kick drum");
  await expect(anon.getByTestId("plot-channels")).toContainText("not placed");
  await expect(anon.getByTestId("plot-bring-need")).toContainText("Four wedges");
  const anonPdf = await api.get(`${APP}/api/plot/${path.split("/").slice(2).join("/")}`);
  expect(anonPdf.status()).toBe(200);
  expect(anonPdf.headers()["content-type"]).toContain("application/pdf");

  await page.getByTestId("plot-link-off").click();
  await expect(page.getByTestId("plot-link-on")).toBeVisible();
  await anon.reload();
  await expect(anon.getByTestId("plot-problem")).toBeVisible();
  expect((await api.get(`${APP}/api/plot/${path.split("/").slice(2).join("/")}`)).status()).toBe(403);

  // Clear puts the card back to the picker.
  await page.getByTestId("plot-clear").click();
  await expect(page.getByTestId("plot-pick")).toBeVisible();
  await anon.context().close();
});

test("members see the card only once a plot is picked, and can download but not change it", async ({ page }) => {
  const showId = (await cmd<{ shows: { id: string; venue?: string }[] }>("shows.list", {})).shows?.[0]?.id;
  test.skip(!showId, "no seeded show");
  await cmd("shows.setStagePlot", { showId, stagePlotId: plotId });
  await page.goto("/signin");
  await page.getByTestId("dev-david").click();
  await expect(page).toHaveURL(/\/calendar$/);
  await page.goto(A(`/shows/${showId}`));
  const card = page.getByTestId("stage-plot");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("plot-download")).toBeVisible();
  await expect(card.getByTestId("plot-change")).toHaveCount(0);
  await expect(card.getByTestId("plot-clear")).toHaveCount(0);
  await expect(card.getByTestId("plot-link-on")).toHaveCount(0);
  await cmd("shows.setStagePlot", { showId, stagePlotId: null });
  await page.reload();
  await expect(page.getByTestId("stage-plot")).toHaveCount(0);
});

test("editor: the paper pick is remembered, Duplicate leaves a musician out, Archive sends it to the list", async ({ page }) => {
  const people = await cmd<{ people: { musicianId: string | null; name: string }[] }>("people.list", {});
  const [drummer, other] = people.people.filter((p) => p.musicianId);
  expect(drummer && other).toBeTruthy();
  const srcId = (await cmd<{ id: string }>("stagePlots.create", { name: "Dup test plot", inputs: 3 })).id;
  await cmd("stagePlots.updateInputs", { id: srcId, inputs: [
    { n: 1, source: "Kick", musicianId: drummer.musicianId }, { n: 2, source: "Snare", musicianId: drummer.musicianId }, { n: 3, source: "Vox", musicianId: other.musicianId },
  ] });
  try {
    await page.goto("/signin");
    await page.getByTestId("dev-jeff").click();
    await expect(page).toHaveURL(/\/calendar$/);
    await page.goto(A(`/stage-plots/${srcId}`));
    await expect(page.getByTestId("ch-row")).toHaveCount(3);

    // Paper: A4 goes to the route and survives a reload.
    await expect(page.getByTestId("plot-paper")).toHaveValue("letter");
    await page.getByTestId("plot-paper").selectOption("a4");
    await Promise.all([page.waitForEvent("download"), page.waitForRequest(/\/pdf\?paper=a4$/), page.getByTestId("plot-pdf").click()]);
    await page.reload();
    await expect(page.getByTestId("plot-paper")).toHaveValue("a4");

    // Duplicate without the drummer: the copy has one input and a fresh name.
    await page.getByTestId("plot-actions").click();
    await page.getByTestId("plot-menu-duplicate").click();
    await expect(page.getByTestId("dup-name")).toHaveValue("Dup test plot copy");
    await page.getByTestId("dup-name").fill("Dup test plot no drums");
    await page.getByTestId(`dup-drop-${drummer.musicianId}`).check();
    await page.getByTestId("dup-go").click();
    await expect(page).toHaveURL(new RegExp(`/stage-plots/(?!${srcId}$)[^/]+$`));
    await expect(page.getByTestId("page-title")).toHaveText("Dup test plot no drums");
    await expect(page.getByTestId("ch-row")).toHaveCount(1);
    await expect(page.locator('[data-testid="ch-row"][data-ch="1"]').getByTestId("ch-source")).toHaveValue("Vox");
    const copyId = page.url().split("/").pop()!;
    expect((await cmd<{ inputs: unknown[] }>("stagePlots.get", { id: srcId })).inputs).toHaveLength(3);

    // Archive the copy (confirm first): back to the list, and it is gone.
    page.once("dialog", (d) => void d.accept());
    await page.getByTestId("plot-actions").click();
    await page.getByTestId("plot-menu-archive").click();
    await expect(page).toHaveURL(/\/stage-plots$/);
    await expect(page.getByTestId("stage-plots-list")).toBeVisible();
    await expect(page.getByTestId(`plot-${copyId}`)).toHaveCount(0);
    await expect(page.getByTestId(`plot-${srcId}`)).toBeVisible();
    expect((await api.post(`${APP}/api/commands/stagePlots.get`, { data: { id: copyId }, headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } })).ok()).toBeFalsy();
  } finally {
    await cmd("stagePlots.remove", { id: srcId });
  }
});
