import { test, expect, type APIRequestContext } from "@playwright/test";
import { APP, AUTH, FIRESTORE, A, ARTIST_SLUG, DRIVE } from "./env";

// Download PDF on a setlist: setlists.pdf exports each song's Google Doc chart from the (fake) Drive into one PDF saved in
// Charts / Setlists. Its own songs and template, made through the app's commands, so the seeded records stay as they are.

let api: APIRequestContext;
let token: string;
let artistId: string;
let templateId: string;
const songs: string[] = [];

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
  return docs.find((x) => x.fields.slug?.stringValue === slug)!.name.split("/").pop()!;
}
async function cmd<T = Record<string, unknown>>(name: string, input: unknown): Promise<T> {
  const res = await api.post(`${APP}/api/commands/${name}`, { data: input, headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } });
  expect(res.ok(), `${name}: ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { result: T }).result;
}

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext();
  token = await tokenFor("rudy", "Rudy");
  artistId = await artistIdOf(ARTIST_SLUG);
  const song = async (title: string, driveFileId?: string) => {
    const { id } = await cmd<{ id: string }>("songs.create", { title, status: "active", lengthSec: 200 });
    songs.push(id);
    if (driveFileId) await cmd("files.attach", { songId: id, files: [{ driveFileId, kind: "chart" }] });
    return id;
  };
  const tabs = await song("PDF Two Tabs", "fake-band-weathervane"); // a Google Doc with two tabs
  const one = await song("PDF One Doc", "fake-lyrics-2");
  const alt = await song("PDF Alternate", "fake-lyrics-3");
  const none = await song("PDF No Chart");
  templateId = (await cmd<{ id: string }>("setlistTemplates.create", { name: "PDF night", items: [{ type: "song", songId: tabs }, { type: "song", songId: one, alts: [{ songId: alt }] }, { type: "song", songId: none }] })).id;
});

test.afterAll(async () => {
  if (templateId) await cmd("setlistTemplates.remove", { id: templateId });
  for (const id of songs) await cmd("songs.remove", { id });
  await api.dispose();
});

test("Download PDF on a setlist makes one PDF of the charts in Charts / Setlists and says what was left out (a member can)", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-hugo").click();
  await expect(page).toHaveURL(/\/calendar$/);
  await page.goto(A(`/setlists/${templateId}`));
  await page.getByTestId("setlist-pdf").click();
  const dlg = page.getByTestId("setlist-pdf-dialog");
  const done = dlg.getByTestId("setlist-pdf-done");
  await expect(done).toContainText("PDF night.pdf");
  await expect(done).toContainText("Setlists");
  await expect(done).toContainText("4 pages for 3 songs"); // two tabs, one doc, the alternate
  await expect(dlg.getByTestId("setlist-pdf-skipped")).toContainText("PDF No Chart: No Google Doc or PDF chart");
  const href = await dlg.getByTestId("setlist-pdf-open").getAttribute("href");
  expect(href).toBeTruthy();

  // It is in the fake Drive, in a Setlists folder inside Charts.
  const folders = (await (await fetch(`${DRIVE}/files?parent=fake-folder-charts`)).json()) as { id: string; name: string }[];
  const setlists = folders.find((f) => f.name === "Setlists")!;
  const inside = (await (await fetch(`${DRIVE}/files?parent=${setlists.id}`)).json()) as { name: string; webViewLink: string }[];
  expect(inside.filter((f) => f.name === "PDF night.pdf").map((f) => f.webViewLink)).toEqual([href]);
  await dlg.getByTestId("setlist-pdf-close").click();
  await expect(done).toHaveCount(0);
});
