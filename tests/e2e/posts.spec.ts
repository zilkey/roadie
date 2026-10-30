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
/** Ingrid's menu as stored before Posts existed: hidden sections saved, no seenSections. Null clears it (her role's defaults). */
async function setIngridMenu(request: APIRequestContext, hidden: string[] | null) {
  const uid = await uidOf(request, "ingrid@example.com");
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

test.afterAll(async ({ request }) => { await setIngridMenu(request, null); await scenario(request, { scenario: "one", kind: "system", revoked: false, failContainers: false }); });

test("Posts starts in More for a new admin and for one whose menu was saved before it; switching it on sticks; members don't get it", async ({ page, request, browser }) => {
  await setIngridMenu(request, null);
  await signInAs(page, "ingrid");
  await expect(page.getByTestId("tab-posts")).toHaveCount(0);
  await page.getByTestId("more-toggle").click();
  await page.getByTestId("more-posts").click();
  await expect(page).toHaveURL(/\/posts$/);
  await expect(page.getByTestId("page-title")).toHaveText("Posts");
  await expect(await menuSwitch(page, "posts")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("menu-done").click();

  // A menu saved before Posts (Rehearsals switched on, templates and releases off): Posts still starts off.
  await setIngridMenu(request, ["templates", "releases"]);
  await page.reload();
  const sw = await menuSwitch(page, "posts");
  await expect(page.getByTestId("menu-switch-rehearsals")).toHaveAttribute("aria-checked", "true");
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("menu-done").click();
  await page.reload();
  await expect(await menuSwitch(page, "posts")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("menu-done").click();

  const david = await (await browser.newContext()).newPage();
  await signInAs(david, "david");
  await david.getByTestId("account-menu").click();
  await david.getByTestId("account-edit-menu").click();
  await expect(david.getByTestId("menu-row-shows")).toBeVisible();
  await expect(david.getByTestId("menu-row-posts")).toHaveCount(0);
  await david.getByTestId("menu-done").click();
  await david.goto(A("/posts"));
  await expect(david).toHaveURL(/\/calendar$/);
  await david.context().close();
});

test("the Instagram & Facebook card: a personal account, several accounts, Working, Sign in again (here and on Posts), Disconnect, an Instagram token Roadie renews", async ({ page, request }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/posts"));
  await expect(page.getByTestId("posts-not-connected")).toContainText("Connect it in Settings › Integrations");
  await page.getByTestId("posts-not-connected").getByRole("link").click();
  await expect(page).toHaveURL(/\/admin\/mcp$/);
  const card = page.getByTestId("meta-card");
  await expect(card.getByTestId("meta-none")).toBeVisible();
  await expect(card.getByTestId("meta-connect")).toHaveText("Connect Instagram");

  await scenario(request, { scenario: "personal" });
  await card.getByTestId("meta-connect").click();
  await expect(card.getByTestId("error")).toContainText("Switch to professional account");
  await expect(card.getByTestId("meta-none")).toBeVisible();

  await scenario(request, { scenario: "several" });
  await card.getByTestId("meta-connect").click();
  await expect(card.getByTestId("error")).toContainText("tick only the band's");

  await scenario(request, { scenario: "one" });
  await card.getByTestId("meta-connect").click();
  await expect(card.getByTestId("meta-working")).toHaveText("Working");
  await expect(card.getByTestId("meta-note")).toHaveText("Connected.");
  await expect(card.getByTestId("meta-account")).toHaveText("@ingridavisonband");
  await expect(card.getByTestId("meta-lifetime")).toHaveText("Doesn't expire");
  await expect(card.getByTestId("meta-by")).toContainText("Connected by Jeff on");

  await scenario(request, { revoked: true });
  await page.reload();
  await expect(card.getByTestId("meta-sign-in-again")).toBeVisible();
  await expect(card.getByTestId("meta-reason")).toContainText("changed their password");
  await expect(card.getByTestId("meta-connect")).toHaveText("Connect again");
  await page.goto(A("/posts"));
  await expect(page.getByTestId("posts-sign-in-again")).toContainText("changed their password");
  await expect(page.getByTestId("new-post")).toHaveCount(0);
  await scenario(request, { revoked: false });

  await page.goto(A("/admin/mcp"));
  page.once("dialog", (d) => d.accept());
  await card.getByTestId("meta-disconnect").click();
  await expect(card.getByTestId("meta-none")).toBeVisible();
  await scenario(request, { kind: "instagram" });
  await card.getByTestId("meta-connect").click();
  await expect(card.getByTestId("meta-working")).toBeVisible();
  await expect(card.getByTestId("meta-lifetime")).toHaveText("Roadie renews it");
});

test("Post now: a JPEG chosen from Drive, then one uploaded (once a Posts folder is chosen); both list with their Instagram link", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/posts"));
  const form = page.getByTestId("new-post");
  await expect(form).toContainText("Post a photo to @ingridavisonband");
  await expect(form.getByTestId("post-now")).toBeDisabled();

  // From Drive: a PNG is refused, the JPEG is chosen.
  await form.getByTestId("post-from-drive").click();
  await form.getByTestId("drive-q").fill("cover");
  await form.getByTestId("drive-search").click();
  await form.getByTestId("hit-Wild Hearts cover 3000px.png").getByTestId("hit-check").check();
  await expect(form.locator(".err")).toContainText("Instagram takes JPEG photos");
  await form.getByTestId("drive-q").fill("Roots");
  await form.getByTestId("drive-search").click();
  await form.getByTestId("hit-Roots Music Project stage.jpg").getByTestId("hit-check").check();
  await expect(form.getByTestId("post-photo-name")).toHaveText("Roots Music Project stage.jpg");
  await form.getByTestId("post-caption").fill("Roots Music Project, thank you!");
  await expect(form.getByTestId("post-caption-count")).toHaveText("31 / 2,200");
  await form.getByTestId("post-now").click();
  await expect(form.getByTestId("post-note")).toContainText("Posted to @ingridavisonband.");
  await expect(form.getByTestId("post-note-link")).toHaveAttribute("href", /instagram\.com\/p\/FAKE/);
  const first = page.getByTestId("posts-list").locator("li").first();
  await expect(first.getByTestId("post-caption-start")).toHaveText("Roots Music Project, thank you!");
  await expect(first.getByTestId("post-by")).toContainText("Jeff");
  await expect(first.getByTestId("post-view")).toHaveAttribute("href", /instagram\.com\/p\/FAKE/);

  // Upload is off until a Posts folder is chosen in Settings › Google.
  await expect(form.getByTestId("post-upload-input")).toBeDisabled();
  await expect(form.getByTestId("post-upload-needs-folder")).toHaveText("Choose a Posts folder in Settings › Google");
  await form.getByTestId("post-upload-needs-folder").getByRole("link").click();
  const folder = page.getByTestId("google-posts-folder");
  await folder.getByTestId("posts-folder-change").click();
  await folder.getByTestId("posts-folder-q").fill("Posts");
  await folder.getByTestId("posts-folder-search").click();
  await folder.getByTestId("posts-folder-hit-Posts").getByTestId("posts-folder-choose").click();
  await expect(folder.getByTestId("posts-folder-note")).toContainText("Posts folder saved");

  await page.goto(A("/posts"));
  await expect(form.getByTestId("post-upload-input")).toBeEnabled();
  await form.getByTestId("post-upload-input").setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: Buffer.from("png") });
  await expect(form.locator(".err")).toContainText("Instagram takes JPEG photos");
  await form.getByTestId("post-upload-input").setInputFiles({ name: "Hi-Dive crowd.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  await expect(form.getByTestId("post-photo-name")).toHaveText("Hi-Dive crowd.jpg");
  await form.getByTestId("post-caption").fill("Hi-Dive, Saturday!");
  await form.getByTestId("post-now").click();
  await expect(form.getByTestId("post-note")).toContainText("Posted to @ingridavisonband.");
  const top = page.getByTestId("posts-list").locator("li").first();
  await expect(top.getByTestId("post-caption-start")).toHaveText("Hi-Dive, Saturday!");
  await expect(top.getByTestId("post-view")).toHaveAttribute("href", /instagram\.com\/p\/FAKE/);
  await expect(page.getByTestId("posts-list").locator("li")).toHaveCount(2);
});

test("a post Instagram can't take stays on the list with Instagram's reason", async ({ page, request }) => {
  await scenario(request, { failContainers: true });
  await signInAs(page, "jeff");
  await page.goto(A("/posts"));
  const form = page.getByTestId("new-post");
  await form.getByTestId("post-from-drive").click();
  await form.getByTestId("drive-q").fill("Hi-Dive load-in");
  await form.getByTestId("drive-search").click();
  await form.getByTestId("hit-Hi-Dive load-in.jpg").getByTestId("hit-check").check();
  await form.getByTestId("post-now").click();
  await expect(form.locator(".err")).toContainText("The aspect ratio is not supported");
  await expect(page.getByTestId("posts-list").locator("li").first().getByTestId("post-failed")).toContainText("Didn't post: Instagram couldn't take the photo");
  await scenario(request, { failContainers: false });
});
