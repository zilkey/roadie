import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { A, FIRESTORE, META } from "./env";

// Instagram runs against fakes/fake-meta (playwright.config.ts): Connect goes to its Unified login dialog, which comes straight
// back with a code; /__scenario sets what that sign-in finds and which kind of token it gives. Post now makes Meta's fake fetch the photo from our signed link.

const DOCS = `http://${FIRESTORE}/v1/projects/demo-band-tracker/databases/(default)/documents`;
const OWNER = { authorization: "Bearer owner" };

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
const scenario = (request: APIRequestContext, body: Record<string, unknown>) => request.post(`${META}/__scenario`, { data: body });

async function uidOf(request: APIRequestContext, email: string) {
  const res = await request.get(`${DOCS}/users?pageSize=100`, { headers: OWNER });
  const docs = ((await res.json()) as { documents: { name: string; fields: { email?: { stringValue: string } } }[] }).documents;
  return docs.find((d) => d.fields.email?.stringValue === email)!.name.split("/").pop()!;
}
/** Nora's menu as stored before Posts existed: hidden sections saved, no seenSections. Null clears it (her role's defaults). */
async function setNoraMenu(request: APIRequestContext, hidden: string[] | null) {
  const uid = await uidOf(request, "nora@example.com");
  if (!hidden) { await request.delete(`${DOCS}/userPrefs/${uid}`, { headers: OWNER }); return; }
  const res = await request.patch(`${DOCS}/userPrefs/${uid}`, { headers: OWNER, data: { fields: {
    uid: { stringValue: uid }, hiddenSections: { arrayValue: { values: hidden.map((s) => ({ stringValue: s })) } },
  } } });
  expect(res.ok()).toBeTruthy();
}
async function menuSwitch(page: Page, key: string) {
  await page.getByTestId("account-menu").click();
  await page.getByTestId("account-edit-menu").click();
  return page.getByTestId(`menu-switch-${key}`);
}

test.afterAll(async ({ request }) => { await setNoraMenu(request, null); await scenario(request, { scenario: "one", kind: "system", revoked: false, failContainers: false }); });

test("Posts starts in More for a new admin; switching it on sticks; members don't get it", async ({ page, request, browser }) => {
  await setNoraMenu(request, null);
  await signInAs(page, "nora");
  await expect(page.getByTestId("tab-posts")).toHaveCount(0);
  await page.getByTestId("more-toggle").click();
  await page.getByTestId("more-posts").click();
  await expect(page).toHaveURL(/\/posts$/);
  await expect(page.getByTestId("page-title")).toHaveText("Posts");
  await expect(await menuSwitch(page, "posts")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("menu-done").click();

  // Switching it on sticks (a menu saved before Posts existed is covered in tests/emulator/prefs.test.ts).
  await page.reload();
  const sw = await menuSwitch(page, "posts");
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("menu-done").click();
  await page.reload();
  await expect(await menuSwitch(page, "posts")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("menu-done").click();

  const hugo = await (await browser.newContext()).newPage();
  await signInAs(hugo, "hugo");
  await hugo.getByTestId("account-menu").click();
  await hugo.getByTestId("account-edit-menu").click();
  await expect(hugo.getByTestId("menu-row-shows")).toBeVisible();
  await expect(hugo.getByTestId("menu-row-posts")).toHaveCount(0);
  await hugo.getByTestId("menu-done").click();
  await hugo.goto(A("/posts"));
  await expect(hugo).toHaveURL(/\/calendar$/);
  await hugo.context().close();
});

test("the Instagram & Facebook card: Working, Sign in again (here and on Posts)", async ({ page, request }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/posts"));
  await expect(page.getByTestId("posts-not-connected")).toContainText("Connect it in Settings › Integrations");
  await page.getByTestId("posts-not-connected").getByRole("link").click();
  await expect(page).toHaveURL(/\/admin\/mcp$/);
  const card = page.getByTestId("meta-card");
  await expect(card.getByTestId("meta-none")).toBeVisible();
  await expect(card.getByTestId("meta-connect")).toHaveText("Connect Instagram");

  await scenario(request, { scenario: "one" });
  await card.getByTestId("meta-connect").click();
  await expect(card.getByTestId("meta-working")).toHaveText("Working");
  await expect(card.getByTestId("meta-note")).toHaveText("Connected.");
  await expect(card.getByTestId("meta-account")).toHaveText("@noraquillband");
  await expect(card.getByTestId("meta-lifetime")).toHaveText("Doesn't expire");
  await expect(card.getByTestId("meta-by")).toContainText("Connected by Rudy on");

  await scenario(request, { revoked: true });
  await page.reload();
  await expect(card.getByTestId("meta-sign-in-again")).toBeVisible();
  await expect(card.getByTestId("meta-reason")).toContainText("changed their password");
  await expect(card.getByTestId("meta-connect")).toHaveText("Connect again");
  await page.goto(A("/posts"));
  await expect(page.getByTestId("posts-sign-in-again")).toContainText("changed their password");
  await expect(page.getByTestId("new-post")).toHaveCount(0);
  await scenario(request, { revoked: false });
});

test("Photos: Upload is off until Set up; the inbox by day, the late-night photo on the show's day; picking is numbered; an upload lands in Socials", async ({ page }) => {
  await signInAs(page, "rudy");
  await page.goto(A("/posts"));
  await page.getByTestId("posts-tab-photos").click();
  await expect(page).toHaveURL(/\/posts\/photos$/);
  // No Socials folder yet: Photos says where to choose it.
  await expect(page.getByTestId("error")).toContainText("Choose the Socials folder in Settings › Google first");

  await page.goto(A("/admin/google"));
  const folder = page.getByTestId("google-posts-folder");
  await folder.getByTestId("posts-folder-change").click();
  await folder.getByTestId("posts-folder-q").fill("Socials");
  await folder.getByTestId("posts-folder-search").click();
  await folder.getByTestId("posts-folder-hit-Socials").getByTestId("posts-folder-choose").click();
  await expect(folder.getByTestId("posts-folder-note")).toContainText("Socials folder saved");

  // Chosen but not set up: the photos show, Upload is off.
  await page.goto(A("/posts/photos"));
  await expect(page.getByTestId("photos-upload-input")).toBeDisabled();
  await expect(page.getByTestId("photos-upload-needs-folder")).toHaveText("Set up the Socials folder in Settings › Google");
  const rail = page.getByTestId("photos-rail");
  await expect(rail.getByTestId("photos-folder-fake-folder-socials-phone")).toContainText("Jeff's phone spring 26");
  await expect(rail.getByTestId("photos-folder-fake-folder-socials-phone")).toContainText("6");
  // IMG_2210 was taken at 01:30 on Oct 11: it's on Oct 10, labelled with that night's show.
  const oct10 = page.getByTestId("photo-day-2026-10-10");
  await expect(oct10.getByTestId("photo-day-label-2026-10-10")).toContainText("Creamery Arts Center");
  await expect(oct10.getByTestId("photo-fake-social-late")).toBeVisible();
  await expect(page.getByTestId("photo-day-2026-10-11")).toHaveCount(0);

  // Picking is numbered in tap order; Select all adds the rest of the day.
  await page.getByTestId("photo-fake-social-loose-2").click();
  await page.getByTestId("photo-fake-social-late").click();
  await expect(page.getByTestId("photo-pick-fake-social-loose-2")).toHaveText("1");
  await expect(page.getByTestId("photo-pick-fake-social-late")).toHaveText("2");
  await oct10.getByTestId("photo-day-all-2026-10-10").click();
  await expect(page.getByTestId("photos-picked")).toHaveText(`${2 + (await oct10.locator("li").count()) - 1} picked`);
  await page.getByTestId("photos-clear").click();
  await expect(page.getByTestId("photos-bar")).toHaveCount(0);

  // A folder in the rail shows only its photos.
  await rail.getByTestId("photos-folder-fake-folder-socials-2026-10").click();
  await expect(page.getByTestId("photo-grid").locator("li")).toHaveCount(1);
  await rail.getByTestId("photos-folder-all").click();

  await page.goto(A("/admin/google"));
  await folder.getByTestId("socials-setup-button").click();
  await expect(folder.getByTestId("socials-posts-row")).toHaveText("Working");
  await page.goto(A("/posts/photos"));
  await expect(page.getByTestId("photos-upload-input")).toBeEnabled();
  await page.getByTestId("photos-upload-input").setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") });
  await expect(page.locator(".err")).toContainText("Roadie takes JPEG, HEIC, PNG and WebP photos");
  await page.getByTestId("photos-upload-input").setInputFiles({ name: "Deep End crowd.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  await expect(page.getByTestId("photos-upload-done")).toContainText("Uploaded to Socials");
  await expect(page.getByTestId("photo-grid").locator('[title="Deep End crowd.jpg"]')).toBeVisible();

  // The Posts tab has no drafts yet.
  await page.getByTestId("photos-rail-posts").click();
  await expect(page.getByTestId("posts-drafts-none")).toBeVisible();
});
