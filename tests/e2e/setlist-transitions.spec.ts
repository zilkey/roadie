import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { APP, AUTH, FIRESTORE, A, ARTIST_SLUG } from "./env";

// Show transitions: under each song, what changes from the song above (song fields marked In setlists) and the band's notes,
// which live on the lower song and drag with it. Data is made through the app's commands and removed afterwards.

let api: APIRequestContext;
let token: string;
let artistId: string;
let capoId: string;
let template: string;
const made: string[] = [];

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
async function cmd<T = Record<string, any>>(name: string, input: unknown): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await api.post(`${APP}/api/commands/${name}`, { data: input, headers: { authorization: `Bearer ${token}`, "x-artist-id": artistId } });
  expect(res.ok(), `${name}: ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { result: T }).result;
}

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext();
  token = await tokenFor("rudy", "Rudy");
  artistId = await artistIdOf(ARTIST_SLUG);
  capoId = (await cmd<{ fieldId: string }>("artists.addSongField", { id: artistId, label: "Capo (Eb)" })).fieldId;
  await cmd("artists.setSongFieldInSetlists", { id: artistId, fieldId: capoId, inSetlists: true });
  await cmd("artists.updateSongField", { id: artistId, fieldId: capoId, setlistLabel: "Capo" });
  const song = async (title: string, capo: string) => {
    const { id } = await cmd<{ id: string }>("songs.create", { title, lengthSec: 200, status: "active", fields: [{ fieldId: capoId, value: capo }] });
    made.push(id);
    return id;
  };
  const a = await song("Trans Alpha", "1"), b = await song("Trans Bravo", "3"), c = await song("Trans Charlie", "5");
  template = (await cmd<{ id: string }>("setlistTemplates.create", { name: "Transitions", items: [
    { type: "song", songId: a }, { type: "song", songId: b }, { type: "break", title: "Break" }, { type: "song", songId: c, transitionNote: "Jeff starts alone" },
  ] })).id;
});

test.afterAll(async () => {
  await cmd("setlists.setShowTransitions", { on: false });
  if (template) await cmd("setlistTemplates.remove", { id: template });
  for (const id of made) await cmd("songs.remove", { id });
  if (capoId) await cmd("artists.removeSongField", { id: artistId, fieldId: capoId });
  await api.dispose();
});

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

test("show transitions: field changes and notes between songs, notes drag with the lower song, the switch is remembered, and they print", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A(`/setlists/${template}`));
  const titles = page.getByTestId("setlist-items").getByTestId("item-title");
  await expect(titles).toHaveText(["Trans Alpha", "Trans Bravo", "Break", "Trans Charlie"]);
  await expect(page.getByTestId("item-transition")).toHaveCount(0); // off until switched on

  await page.getByTestId("show-transitions").check();
  await expect(page.getByTestId("item-0").getByTestId("item-transition")).toHaveCount(0); // nothing above the first song
  await expect(page.getByTestId("item-1").getByTestId("transition-change")).toHaveText(["Capo: 1 → 3"]);
  await expect(page.getByTestId("item-2").getByTestId("item-transition")).toHaveCount(0); // a break has none
  await expect(page.getByTestId("item-3").getByTestId("transition-none")).toHaveText("After the break"); // notes only after a break
  await expect(page.getByTestId("item-3").getByTestId("transition-note-input")).toHaveValue("Jeff starts alone");

  // a note saves when the box loses focus, and lives on the lower song
  await page.getByTestId("item-1").getByTestId("transition-note-input").fill("Ingrid capos up while Eric vamps");
  await page.getByTestId("item-1").getByTestId("transition-note-input").blur();
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");

  // dragging Bravo to the top takes its note along; Alpha now follows it and has no note
  await page.getByTestId("item-1").getByTestId("item-grip").dragTo(page.getByTestId("item-0").getByTestId("item-grip"));
  await expect(titles).toHaveText(["Trans Bravo", "Trans Alpha", "Break", "Trans Charlie"]);
  await expect(page.getByTestId("item-0").getByTestId("item-transition")).toHaveCount(0);
  await expect(page.getByTestId("item-1").getByTestId("transition-change")).toHaveText(["Capo: 3 → 1"]);
  await expect(page.getByTestId("item-1").getByTestId("transition-note-input")).toHaveValue("");
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  await page.getByTestId("item-1").getByTestId("item-grip").dragTo(page.getByTestId("item-0").getByTestId("item-grip"));
  await expect(titles).toHaveText(["Trans Alpha", "Trans Bravo", "Break", "Trans Charlie"]);
  await expect(page.getByTestId("item-1").getByTestId("transition-note-input")).toHaveValue("Ingrid capos up while Eric vamps");
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");

  // the switch is the person's own, saved on their account
  await page.reload();
  await expect(page.getByTestId("show-transitions")).toBeChecked();
  await expect(page.getByTestId("item-1").getByTestId("transition-note-input")).toHaveValue("Ingrid capos up while Eric vamps");

  // Make default transition saves the note on the song; adding the song by hand brings it along
  await expect(page.getByTestId("item-3").getByTestId("transition-make-default")).toBeVisible();
  await page.getByTestId("item-1").getByTestId("transition-make-default").click();
  await expect(page.getByTestId("item-1").getByTestId("transition-is-default")).toBeVisible();
  await page.getByTestId("add-song-select").selectOption({ label: "Trans Bravo" });
  await page.getByTestId("add-song-item").click();
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  await expect(titles).toHaveText(["Trans Alpha", "Trans Bravo", "Break", "Trans Charlie", "Trans Bravo"]);
  await expect(page.getByTestId("item-4").getByTestId("transition-note-input")).toHaveValue("Ingrid capos up while Eric vamps");
  await expect(page.getByTestId("item-4").getByTestId("transition-change")).toHaveText(["Capo: 5 → 3"]);
  await page.getByTestId("item-4").getByTestId("item-remove").click();
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  await expect(titles).toHaveText(["Trans Alpha", "Trans Bravo", "Break", "Trans Charlie"]);

  // Print: the Transitions field puts them above each song
  await page.getByTestId("print-setlist").click();
  const dialog = page.getByTestId("print-dialog");
  const box = dialog.locator('[data-testid="print-field"][data-field="transitions"]');
  if (!(await box.isChecked())) await box.check();
  await expect(dialog.getByTestId("print-transition")).toHaveText(["Capo: 1 → 3 · Ingrid capos up while Eric vamps", "Jeff starts alone"]);
  await box.uncheck();
  await expect(dialog.getByTestId("print-transition")).toHaveCount(0);

  await dialog.getByTestId("print-close").click();
  await page.getByTestId("show-transitions").uncheck();
  await expect(page.getByTestId("item-transition")).toHaveCount(0);
});
