import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { A, DRIVE, FIRESTORE, META } from "./env";

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
  await expect(page.getByTestId("page-title")).toHaveText("Social Media");
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
  // Not set up yet: Make the draft is off, and says why.
  await expect(page.getByTestId("photos-add")).toBeDisabled();
  await expect(page.getByTestId("photos-not-set-up")).toHaveText("Set up the Socials folder in Settings › Google");
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

test("Drafts: pick 5, Make the draft (they leave the inbox), reorder, the caption and alt text autosave; Delete draft puts them back", async ({ page, request }) => {
  // Socials was chosen and set up by the Photos test above.
  await signInAs(page, "rudy");
  await page.goto(A("/posts/photos"));
  const picks = ["fake-social-loose-2", "fake-social-late", "fake-social-rotated", "fake-social-heic-1", "fake-social-loose-1"];
  for (const p of picks) await page.getByTestId(`photo-${p}`).click();
  await expect(page.getByTestId("photos-picked")).toHaveText("5 picked");
  await page.getByTestId("photos-add").click();
  const dlg = page.getByTestId("add-to-draft");
  await dlg.getByTestId("add-to-draft-title").fill("Hi-Dive announcement");
  await expect(dlg.getByTestId("add-to-draft-note")).toContainText("Posts/DRAFT - Hi-Dive announcement");
  await dlg.getByTestId("add-to-draft-go").click();

  // The editor, in pick order.
  await expect(page).toHaveURL(/\/posts\/(?!photos)[^/?]+$/);
  const id = page.url().split("/").pop()!;
  await expect(page.getByTestId("editor-title")).toHaveText("Hi-Dive announcement");
  const order = () => page.getByTestId("editor-photos").locator("li").evaluateAll((ls) => ls.map((l) => l.getAttribute("data-testid")!.replace("editor-photo-", "")));
  await expect.poll(order).toEqual(picks);
  // Drive has the folder holding them.
  const folder = ((await (await request.get(`${DRIVE}/files?q=${encodeURIComponent("DRAFT - Hi-Dive announcement")}`)).json()) as { id: string; name: string }[])
    .find((f) => f.name === "DRAFT - Hi-Dive announcement")!;
  expect(folder).toBeTruthy();
  const inFolder = await (await request.get(`${DRIVE}/files/list?parents=${folder.id}&kind=images`)).json();
  expect(inFolder.files.map((f: { id: string }) => f.id).sort()).toEqual([...picks].sort());

  // Reorder with the buttons (a phone's way), then the caption and an alt text; all autosave.
  await page.getByTestId("editor-down-fake-social-loose-2").click();
  await expect.poll(order).toEqual(["fake-social-late", "fake-social-loose-2", ...picks.slice(2)]);
  await page.getByTestId("editor-caption").fill("Hi-Dive, Nov 14! #denver #nora");
  await expect(page.getByTestId("editor-counts")).toContainText("2 / 30 hashtags");
  await page.getByTestId("editor-alt-fake-social-late").fill("The crowd at the Creamery");
  await page.getByTestId("editor-alt-fake-social-late").blur();
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await page.reload();
  await expect(page.getByTestId("editor-caption")).toHaveValue("Hi-Dive, Nov 14! #denver #nora");
  await expect(page.getByTestId("editor-alt-fake-social-late")).toHaveValue("The crowd at the Creamery");
  await expect.poll(order).toEqual(["fake-social-late", "fake-social-loose-2", ...picks.slice(2)]);

  // Back on Photos the picked ones have left the inbox; the draft is listed on Posts.
  await page.getByTestId("editor-done").click();
  await expect(page.getByTestId(`post-${id}`)).toContainText("5 photos · Draft");
  await page.goto(A("/posts/photos"));
  await expect(page.getByTestId("photo-grid")).toBeVisible();
  for (const p of picks) await expect(page.getByTestId(`photo-${p}`)).toHaveCount(0);

  // Delete draft: every photo is back in the inbox.
  await page.goto(A(`/posts/${id}`));
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("editor-delete").click();
  await expect(page).toHaveURL(/\/posts$/);
  await expect(page.getByTestId("posts-drafts-none")).toBeVisible();
  await page.goto(A("/posts/photos"));
  for (const p of picks) await expect(page.getByTestId(`photo-${p}`)).toBeVisible();
});

test("Post now: off while Instagram needs a sign-in; then the carousel goes out in the editor's order and Drive shows YYYY-MM-DD - <name>", async ({ page, request }) => {
  // Socials was set up and Instagram connected by the tests above.
  await signInAs(page, "rudy");
  await page.goto(A("/posts/photos"));
  const picks = ["fake-social-loose-1", "fake-social-late", "fake-social-rotated", "fake-social-heic-1", "fake-social-loose-2"];
  for (const p of picks) await page.getByTestId(`photo-${p}`).click();
  await page.getByTestId("photos-add").click();
  const dlg = page.getByTestId("add-to-draft");
  await dlg.getByTestId("add-to-draft-title").fill("Thanks, Denver");
  await dlg.getByTestId("add-to-draft-go").click();
  await expect(page.getByTestId("editor-title")).toHaveText("Thanks, Denver");
  const id = page.url().split("/").pop()!;
  await page.getByTestId("editor-up-fake-social-late").click();
  await page.getByTestId("editor-caption").fill("Thank you, Denver!");
  await page.getByTestId("editor-caption").blur();
  await expect(page.getByTestId("save-status")).toContainText("Saved");

  // Instagram needs a new sign-in: the dialog says so and Post now is off.
  await scenario(request, { revoked: true });
  await page.getByTestId("editor-post").click();
  const post = page.getByTestId("post-dialog");
  await expect(post.getByTestId("post-sign-in-again")).toContainText("changed their password");
  await expect(post.getByTestId("post-now")).toBeDisabled();
  await post.getByTestId("post-cancel").click();
  await scenario(request, { revoked: false });

  await page.getByTestId("editor-post").click();
  await expect(post.getByTestId("post-account")).toContainText("A carousel of 5 photos goes to @noraquillband");
  await expect(post.getByTestId("post-no-alt")).toContainText("None of the photos have alt text.");
  await expect(post.getByTestId("post-drive-note")).toContainText("Posts/DRAFT - Thanks, Denver");
  await post.getByTestId("post-now").click();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await expect(post.getByTestId("post-done-folder")).toContainText(`Posts/${today} - Thanks, Denver`, { timeout: 30_000 });
  await expect(post.getByTestId("post-done-permalink")).toHaveAttribute("href", /instagram\.com\/p\/FAKE/);
  await expect(page.getByTestId("celebration-title")).toHaveText("Posted!");
  await expect(page.getByTestId("celebration-text")).toHaveText("Thanks, Denver is on Instagram");

  // Meta got the photos in the editor's order; the fake Drive has the folder under its posted name.
  const media = ((await (await request.get(`${META}/__media`)).json()) as { media: { caption: string; children?: { imageUrl: string }[] }[] }).media;
  const last = media[media.length - 1];
  expect(last.caption).toBe("Thank you, Denver!");
  expect(last.children!.map((c) => new URL(c.imageUrl).pathname)).toEqual([0, 1, 2, 3, 4].map((i) => `/api/posts/media/${id}/${i}`));
  const names = ((await (await request.get(`${DRIVE}/files?q=${encodeURIComponent("Thanks, Denver")}`)).json()) as { name: string }[]).map((f) => f.name);
  expect(names).toContain(`${today} - Thanks, Denver`);
  expect(names).not.toContain("DRAFT - Thanks, Denver");

  // The editor is read-only now, and Posts lists it as posted.
  await post.getByTestId("post-done-close").click();
  await expect(page.getByTestId(`post-${id}`)).toContainText("5 photos · Posted");
  await page.goto(A(`/posts/${id}`));
  await expect(page.getByTestId("editor-status")).toHaveText("Posted");
  await expect(page.getByTestId("editor-caption")).toHaveCount(0);
});
