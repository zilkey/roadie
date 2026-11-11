import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { APP, AUTH, FIRESTORE, A, ARTIST_SLUG } from "./env";

// Merge songs (#50). The duplicates are made through the app's own commands, so the seeded songs stay as they are.

let api: APIRequestContext;
let token: string;
let artistId: string;
let playing: string, learning: string, templateId: string, rehearsalId: string;

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
async function cmd<T = Record<string, any>>(name: string, input: unknown): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await api.post(`${APP}/api/commands/${name}`, { data: input, headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } });
  expect(res.ok(), `${name}: ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { result: T }).result;
}
async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext();
  token = await tokenFor("rudy", "Rudy");
  artistId = await artistIdOf(ARTIST_SLUG);
  playing = (await cmd<{ id: string }>("songs.create", { title: "Zed Bliss", status: "active", key: "Em" })).id;
  learning = (await cmd<{ id: string }>("songs.create", { title: "Zed Bliss (live)", status: "learning", lengthSec: 200 })).id;
  // The learning copy has more hanging off it (a setlist and a file), so it is the default to keep; the playing one is at a rehearsal.
  templateId = (await cmd<{ id: string }>("setlistTemplates.create", { name: "Merge set", items: [{ type: "song", songId: learning }] })).id;
  await cmd("files.attach", { songId: learning, files: [{ url: "https://open.spotify.com/track/zedbliss", title: "Spotify" }] });
  rehearsalId = (await cmd<{ id: string }>("rehearsals.create", { date: "2026-10-30", songs: [{ songId: playing }] })).id;
});
test.afterAll(async () => {
  await cmd("rehearsals.remove", { id: rehearsalId });
  await cmd("setlistTemplates.remove", { id: templateId });
  await cmd("songs.remove", { id: playing });
});

test("search, tick two songs, merge: the setlist and rehearsal show the kept song, and the old address lands on it", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/songs"));
  await expect(page.getByTestId("songs-list")).toBeVisible();

  await page.getByTestId("songs-filter").fill("zed bliss");
  await expect(page.getByTestId(`song-${playing}`)).toBeVisible();
  await page.getByTestId(`song-pick-${playing}`).check();
  await expect(page.getByTestId("songs-selection")).toHaveCount(0); // one is not enough
  // The tick survives a change of tab and of search.
  await page.getByTestId("songs-seg-learning").click();
  await expect(page.getByTestId(`song-${learning}`)).toBeVisible();
  await page.getByTestId(`song-pick-${learning}`).check();
  await page.getByTestId("songs-filter").fill("nothing matches this");
  await page.getByTestId("songs-filter").fill("zed");
  await expect(page.getByTestId("songs-selection")).toContainText("2 songs selected");

  // Clear empties the selection; tick again.
  await page.getByTestId("songs-clear").click();
  await expect(page.getByTestId("songs-selection")).toHaveCount(0);
  await page.getByTestId(`song-pick-${learning}`).check();
  await page.getByTestId("songs-seg-active").click();
  await page.getByTestId(`song-pick-${playing}`).check();
  await expect(page.getByTestId("songs-selection")).toContainText("2 songs selected");

  await page.getByTestId("songs-merge").click();
  const dlg = page.getByTestId("merge-songs-dialog");
  await expect(dlg).toContainText("Merge 2 songs into one");
  await expect(page.getByTestId(`merge-keep-${learning}`)).toContainText("Learning · 1 file · 1 setlist");
  await expect(page.getByTestId(`merge-keep-${playing}`)).toContainText("Playing · 1 rehearsal");
  await expect(page.getByTestId(`merge-keep-radio-${learning}`)).toBeChecked(); // the most references

  // Cancel changes nothing.
  await page.getByTestId("merge-cancel").click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId("songs-selection")).toContainText("2 songs selected");

  await page.getByTestId("songs-merge").click();
  await page.getByTestId(`merge-keep-radio-${playing}`).check();
  await expect(page.getByTestId(`merge-keep-radio-${playing}`)).toBeChecked();
  await expect(page.getByTestId(`merge-keep-radio-${learning}`)).not.toBeChecked();
  await page.getByTestId("merge-confirm").click();
  await expect(page).toHaveURL(new RegExp(`/songs/${playing}$`));
  await expect(page.getByTestId("song-page")).toContainText("Zed Bliss");

  // The setlist and the rehearsal now read the kept song.
  await page.goto(A(`/setlists/${templateId}`));
  await expect(page.getByText("Zed Bliss", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("(live)")).toHaveCount(0);
  await page.goto(A(`/rehearsals/${rehearsalId}`));
  await expect(page.getByTestId("rehearsal-songs")).toContainText("Zed Bliss");

  // The old song's address goes to the kept one.
  await page.goto(A(`/songs/${learning}`));
  await expect(page).toHaveURL(new RegExp(`/songs/${playing}$`));
  await expect(page.getByTestId("song-page")).toBeVisible();

  // The merged-away song is off the list, and Admin > History has the run to undo.
  await page.goto(A("/songs?seg=learning"));
  await expect(page.getByTestId("songs-list")).not.toContainText("Zed Bliss (live)");
  await page.goto(A("/admin/history"));
  await page.getByTestId("filter-entity").fill("songs");
  await expect(page.getByTestId("history-merge-note").first()).toHaveText("Merged Zed Bliss (live) (learning) into this song");
});
