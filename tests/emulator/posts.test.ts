import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { dispatch } from "@/server/commands/dispatch";
import { firestore } from "@/server/admin";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { driveClient } from "@/server/integrations";
import { RENEW_AFTER_MS, unsealMeta } from "@/server/meta/connection";
import { signMediaUrl, mediaSigOk } from "@/server/meta/media";
import { graph, signMetaState, verifyMetaState } from "@/server/meta/graph";
import { GET as mediaGET } from "@/app/api/posts/media/[postId]/[index]/route";
import { POST as uploadPOST } from "@/app/api/posts/upload/route";
import { GET as thumbGET } from "@/app/api/posts/thumb/[artistId]/[fileId]/route";
import { photosLimits } from "@/server/commands/posts";
import { findOrMakeFolder } from "@/server/driveFolders";
import { thumbUrl } from "@/server/signedUrl";
import { dayLabels, groupByDay } from "@/lib/photoDays";
import sharp from "sharp";
import { GET as callbackGET } from "@/app/api/meta/callback/route";
import { SOCIALS_FOLDER_ID } from "../../fakes/fake-drive/server";
import { dateInBandZone } from "@/lib/timezone";
import { migratePosts49, titleFor, INTERRUPTED } from "../../scripts/migrate-posts-49";
import { resetEmulators, makeUser, TEST_ARTIST } from "./helpers";
import { undoRun } from "@/server/undo";
import { eligibleCommands, isReadOnly, needsConfirm, summarize, voiceConfirmable } from "@/server/assistant/policy";

let stop: () => Promise<void>;
let dir: string;
let META: string;
let app: http.Server;
let ctx: Ctx;
let rudy: { uid: string; token: string }, hugo: { uid: string; token: string };

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.DRIVE_BASE_URL = s.running["fake-drive"].url;
  META = s.running["fake-meta"].url;
  Object.assign(process.env, {
    META_APP_ID: "fake-meta-app", META_CONFIG_ID: "fake-meta-config", META_APP_SECRET: "fake-meta-secret", META_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64"),
    META_GRAPH_URL: META, META_IG_URL: `${META}/ig`, META_DIALOG_URL: `${META}/dialog/oauth`,
  });
  // Our side of the signed media link, so the fake fetches the photo from the real route like Meta does.
  app = http.createServer(async (rq, rs) => {
    const m = /^\/api\/posts\/media\/([^/?]+)\/([^/?]+)/.exec(rq.url ?? "");
    if (!m) { rs.writeHead(404); rs.end(); return; }
    const res = await mediaGET(new Request(`http://app${rq.url}`), { params: Promise.resolve({ postId: decodeURIComponent(m[1]), index: m[2] }) });
    rs.writeHead(res.status, Object.fromEntries(res.headers));
    rs.end(Buffer.from(await res.arrayBuffer()));
  });
  await new Promise<void>((ok) => app.listen(0, "127.0.0.1", ok));
  process.env.APP_URL = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
});
after(async () => { await stop(); app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const code = (p: Promise<unknown>, c: string) => assert.rejects(p, (e: any) => e.code === c); // eslint-disable-line @typescript-eslint/no-explicit-any
const scenario = (body: Record<string, unknown>) => fetch(`${META}/__scenario`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Connect as Rudy: the dialog URL, then the fake's redirect to the callback, then the code and state the Integrations page gets. */
async function signIn(c: Ctx = ctx) {
  const { url } = await cmd("meta.connectUrl", {}, c);
  const back = (await fetch(url, { redirect: "manual" })).headers.get("location")!;
  const fwd = await callbackGET(new Request(back));
  assert.equal(fwd.status, 303);
  const q = new URL(fwd.headers.get("location")!).searchParams;
  return { code: q.get("meta_code"), state: q.get("meta_state"), error: q.get("meta_error"), location: fwd.headers.get("location")! };
}
const connect = async () => { const s = await signIn(); return cmd("meta.finishConnect", { code: s.code, state: s.state }); };

beforeEach(async () => {
  await resetEmulators();
  for (const f of ["fake-drive", "fake-meta"]) await fetch(`${f === "fake-drive" ? process.env.DRIVE_BASE_URL : META}/__reset`, { method: "POST" });
  rudy = await makeUser("rudy@example.com", "admin", { name: "Rudy" });
  hugo = await makeUser("hugo@example.com", "member", { name: "Hugo" });
  ctx = { uid: rudy.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
  for (const k of ["rudy", "nora"]) await db.create(ctx, "musicians", { name: k, instruments: [], active: true, email: `${k}@example.com` });
  await db.create(ctx, "artists", { slug: "band", name: "Band", driveFolderId: "fake-band-folder", links: {}, configurations: [] }, { id: TEST_ARTIST });
});

// ---------- connecting ----------

const stored = async () => (await firestore().doc(`metaConnections/${TEST_ARTIST}`).get()).data()!;
const backdate = (ms: number) => firestore().doc(`metaConnections/${TEST_ARTIST}`).update({ renewedAt: new Date(Date.now() - ms) });
const rejects = (p: Promise<unknown>, c: string, re: RegExp) => assert.rejects(p, (e: any) => e.code === c && re.test(e.message)); // eslint-disable-line @typescript-eslint/no-explicit-any

test("the dialog is Unified login's (config_id, no scope list); the callback only forwards a state this server signed, to the band's Integrations page", async () => {
  const { url } = await cmd("meta.connectUrl", {});
  const q = new URL(url).searchParams;
  assert.equal(q.get("config_id"), "fake-meta-config");
  assert.equal(q.get("scope"), null);
  assert.match(q.get("redirect_uri")!, /\/api\/meta\/callback$/);
  const s = await signIn();
  assert.match(s.location, /\/artists\/band\/admin\/mcp\?meta_code=fake-code-\d+&meta_state=/);
  assert.equal((await callbackGET(new Request("http://x/api/meta/callback?code=c&state=forged.state"))).status, 400);
  await scenario({ scenario: "cancel" });
  assert.equal((await signIn()).error, "user_denied");
  // a state is tied to the admin and the band
  const st = verifyMetaState(signMetaState({ uid: rudy.uid, artistId: TEST_ARTIST, slug: "band" }))!;
  assert.equal(st.artistId, TEST_ARTIST);
  assert.equal(verifyMetaState(signMetaState({ uid: rudy.uid, artistId: TEST_ARTIST, slug: "band" }, -1)), null, "expired");
});

test("a system-user token: connected to the one account picked, Doesn't expire, Working, and the token never leaves the server", async () => {
  assert.deepEqual(await cmd("meta.status", {}), { configured: true, connection: null, check: null });
  const out = await connect();
  assert.equal(out.connection.kind, "system");
  assert.deepEqual(out.connection.instagram, { id: "ig-1", username: "noraquillband" });
  assert.equal(out.connection.renews, false);
  assert.equal(out.connection.expiresAt, null);
  assert.equal(out.connection.connectedBy.name, "Rudy");
  assert.deepEqual(out.check, { working: true, username: "noraquillband" });
  // stored sealed with its portfolio, never in a command's answer
  const raw = await stored();
  assert.match(unsealMeta(raw.token), /^EAAsys/);
  assert.doesNotMatch(raw.token, /EAAsys/);
  assert.equal(raw.businessId, "business-1");
  assert.equal(raw.configId, "fake-meta-config");
  for (const name of ["meta.status", "meta.connectUrl", "meta.disconnect"]) assert.ok(!JSON.stringify(await cmd(name, {})).includes("EAAsys"), name);
  assert.ok(!JSON.stringify(out).includes("EAAsys"));
});

test("a system-user token that expires: good until then, and Sign in again after", async () => {
  await scenario({ systemExpiresIn: 30 * 24 * 60 * 60 });
  const out = await connect();
  assert.equal(out.connection.renews, false);
  assert.ok(Math.abs(Date.parse(out.connection.expiresAt) - (Date.now() + 30 * 24 * 60 * 60_000)) < 60_000);
  await firestore().doc(`metaConnections/${TEST_ARTIST}`).update({ expiresAt: new Date(Date.now() - 1000) });
  assert.deepEqual((await cmd("meta.status", {})).check, { working: false, reason: "The sign-in expired." });
  await code(cmd("posts.publish", { id: await oneDraft() }), "meta_sign_in_again");
});

test("an Instagram User token: exchanged for 60 days, the account read from /me, Roadie renews it", async () => {
  await scenario({ kind: "instagram" });
  const out = await connect();
  assert.equal(out.connection.kind, "instagram");
  assert.deepEqual(out.connection.instagram, { id: "ig-1", username: "noraquillband" });
  assert.equal(out.connection.renews, true);
  assert.ok(Math.abs(Date.parse(out.connection.expiresAt) - (Date.now() + 60 * 24 * 60 * 60_000)) < 60_000);
  assert.deepEqual(out.check, { working: true, username: "noraquillband" });
  assert.match(unsealMeta((await stored()).token), /^IGAAlong-/, "the 60-day token is kept, not the hour-long one");
  assert.ok(!JSON.stringify(out).includes("IGAA"));
});

test("renewal: not before it's due, renewed once it is (on status and before a publish), and a refusal reads Sign in again", async () => {
  await scenario({ kind: "instagram" });
  await connect();
  const first = await stored();
  await cmd("meta.status", {});
  assert.equal((await stored()).token, first.token, "a fresh token isn't renewed");

  // Due by our clock, but Instagram says it's under 24 hours old: Sign in again with Instagram's reason, on status and publish.
  await backdate(RENEW_AFTER_MS + 1000);
  const refused = await cmd("meta.status", {});
  assert.equal(refused.check.working, false);
  assert.match(refused.check.reason, /at least 24 hours old/);
  const draft = await oneDraft();
  await rejects(cmd("posts.publish", { id: draft }), "meta_sign_in_again", /24 hours old.*Connect again in Settings › Integrations/);
  assert.equal((await db.get("posts", draft))!.status, "draft", "nothing is posted with a dead sign-in, and the draft stays a draft");

  // Connect again, and let a week pass on both sides: status renews it.
  await connect();
  await scenario({ ageHours: 8 * 24 });
  await backdate(RENEW_AFTER_MS + 1000);
  const before = await stored();
  assert.equal((await cmd("meta.status", {})).check.working, true);
  const after = await stored();
  assert.notEqual(unsealMeta(after.token), unsealMeta(before.token));
  assert.equal(after.renewError, null);
  assert.ok(Date.now() - after.renewedAt.toDate().getTime() < 60_000);
  assert.ok(Math.abs(after.expiresAt.toDate().getTime() - (Date.now() + 60 * 24 * 60 * 60_000)) < 60_000);

  // And a publish renews it first when it's due.
  await scenario({ ageHours: 8 * 24 });
  await backdate(RENEW_AFTER_MS + 1000);
  assert.equal((await cmd("posts.publish", { id: draft })).status, "posted");
  assert.notEqual(unsealMeta((await stored()).token), unsealMeta(after.token));
});

test("a revoked token reads Sign in again with Meta's reason; Disconnect deletes the connection and connecting again works", async () => {
  await connect();
  await scenario({ revoked: true });
  const s = await cmd("meta.status", {});
  assert.equal(s.check.working, false);
  assert.match(s.check.reason, /changed their password/);
  const off = await cmd("meta.disconnect", {});
  assert.equal(off.connection, null);
  assert.equal((await firestore().doc(`metaConnections/${TEST_ARTIST}`).get()).exists, false);
  await scenario({ revoked: false });
  assert.equal((await connect()).check.working, true);
});

test("a declined permission, a personal account, no account and several accounts each say what to do, and store nothing", async () => {
  for (const kind of ["system", "instagram"]) {
    await scenario({ kind, scenario: "declined" });
    await rejects(connect(), "meta_declined", /post to Instagram \(instagram(_business)?_content_publish\).*Connect Instagram again/);
    await scenario({ scenario: "personal" });
    await rejects(connect(), "meta_not_professional", /personal account.*Switch to professional account/);
  }
  await scenario({ kind: "system", scenario: "none" });
  await rejects(connect(), "meta_no_account", /professional account \(Business or Creator\) in the band's business portfolio/);
  await scenario({ scenario: "several" });
  await rejects(connect(), "meta_several_accounts", /2 Instagram accounts \(@noraquillband and @norasolo\).*tick only the band's/);
  assert.equal((await cmd("meta.status", {})).connection, null);
});

test("finishConnect refuses a state another admin started; members can't connect at all", async () => {
  const s = await signIn();
  const nora = await makeUser("nora@example.com", "admin", { name: "Nora" });
  await code(cmd("meta.finishConnect", { code: s.code, state: s.state }, { ...ctx, uid: nora.uid }), "invalid_state");
  await code(cmd("meta.finishConnect", { code: s.code, state: s.state }, { ...ctx, artistId: "another-band" }), "invalid_state");
  for (const name of ["meta.status", "meta.connectUrl", "meta.disconnect", "posts.publish", "posts.tidy"]) {
    assert.equal((await dispatch(name, `Bearer ${hugo.token}`, {})).status, 403, name);
  }
});

// ---------- the signed media URL ----------

/** Set up Socials (once) and make a draft of these photos; its id. */
async function oneDraft(photos: string[] = ["fake-social-loose-1"], title = "Thanks, Roots") {
  if (!(await db.get("artists", TEST_ARTIST))!.postFoldersId) {
    await cmd("google.setPostsFolder", { folder: `https://drive.google.com/drive/folders/${SOCIALS_FOLDER_ID}` });
    await cmd("posts.setup", {});
  }
  return (await cmd("posts.createDraft", { title, driveFileIds: photos })).id as string;
}
const media = (url: string) => {
  const m = /\/api\/posts\/media\/([^/?]+)\/([^/?]+)/.exec(url)!;
  return mediaGET(new Request(url), { params: Promise.resolve({ postId: decodeURIComponent(m[1]), index: m[2] }) });
};
const pixels = async (res: Response) => sharp(Buffer.from(await res.arrayBuffer()));

test("media URL: a signed link renders that photo within the hour; expired, a wrong signature, another photo's index and another band's post are 404s", async () => {
  const id = await oneDraft(["fake-social-loose-1", "fake-social-late"]);
  const ok = await media(signMediaUrl(TEST_ARTIST, id, 1));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/jpeg");
  assert.equal(ok.headers.get("cache-control"), "private, no-store");
  assert.equal((await media(signMediaUrl(TEST_ARTIST, id, 0, Date.now() - 2 * 60 * 60_000))).status, 404, "expired");
  const u = new URL(signMediaUrl(TEST_ARTIST, id, 0));
  u.searchParams.set("sig", u.searchParams.get("sig")!.replace(/^./, (c) => (c === "a" ? "b" : "a")));
  assert.equal((await media(u.toString())).status, 404, "wrong signature");
  assert.equal((await media(signMediaUrl(TEST_ARTIST, id, 0).replace(`/${id}/0?`, `/${id}/1?`))).status, 404, "index 0's link doesn't open photo 1");
  assert.equal((await media(signMediaUrl(TEST_ARTIST, id, 5))).status, 404, "no such photo");
  const other = (await db.create({ ...ctx, artistId: "another-band" }, "posts", { artistId: "another-band", caption: "c", media: [{ driveFileId: "fake-photo-roots", mimeType: "image/jpeg" }], status: "draft", createdVia: "app" })).id;
  assert.equal((await media(signMediaUrl(TEST_ARTIST, other, 0))).status, 404, "a link signed for this band doesn't open another band's post");
  assert.equal(mediaSigOk(TEST_ARTIST, id, "0", null, null), false);
});

test("media route: the sideways JPEG comes out 1080×1350 and upright; focus moves the crop; Square is 1080×1080", async () => {
  // photo-rotated.jpg: 1200×900 stored, EXIF 6, so 900×1200 upright; photo-landscape.jpg: 1600×1000 in four coloured quadrants.
  const id = await oneDraft(["fake-social-rotated", "fake-social-loose-1"]);
  const rotated = await pixels(await media(signMediaUrl(TEST_ARTIST, id, 0)));
  const meta = await rotated.metadata();
  assert.deepEqual([meta.width, meta.height, meta.orientation ?? 1], [1080, 1350, 1], "upright, no EXIF rotation left");
  // The landscape photo: a 4:5 crop at the left edge vs the right edge shows different quadrants.
  const at = async (x: number) => {
    await cmd("posts.updateDraft", { id, patch: { items: { "fake-social-rotated": { alt: "" }, "fake-social-loose-1": { focus: { x, y: 0.5 } } } } });
    const img = await pixels(await media(signMediaUrl(TEST_ARTIST, id, 1)));
    const { data } = await img.clone().extract({ left: 540, top: 300, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    return [...data];
  };
  const left = await at(0), right = await at(1);
  assert.notDeepEqual(left, right, "focus moved the crop");
  await cmd("posts.updateDraft", { id, patch: { aspect: "1:1" } });
  const sq = await (await pixels(await media(signMediaUrl(TEST_ARTIST, id, 1)))).metadata();
  assert.deepEqual([sq.width, sq.height], [1080, 1080]);
});

test("media route: a HEIC renders from Drive's 2048 preview; with no preview yet it says so", async () => {
  // The fake has no bytes for a HEIC original, so a 200 here can only have come from the thumbnail.
  const id = await oneDraft(["fake-social-loose-2"]);
  const res = await media(signMediaUrl(TEST_ARTIST, id, 0));
  assert.equal(res.status, 200);
  const m = await (await pixels(res)).metadata();
  assert.deepEqual([m.width, m.height], [1080, 1350]);
  await driveScenario({ noThumbnail: ["fake-social-loose-2"] });
  const none = await media(signMediaUrl(TEST_ARTIST, id, 0));
  assert.equal(none.status, 503);
  assert.equal(await none.text(), "Drive hasn't made a preview of IMG_4412 yet; try again in a minute");
});

const driveScenario = (body: Record<string, unknown>) => fetch(`${process.env.DRIVE_BASE_URL}/__scenario`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const chooseSocials = () => cmd("google.setPostsFolder", { folder: `https://drive.google.com/drive/folders/${SOCIALS_FOLDER_ID}` });

// ---------- setup ----------

test("setup: refused before Socials is chosen; makes Posts in Socials and shares Socials with the band as writer", async () => {
  await assert.rejects(cmd("posts.setup", {}), (e: any) => e.code === "no_posts_folder" && e.message === "Choose the Socials folder in Settings › Google first"); // eslint-disable-line @typescript-eslint/no-explicit-any
  const s = await chooseSocials();
  assert.deepEqual(s.posts, { socialsId: SOCIALS_FOLDER_ID, socialsName: "Socials", setUp: false });

  const r = await cmd("posts.setup", {});
  assert.deepEqual(r.socials, { id: SOCIALS_FOLDER_ID, name: "Socials" });
  assert.equal(r.posts.made, true);
  assert.equal(r.sharedWithBand, 2, "rudy and nora, the active musicians");
  const drive = driveClient({ artistId: TEST_ARTIST });
  const posts = await drive.get(r.posts.id);
  assert.equal(posts.name, "Posts");
  assert.deepEqual(posts.parents, [SOCIALS_FOLDER_ID]);
  assert.equal((await db.get("artists", TEST_ARTIST))!.postFoldersId, r.posts.id);
  const socials = await drive.get(SOCIALS_FOLDER_ID);
  for (const e of ["rudy@example.com", "nora@example.com"]) {
    const p = socials.permissions.find((x) => x.email === e)!;
    assert.ok(p.role === "writer" || p.role === "owner", `${e} can add to Socials (${p.role})`);
  }
  assert.equal(socials.permissions.find((x) => x.email === "nora@example.com")!.role, "writer");

  const status = await cmd("google.status", {});
  assert.deepEqual(status.posts, { socialsId: SOCIALS_FOLDER_ID, socialsName: "Socials", postsId: r.posts.id, setUp: true });
});

test("setup: a second run finds Posts and shares Socials with members who joined since", async () => {
  await chooseSocials();
  const first = await cmd("posts.setup", {});
  await db.create(ctx, "musicians", { name: "felix", instruments: [], active: true, email: "felix@example.com" });
  const second = await cmd("posts.setup", {});
  assert.equal(second.posts.made, false);
  assert.equal(second.posts.id, first.posts.id);
  assert.equal(second.sharedWithBand, 3);
  const drive = driveClient({ artistId: TEST_ARTIST });
  assert.equal((await drive.list({ parents: [SOCIALS_FOLDER_ID], kind: "folders" })).files.filter((f) => f.name === "Posts").length, 1, "one Posts folder");
  assert.equal((await drive.get(SOCIALS_FOLDER_ID)).permissions.find((x) => x.email === "felix@example.com")!.role, "writer");
});

test("setup: refused, changing nothing, when the band account can't move files in Socials", async () => {
  await chooseSocials();
  await driveScenario({ noMove: true });
  await assert.rejects(cmd("posts.setup", {}), (e: any) => e.code === "drive_permission" && e.message === "Roadie's Google account needs Content manager on the band's Shared Drive to move photos"); // eslint-disable-line @typescript-eslint/no-explicit-any
  const drive = driveClient({ artistId: TEST_ARTIST });
  assert.equal((await drive.list({ parents: [SOCIALS_FOLDER_ID], kind: "folders" })).files.some((f) => f.name === "Posts"), false);
  assert.equal((await db.get("artists", TEST_ARTIST))!.postFoldersId, undefined);
  assert.equal((await drive.get(SOCIALS_FOLDER_ID)).permissions.find((x) => x.email === "nora@example.com")!.role, "reader", "not shared as writer");
});

test("setup: choosing a different Socials folder clears Posts, so Set up runs again; artists.update can't set it", async () => {
  await chooseSocials();
  await cmd("posts.setup", {});
  await chooseSocials();
  assert.ok((await db.get("artists", TEST_ARTIST))!.postFoldersId, "choosing the same folder keeps it");
  const s = await cmd("google.setPostsFolder", { folder: "https://drive.google.com/drive/folders/fake-folder-posts" });
  assert.equal((await db.get("artists", TEST_ARTIST))!.postFoldersId, undefined);
  assert.equal(s.posts.setUp, false);
  assert.throws(() => registry["artists.update"].input.parse({ id: TEST_ARTIST, patch: { postFoldersId: "x" } }));
});

// ---------- upload ----------

const jpeg = (name = "Roots.jpg", type = "image/jpeg") => new File([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], name, { type });
async function upload(token: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  const res = await uploadPOST(new Request("http://app/api/posts/upload", { method: "POST", headers: { authorization: `Bearer ${token}`, "x-artist-id": TEST_ARTIST }, body }));
  return { status: res.status, json: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

test("upload: refused until Set up has run, for anything but a photo, and for members; else into the Socials root", async () => {
  const none = await upload(rudy.token, jpeg());
  assert.equal(none.status, 400);
  assert.equal(none.json.error.message, "Choose the Socials folder in Settings › Google first");
  await chooseSocials();
  const notSetUp = await upload(rudy.token, jpeg());
  assert.equal(notSetUp.status, 400);
  assert.equal(notSetUp.json.error.message, "Set up the Socials folder in Settings › Google");
  await cmd("posts.setup", {});
  const pdf = await upload(rudy.token, jpeg("x.pdf", "application/pdf"));
  assert.equal(pdf.status, 400);
  assert.equal(pdf.json.error.message, "Roadie takes JPEG, HEIC, PNG and WebP photos");
  assert.equal((await upload(hugo.token, jpeg())).status, 403);

  const a = await upload(rudy.token, jpeg("Roots.jpg"));
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.deepEqual({ id: a.json.folder.id, name: a.json.folder.name }, { id: SOCIALS_FOLDER_ID, name: "Socials" });
  const drive = driveClient({ artistId: TEST_ARTIST });
  const f = await drive.get(a.json.driveFileId);
  assert.equal(f.name, "Roots.jpg");
  assert.deepEqual(f.parents, [SOCIALS_FOLDER_ID], "loose in the Socials root, in the inbox");
  assert.deepEqual(f.permissions.map((p) => p.email), ["rudy@example.com"], "not shared file by file: Socials is shared with the band");
  // A HEIC from a phone often comes as octet-stream: it's kept as the photo type its name says.
  const heic = await upload(rudy.token, jpeg("IMG_2201.HEIC", "application/octet-stream"));
  assert.equal(heic.status, 200, JSON.stringify(heic.json));
  assert.equal(heic.json.mimeType, "image/heic");
  assert.equal((await db.list("posts")).length, 0, "nothing is posted yet");
});

// ---------- migrating the #49 posts ----------

test("migration: the title is the caption's first 40 characters cut at a word, else Photo <date>", () => {
  assert.equal(titleFor("Roots Music Project, thank you!", "2026-10-03"), "Roots Music Project, thank you!");
  assert.equal(titleFor("Thanks to everyone who came out to the Hi-Dive last night, you were great", "2026-10-03"), "Thanks to everyone who came out to the");
  assert.equal(titleFor("  ", "2026-10-03"), "Photo 2026-10-03");
});

test("migration: a dry run changes nothing; --apply moves each #49 photo into its own post folder; a second run changes nothing", async () => {
  const drive = driveClient({ artistId: TEST_ARTIST });
  const MONTH = "fake-folder-socials-2026-10";
  const media = (id: string, url = "u") => [{ driveFileId: id, mimeType: "image/jpeg", url }];
  const posted = (await db.create(ctx, "posts", { artistId: TEST_ARTIST, caption: "Roots Music Project, thank you!", media: media("fake-social-post49"), status: "posted", instagram: { mediaId: "m1", permalink: null }, createdVia: "app" })).id;
  const stuck = (await db.create(ctx, "posts", { artistId: TEST_ARTIST, caption: "", media: media("fake-social-loose-1"), status: "publishing", createdVia: "app" })).id;
  const gone = (await db.create(ctx, "posts", { artistId: TEST_ARTIST, caption: "Gone", media: media("no-such-photo"), status: "failed", error: "x", createdVia: "app" })).id;

  // Before Set up, the artist's posts are left with a reason.
  await chooseSocials();
  const early = await migratePosts49({ apply: true });
  assert.equal(early.migrated.length, 0);
  assert.match(early.skipped[0].reason, /run Set up/);
  const { posts: { id: postsId } } = await cmd("posts.setup", {});

  const created = dateInBandZone((await db.get("posts", posted))!.createdAt.toDate());
  const before = JSON.stringify([await db.list("posts"), await drive.list({ parents: [postsId, MONTH, SOCIALS_FOLDER_ID], kind: "all" })]);
  const dry = await migratePosts49({ apply: false });
  assert.deepEqual(dry.migrated.map((m) => [m.postId, m.folder]).sort(), [[posted, `${created} - Roots Music Project, thank you!`], [stuck, `DRAFT - Photo ${created}`]].sort());
  assert.deepEqual(dry.skipped.map((s) => s.postId), [gone]);
  assert.equal(JSON.stringify([await db.list("posts"), await drive.list({ parents: [postsId, MONTH, SOCIALS_FOLDER_ID], kind: "all" })]), before, "the dry run changed nothing");

  const r = await migratePosts49({ apply: true });
  assert.equal(r.migrated.length, 2);
  assert.deepEqual(r.skipped.map((s) => s.postId), [gone], "the post whose photo is gone is reported and skipped");
  const p = (await db.get("posts", posted))!;
  assert.equal(p.title, "Roots Music Project, thank you!");
  assert.equal(p.status, "posted");
  const folder = await drive.get(p.driveFolderId);
  assert.equal(folder.name, `${created} - Roots Music Project, thank you!`);
  assert.deepEqual(folder.parents, [postsId]);
  assert.deepEqual((await drive.get("fake-social-post49")).parents, [p.driveFolderId], "the photo moved into the post's folder");
  assert.deepEqual(p.media[0].from, { folderId: MONTH });
  assert.equal(p.media[0].name, "Roots Music Project stage.jpg");
  assert.equal(p.media[0].width, 1600);
  assert.equal(p.media[0].height, 1000);
  assert.equal(p.media[0].url, "u");
  assert.ok(p.media[0].modifiedTime);

  const s = (await db.get("posts", stuck))!;
  assert.equal(s.status, "failed");
  assert.equal(s.error, INTERRUPTED);
  assert.equal((await drive.get(s.driveFolderId)).name, `DRAFT - Photo ${created}`);
  assert.deepEqual(s.media[0].from, { folderId: SOCIALS_FOLDER_ID });
  assert.equal((await db.get("posts", gone))!.driveFolderId, undefined);

  const after = JSON.stringify([await db.list("posts"), await drive.list({ parents: [postsId, MONTH, SOCIALS_FOLDER_ID], kind: "all" })]);
  const again = await migratePosts49({ apply: true });
  assert.equal(again.migrated.length, 0);
  assert.equal(JSON.stringify([await db.list("posts"), await drive.list({ parents: [postsId, MONTH, SOCIALS_FOLDER_ID], kind: "all" })]), after, "a second run changed nothing");
});

// ---------- Photos: posts.photos, posts.list, the thumb route ----------

const PHONE = "fake-folder-socials-phone", MONTH_FOLDER = "fake-folder-socials-2026-10";
const SEEDED_PHOTOS = ["fake-social-heic-1", "fake-social-heic-2", "fake-social-rotated", "fake-social-late", "fake-social-phone-5", "fake-social-phone-6",
  "fake-social-loose-1", "fake-social-loose-2", "fake-social-loose-3", "fake-social-post49"];
const tick = () => new Promise((r) => setTimeout(r, 5));

test("posts.photos: refused before Socials is chosen; the whole inbox newest added first, each photo upright with when it was taken; folders with their own counts", async () => {
  await assert.rejects(cmd("posts.photos", {}), (e: any) => e.code === "no_posts_folder"); // eslint-disable-line @typescript-eslint/no-explicit-any
  await chooseSocials();
  const r = await cmd("posts.photos", {});
  assert.equal(r.capped, false);
  assert.deepEqual(r.photos.map((p: any) => p.driveFileId), SEEDED_PHOTOS.slice().reverse(), "newest added first; not the PDF"); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(r.folders, [
    { id: MONTH_FOLDER, name: "2026-10", parentId: SOCIALS_FOLDER_ID, count: 1 },
    { id: PHONE, name: "Jeff's phone spring 26", parentId: SOCIALS_FOLDER_ID, count: 6 },
  ].sort((a, b) => r.folders.findIndex((f: any) => f.id === a.id) - r.folders.findIndex((f: any) => f.id === b.id))); // eslint-disable-line @typescript-eslint/no-explicit-any
  const by = (id: string) => r.photos.find((p: any) => p.driveFileId === id); // eslint-disable-line @typescript-eslint/no-explicit-any
  const rotated = by("fake-social-rotated");
  assert.deepEqual({ ...rotated, thumb: undefined }, {
    driveFileId: "fake-social-rotated", name: "photo-rotated.jpg", mimeType: "image/jpeg", width: 900, height: 1200, takenAt: "2026-10-10 21:15", folderId: PHONE, thumb: undefined,
  }, "stored 1200×900 turned a quarter: 900×1200 upright");
  assert.match(rotated.thumb, /^\/api\/posts\/thumb\/test-artist\/fake-social-rotated\?v=2026-11-01T18%3A02%3A00.000Z&s=400&exp=\d+&sig=/);
  assert.equal(by("fake-social-heic-2").mimeType, "image/heic", "an octet-stream HEIC is a HEIC by its name");
  assert.equal(by("fake-social-late").takenAt, "2026-10-11 01:30", "the camera's own time, as written");
  assert.equal(by("fake-social-phone-6").takenAt, "2026-11-01 11:05", "no camera time: when it was added, in the band's timezone (MST after Nov 1, 02:00)");
  assert.equal(by("fake-social-loose-1").folderId, SOCIALS_FOLDER_ID);
});

test("posts.photos: walks nested folders, skips Posts/, takes one folder and its subfolders, and refuses a folder outside Socials", async () => {
  await chooseSocials();
  await cmd("posts.setup", {});
  const drive = driveClient({ artistId: TEST_ARTIST });
  const postsId = (await db.get("artists", TEST_ARTIST))!.postFoldersId as string;
  const encore = (await findOrMakeFolder(drive, PHONE, "Encore")).folder;
  const deeper = (await findOrMakeFolder(drive, encore.id, "Crowd")).folder;
  const inPost = (await findOrMakeFolder(drive, postsId, "DRAFT - Hi-Dive announcement")).folder;
  await tick();
  const crowd = await drive.upload({ name: "Crowd.jpg", mimeType: "image/jpeg", parentId: deeper.id, data: new Blob([Buffer.from([0xff, 0xd8])]) });
  await tick();
  const used = await drive.upload({ name: "Used.jpg", mimeType: "image/jpeg", parentId: inPost.id, data: new Blob([Buffer.from([0xff, 0xd8])]) });

  const all = await cmd("posts.photos", {});
  const folderIds = all.folders.map((f: any) => f.id); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(folderIds.includes(encore.id) && folderIds.includes(deeper.id), "folders two levels down");
  assert.deepEqual(all.folders.find((f: any) => f.id === deeper.id), { id: deeper.id, name: "Crowd", parentId: encore.id, count: 1 }); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(all.folders.find((f: any) => f.id === PHONE).count, 6, "a folder's count is its own photos, not its subfolders'"); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(!folderIds.includes(postsId) && !folderIds.includes(inPost.id), "not Posts/ or a post folder");
  assert.equal(all.photos[0].driveFileId, crowd.id);
  assert.ok(!all.photos.some((p: any) => p.driveFileId === used.id), "a photo in a post folder isn't in the inbox"); // eslint-disable-line @typescript-eslint/no-explicit-any

  const phone = await cmd("posts.photos", { folder: PHONE });
  assert.deepEqual(phone.photos.map((p: any) => p.driveFileId).sort(), [crowd.id, ...SEEDED_PHOTOS.slice(0, 6)].sort(), "the phone folder and what's under it"); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(phone.folders.length, all.folders.length, "the rail still lists every inbox folder");
  assert.equal((await cmd("posts.photos", { folder: SOCIALS_FOLDER_ID })).photos.length, all.photos.length, "Socials itself is everything");
  for (const outside of [postsId, inPost.id, "fake-folder-charts"]) {
    await assert.rejects(cmd("posts.photos", { folder: outside }), (e: any) => e.code === "not_in_socials" && e.message === "That folder isn't in Socials"); // eslint-disable-line @typescript-eslint/no-explicit-any
  }
});

test("posts.photos: more than 20 folders are read in batches, merged newest added first; at most the most recently added, with counts still whole", async () => {
  await chooseSocials();
  const drive = driveClient({ artistId: TEST_ARTIST });
  const made: string[] = [];
  for (let i = 1; i <= 23; i++) made.push((await findOrMakeFolder(drive, SOCIALS_FOLDER_ID, `Dump ${String(i).padStart(2, "0")}`)).folder.id);
  // Newest in the last folder (the second batch), then one in the first: merged across batches by when they were added.
  const add = async (parentId: string, name: string) => { await tick(); return (await drive.upload({ name, mimeType: "image/jpeg", parentId, data: new Blob([Buffer.from([0xff, 0xd8])]) })).id; };
  const older = await add(made[0], "Older.jpg");
  const newer = await add(made[22], "Newer.jpg");
  const r = await cmd("posts.photos", {});
  assert.ok(r.folders.length > 20);
  assert.deepEqual(r.photos.slice(0, 2).map((p: any) => p.driveFileId), [newer, older]); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(r.photos.length, 12);

  assert.equal(photosLimits.max, 2000);
  photosLimits.max = 3;
  try {
    const capped = await cmd("posts.photos", {});
    assert.equal(capped.capped, true);
    assert.deepEqual(capped.photos.map((p: any) => p.driveFileId), [newer, older, "fake-social-post49"]); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(capped.folders.find((f: any) => f.id === PHONE).count, 6, "counts aren't capped"); // eslint-disable-line @typescript-eslint/no-explicit-any
  } finally { photosLimits.max = 2000; }
});

test("Photos' days: the 01:30 photo goes on the day before, labelled with that night's show; canceled shows don't label a day", async () => {
  await chooseSocials();
  const { photos } = await cmd("posts.photos", {});
  const shows = [
    { date: "2026-10-10", status: "played", venue: { id: "v1", name: "Creamery Arts Center" } },
    { date: "2026-11-01", status: "canceled", venue: { id: "v2", name: "Hi-Dive" } },
    { date: "2026-11-01", status: "hold", kind: "house" as const, hostName: "Robin" },
  ];
  const days = groupByDay(photos as { driveFileId: string; takenAt: string }[], dayLabels(shows, [{ date: "2026-09-20", location: { name: "Rudy's garage" } }]));
  const oct10 = days.find((d) => d.day === "2026-10-10")!;
  assert.deepEqual(oct10.labels, ["Creamery Arts Center"]);
  assert.deepEqual(oct10.photos.map((p) => p.driveFileId).sort(), ["fake-social-late", "fake-social-phone-5", "fake-social-rotated"]);
  assert.equal(days.find((d) => d.day === "2026-10-11"), undefined, "nothing left on Oct 11");
  assert.deepEqual(days.find((d) => d.day === "2026-11-01")!.labels, ["House concert · Robin"]);
  assert.deepEqual(days.find((d) => d.day === "2026-09-20")!.labels, ["Rehearsal · Rudy's garage"]);
  assert.deepEqual(days.map((d) => d.day), ["2026-11-01", "2026-10-10", "2026-10-03", "2026-09-20"], "newest day first");
});

test("posts.list: drafts (with failed and publishing) by latest change, then posted newest first; other bands' and deleted posts left out", async () => {
  const make = async (fields: Record<string, unknown>, artistId = TEST_ARTIST) => {
    await tick();
    return (await db.create({ ...ctx, artistId }, "posts", { artistId, caption: "", createdVia: "app", ...fields })).id;
  };
  const photo = (id: string, modifiedTime?: string) => ({ driveFileId: id, mimeType: "image/jpeg", ...(modifiedTime ? { modifiedTime } : {}) });
  const posted1 = await make({ title: "Thanks, Denver", status: "posted", postedAt: "2026-11-03T03:00:00.000Z", media: [photo("a"), photo("b")], instagram: { mediaId: "m1", permalink: "https://www.instagram.com/p/X/" } });
  const draft = await make({ title: "Hi-Dive announcement", status: "draft", media: [photo("fake-social-late", "2026-11-01T18:03:00.000Z")], driveFolderId: "f1" });
  const failed = await make({ title: "Tour poster", status: "failed", error: "Instagram said: no", media: [photo("c")] });
  const posted2 = await make({ title: "Roots", status: "posted", postedAt: "2026-11-05T03:00:00.000Z", media: [photo("d")], instagram: { mediaId: "m2", permalink: null }, driveTidy: { error: "Drive said no" } });
  const gone = await make({ title: "Gone", status: "draft", media: [photo("e")] });
  await db.softDelete(ctx, "posts", gone);
  await make({ title: "Theirs", status: "draft", media: [photo("f")] }, "another-band");
  await tick();
  await db.update(ctx, "posts", draft, { caption: "changed last" });

  const r = await cmd("posts.list", {});
  assert.deepEqual(r.drafts.map((p: any) => p.id), [draft, failed]); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(r.posts.map((p: any) => p.id), [posted2, posted1]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const d = r.drafts[0];
  assert.deepEqual({ ...d, thumb: undefined }, { id: draft, title: "Hi-Dive announcement", status: "draft", count: 1, thumb: undefined, driveFolderId: "f1" });
  assert.equal(d.thumb, thumbUrl(TEST_ARTIST, "fake-social-late", "2026-11-01T18:03:00.000Z", 400), "signed from the stored modifiedTime");
  assert.equal(r.drafts[1].error, "Instagram said: no");
  assert.deepEqual({ ...r.posts[0], thumb: undefined }, { id: posted2, title: "Roots", status: "posted", postedAt: "2026-11-05T03:00:00.000Z", count: 1, thumb: undefined, permalink: null, driveTidy: { error: "Drive said no" } });
  assert.equal(r.posts[1].permalink, "https://www.instagram.com/p/X/");
  assert.equal(r.posts[1].count, 2);
  assert.equal((await dispatch("posts.list", `Bearer ${hugo.token}`, {}, TEST_ARTIST)).status, 403, "members can't read posts");
});

const thumb = (url: string) => {
  const m = /^\/api\/posts\/thumb\/([^/]+)\/([^/?]+)/.exec(url)!;
  return thumbGET(new Request(`http://app${url}`), { params: Promise.resolve({ artistId: decodeURIComponent(m[1]), fileId: decodeURIComponent(m[2]) }) });
};

test("thumb route: a signed link streams Drive's upright preview at 400, 1080 or 2048, cached for the hour; anything else is a 404", async () => {
  const v = "2026-11-01T18:02:00.000Z";
  const ok = await thumb(thumbUrl(TEST_ARTIST, "fake-social-rotated", v, 400));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/jpeg");
  assert.equal(ok.headers.get("cache-control"), "private, max-age=3600");
  const meta = await sharp(Buffer.from(await ok.arrayBuffer())).metadata();
  assert.deepEqual([meta.width, meta.height], [300, 400], "upright, the long edge 400");
  const big = await thumb(thumbUrl(TEST_ARTIST, "fake-social-heic-1", v, 1080).replace("s=1080", "s=2048"));
  assert.equal(big.status, 200, "s isn't signed");
  const bigMeta = await sharp(Buffer.from(await big.arrayBuffer())).metadata();
  assert.deepEqual([bigMeta.width, bigMeta.height], [1536, 2048], "the HEIC turned a quarter: portrait, the long edge 2048");

  assert.equal(thumbUrl(TEST_ARTIST, "x", v, 400), thumbUrl(TEST_ARTIST, "x", v, 400, Date.now() + 1), "the same link within the hour");
  const no = async (url: string, why: string) => assert.equal((await thumb(url)).status, 404, why);
  await no(thumbUrl(TEST_ARTIST, "fake-social-rotated", v, 400).replace("s=400", "s=500"), "a size we don't serve");
  await no(thumbUrl(TEST_ARTIST, "fake-social-rotated", v, 400, Date.now() - 2 * 60 * 60_000), "expired");
  await no(thumbUrl(TEST_ARTIST, "fake-social-rotated", v, 400).replace(/sig=./, (x) => (x.endsWith("a") ? "sig=b" : "sig=a")), "wrong signature");
  await no(thumbUrl(TEST_ARTIST, "fake-social-rotated", v, 400).replace("v=2026-11-01", "v=2026-11-02"), "another version of the file");
  await no(thumbUrl(TEST_ARTIST, "fake-social-rotated", v, 400).replace("/test-artist/", "/another-band/"), "a link signed for this band doesn't open another band's");
  await no(thumbUrl(TEST_ARTIST, "fake-social-loose-1", v, 400).replace("fake-social-loose-1", "fake-social-loose-2"), "another file");
  await driveScenario({ noThumbnail: ["fake-social-loose-2"] });
  await no(thumbUrl(TEST_ARTIST, "fake-social-loose-2", v, 400), "Drive has no preview yet");
  await driveScenario({ noThumbnail: [] });

  const project = process.env.GCLOUD_PROJECT, secret = process.env.SIGNED_URL_SECRET;
  const url = thumbUrl(TEST_ARTIST, "fake-social-rotated", v, 400);
  process.env.GCLOUD_PROJECT = "roadie-prod-iab"; delete process.env.SIGNED_URL_SECRET;
  try {
    const res = await thumb(url);
    assert.equal(res.status, 503);
    assert.equal(await res.text(), "Signed links aren't set up on this server");
  } finally {
    process.env.GCLOUD_PROJECT = project;
    if (secret !== undefined) process.env.SIGNED_URL_SECRET = secret;
  }
});

// ---------- drafts: createDraft, addToDraft, updateDraft, rename, removeFromDraft, deleteDraft, get, undo ----------

/** A ctx with its own run, so each call is its own Undo. */
const fresh = (): Ctx => ({ ...ctx, runId: newRunId() });
const run = async (name: string, input: unknown) => { const c = fresh(); return { out: await cmd(name, input, c), runId: c.runId }; };
const refused = (p: Promise<unknown>, c: string, message: string) => assert.rejects(p, (e: any) => e.code === c && e.message === message); // eslint-disable-line @typescript-eslint/no-explicit-any
async function setUpPosts() {
  await chooseSocials();
  await cmd("posts.setup", {});
  return (await db.get("artists", TEST_ARTIST))!.postFoldersId as string;
}
const parentsOf = async (id: string) => (await driveClient({ artistId: TEST_ARTIST }).get(id)).parents;
const folderNamed = async (parent: string, name: string) =>
  (await driveClient({ artistId: TEST_ARTIST }).list({ parents: [parent], kind: "folders" })).files.find((f) => f.name === name);

test("createDraft: refused until Set up; moves the photos into Posts/DRAFT - <title> and records where each came from", async () => {
  await chooseSocials();
  await refused(cmd("posts.createDraft", { title: "Hi-Dive announcement", driveFileIds: ["fake-social-loose-1"] }), "posts_not_set_up", "Set up the Socials folder in Settings › Google");
  const postsId = await setUpPosts();
  const r = await cmd("posts.createDraft", { title: "Hi-Dive announcement", driveFileIds: ["fake-social-rotated", "fake-social-loose-1"] });
  assert.equal(r.folderName, "DRAFT - Hi-Dive announcement");
  const folder = (await folderNamed(postsId, r.folderName))!;
  assert.deepEqual(await parentsOf("fake-social-rotated"), [folder.id]);
  assert.deepEqual(await parentsOf("fake-social-loose-1"), [folder.id]);
  const p = (await db.get("posts", r.id))!;
  assert.equal(p.status, "draft");
  assert.equal(p.caption, "");
  assert.equal(p.aspect, "4:5");
  assert.equal(p.title, "Hi-Dive announcement");
  assert.equal(p.driveFolderId, folder.id);
  assert.deepEqual(p.media.map((m: any) => ({ ...m, modifiedTime: typeof m.modifiedTime, url: typeof m.url })), [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { driveFileId: "fake-social-rotated", mimeType: "image/jpeg", name: "photo-rotated.jpg", width: 900, height: 1200, modifiedTime: "string", url: "string", from: { folderId: PHONE } },
    { driveFileId: "fake-social-loose-1", mimeType: "image/jpeg", name: "IMG_4411.JPG", width: 1600, height: 1000, modifiedTime: "string", url: "string", from: { folderId: SOCIALS_FOLDER_ID } },
  ], "in the order given, upright sizes");
  const inbox = (await cmd("posts.photos", {})).photos.map((x: any) => x.driveFileId); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(!inbox.includes("fake-social-rotated") && !inbox.includes("fake-social-loose-1"), "gone from the inbox");
  assert.equal((await dispatch("posts.createDraft", `Bearer ${hugo.token}`, { title: "x", driveFileIds: ["fake-social-loose-2"] }, TEST_ARTIST)).status, 403);
});

test("createDraft: refuses, changing nothing, a photo outside Socials, one already in a post (naming it), a non-photo and a trashed photo; a name clash gives (2)", async () => {
  const postsId = await setUpPosts();
  const first = await cmd("posts.createDraft", { title: "Hi-Dive announcement", driveFileIds: ["fake-social-loose-1"] });
  const before = (await driveClient({ artistId: TEST_ARTIST }).list({ parents: [postsId], kind: "folders" })).files.length;
  await refused(cmd("posts.createDraft", { title: "Next", driveFileIds: ["fake-social-loose-2", "fake-social-loose-1"] }), "in_a_post", "IMG_4411 is already in Hi-Dive announcement");
  await refused(cmd("posts.createDraft", { title: "Next", driveFileIds: ["fake-photo-roots"] }), "not_in_socials", "Roots Music Project stage isn't in Socials");
  await refused(cmd("posts.createDraft", { title: "Next", driveFileIds: ["fake-social-pdf"] }), "invalid_input", "Set list isn't a photo. Roadie takes JPEG, HEIC, PNG and WebP photos");
  await driveClient({ artistId: TEST_ARTIST }).trash("fake-social-loose-3");
  await refused(cmd("posts.createDraft", { title: "Next", driveFileIds: ["fake-social-loose-3"] }), "invalid_input", "Poster draft is in Drive's trash");
  assert.deepEqual(await parentsOf("fake-social-loose-2"), [SOCIALS_FOLDER_ID], "nothing moved");
  assert.equal((await driveClient({ artistId: TEST_ARTIST }).list({ parents: [postsId], kind: "folders" })).files.length, before, "no folder made");
  assert.equal((await db.list("posts")).length, 1);
  const second = await cmd("posts.createDraft", { title: "Hi-Dive announcement", driveFileIds: ["fake-social-loose-2"] });
  assert.equal(second.folderName, "DRAFT - Hi-Dive announcement (2)");
  assert.notEqual(second.id, first.id);
});

test("createDraft: a move failing partway puts the first photo back and trashes the empty folder, with no post left", async () => {
  const postsId = await setUpPosts();
  await driveScenario({ failMove: 2 });
  await assert.rejects(cmd("posts.createDraft", { title: "Broken", driveFileIds: ["fake-social-loose-1", "fake-social-heic-1", "fake-social-loose-2"] }));
  assert.deepEqual(await parentsOf("fake-social-loose-1"), [SOCIALS_FOLDER_ID]);
  assert.deepEqual(await parentsOf("fake-social-heic-1"), [PHONE]);
  assert.equal(await folderNamed(postsId, "DRAFT - Broken"), undefined, "the folder is in the trash");
  assert.equal((await db.list("posts")).length, 0);
});

test("addToDraft: appends the photos; at most 10 in all; a failed move puts back only this call's photos", async () => {
  await setUpPosts();
  const { id } = await cmd("posts.createDraft", { title: "Tour", driveFileIds: ["fake-social-loose-1"] });
  const folder = (await db.get("posts", id))!.driveFolderId as string;
  assert.deepEqual(await cmd("posts.addToDraft", { id, driveFileIds: ["fake-social-heic-1", "fake-social-late"] }), { count: 3 });
  assert.deepEqual((await db.get("posts", id))!.media.map((m: any) => m.driveFileId), ["fake-social-loose-1", "fake-social-heic-1", "fake-social-late"]); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(await parentsOf("fake-social-late"), [folder]);
  const many = SEEDED_PHOTOS.filter((x) => !["fake-social-loose-1", "fake-social-heic-1", "fake-social-late"].includes(x)); // 7 more makes 10, plus one
  const drive = driveClient({ artistId: TEST_ARTIST });
  const extra = (await drive.upload({ name: "Extra.jpg", mimeType: "image/jpeg", parentId: SOCIALS_FOLDER_ID, data: new Blob([Buffer.from([0xff, 0xd8])]) })).id;
  await refused(cmd("posts.addToDraft", { id, driveFileIds: [...many, extra] }), "invalid_input", "A post holds at most 10 photos");

  await driveScenario({ failMove: 2 });
  await assert.rejects(cmd("posts.addToDraft", { id, driveFileIds: ["fake-social-loose-2", "fake-social-phone-5"] }));
  assert.deepEqual(await parentsOf("fake-social-loose-2"), [SOCIALS_FOLDER_ID], "this call's move put back");
  assert.deepEqual(await parentsOf("fake-social-phone-5"), [PHONE]);
  assert.deepEqual(await parentsOf("fake-social-late"), [folder], "the draft's own photos stay");
  assert.equal((await db.get("posts", id))!.media.length, 3);
});

test("updateDraft: caption, aspect, order and the whole items map; refuses >30 hashtags, a wrong order, a baseRev conflict, and a posted post", async () => {
  await setUpPosts();
  const { id } = await cmd("posts.createDraft", { title: "Tour", driveFileIds: ["fake-social-loose-1", "fake-social-loose-2", "fake-social-late"] });
  const out = await cmd("posts.updateDraft", { id, patch: {
    caption: "Thanks, Denver! #tour", aspect: "1:1", order: ["fake-social-late", "fake-social-loose-1", "fake-social-loose-2"],
    items: { "fake-social-late": { alt: "The crowd at the Hi-Dive", focus: { x: 0.2, y: 0.5 } }, "fake-social-loose-1": { alt: "" }, "fake-social-loose-2": {} },
  } });
  assert.equal(out.caption, "Thanks, Denver! #tour");
  assert.equal(out.aspect, "1:1");
  assert.deepEqual(out.media.map((m: any) => [m.driveFileId, m.alt, m.focus]), [ // eslint-disable-line @typescript-eslint/no-explicit-any
    ["fake-social-late", "The crowd at the Hi-Dive", { x: 0.2, y: 0.5 }], ["fake-social-loose-1", undefined, undefined], ["fake-social-loose-2", undefined, undefined],
  ]);
  // the whole map again: one photo's edit doesn't drop another's
  const again = await cmd("posts.updateDraft", { id, patch: { items: { "fake-social-late": { alt: "The crowd at the Hi-Dive", focus: { x: 0.2, y: 0.5 } }, "fake-social-loose-1": { alt: "Rudy" }, "fake-social-loose-2": {} } } });
  assert.deepEqual(again.media.map((m: any) => m.alt), ["The crowd at the Hi-Dive", "Rudy", undefined]); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal((await parentsOf("fake-social-late")).length, 1, "Drive untouched");

  const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ");
  await refused(cmd("posts.updateDraft", { id, patch: { caption: tags } }), "invalid_input", "A caption can have at most 30 hashtags");
  await cmd("posts.updateDraft", { id, patch: { caption: tags.replace(" #t30", "") } });
  await code(cmd("posts.updateDraft", { id, patch: { order: ["fake-social-late"] } }), "invalid_input");
  await code(cmd("posts.updateDraft", { id, patch: { items: { "fake-social-heic-1": { alt: "x" } } } }), "invalid_input");

  const rev = (await db.get("posts", id))!.rev as number;
  const send = (caption: string, baseRev: number) => dispatch("posts.updateDraft", `Bearer ${rudy.token}`, { id, patch: { caption }, _meta: { baseRev, autosave: true } }, TEST_ARTIST);
  assert.equal((await send("mine", rev)).status, 200);
  const clash = await send("theirs", rev);
  assert.equal(clash.status, 409);
  assert.equal((clash.json as any).error.code, "conflict"); // eslint-disable-line @typescript-eslint/no-explicit-any

  await db.update(ctx, "posts", id, { status: "posted" });
  await refused(cmd("posts.updateDraft", { id, patch: { caption: "late" } }), "post_locked", "This post has gone out; it can't be changed");
  await db.update(ctx, "posts", id, { status: "publishing" });
  await refused(cmd("posts.rename", { id, title: "x" }), "post_locked", "This post is being posted right now");
});

test("rename: renames the draft's folder (a clash gives (2)) and its title", async () => {
  const postsId = await setUpPosts();
  await cmd("posts.createDraft", { title: "Hi-Dive announcement", driveFileIds: ["fake-social-loose-1"] });
  const { id } = await cmd("posts.createDraft", { title: "Tour", driveFileIds: ["fake-social-loose-2"] });
  const folder = (await db.get("posts", id))!.driveFolderId as string;
  assert.deepEqual(await cmd("posts.rename", { id, title: "Hi-Dive announcement" }), { folderName: "DRAFT - Hi-Dive announcement (2)" });
  assert.equal((await folderNamed(postsId, "DRAFT - Hi-Dive announcement (2)"))!.id, folder);
  assert.equal((await db.get("posts", id))!.title, "Hi-Dive announcement");
  assert.deepEqual(await cmd("posts.rename", { id, title: "Hi-Dive announcement" }), { folderName: "DRAFT - Hi-Dive announcement (2)" }, "its own name doesn't clash");
  assert.deepEqual(await cmd("posts.rename", { id, title: "Thanks, Denver" }), { folderName: "DRAFT - Thanks, Denver" });
});

test("removeFromDraft: back to its own folder, or the Socials root when that folder is gone; the last photo is refused; a failed move keeps it", async () => {
  await setUpPosts();
  const drive = driveClient({ artistId: TEST_ARTIST });
  const encore = (await findOrMakeFolder(drive, SOCIALS_FOLDER_ID, "Encore")).folder;
  const pic = (await drive.upload({ name: "Encore.jpg", mimeType: "image/jpeg", parentId: encore.id, data: new Blob([Buffer.from([0xff, 0xd8])]) })).id;
  const { id } = await cmd("posts.createDraft", { title: "Tour", driveFileIds: ["fake-social-heic-1", pic, "fake-social-loose-1"] });
  assert.deepEqual(await cmd("posts.removeFromDraft", { id, driveFileId: "fake-social-heic-1" }), { count: 2 });
  assert.deepEqual(await parentsOf("fake-social-heic-1"), [PHONE]);
  await drive.trash(encore.id);
  await cmd("posts.removeFromDraft", { id, driveFileId: pic });
  assert.deepEqual(await parentsOf(pic), [SOCIALS_FOLDER_ID], "its folder is in the trash: the Socials root");
  await refused(cmd("posts.removeFromDraft", { id, driveFileId: "fake-social-loose-1" }), "invalid_input", "Delete the draft instead");
  await cmd("posts.addToDraft", { id, driveFileIds: ["fake-social-loose-2"] });
  await driveScenario({ failMove: 1 });
  await assert.rejects(cmd("posts.removeFromDraft", { id, driveFileId: "fake-social-loose-2" }));
  assert.deepEqual((await db.get("posts", id))!.media.map((m: any) => m.driveFileId), ["fake-social-loose-1", "fake-social-loose-2"]); // eslint-disable-line @typescript-eslint/no-explicit-any
});

test("deleteDraft: every photo goes back and the empty folder is trashed; a folder with the PDF is left; a failed move keeps that photo in the draft", async () => {
  const postsId = await setUpPosts();
  const drive = driveClient({ artistId: TEST_ARTIST });
  const a = await cmd("posts.createDraft", { title: "A", driveFileIds: ["fake-social-heic-1", "fake-social-loose-1"] });
  assert.deepEqual(await cmd("posts.deleteDraft", { id: a.id }), { folderLeft: false, notMoved: [] });
  assert.deepEqual(await parentsOf("fake-social-heic-1"), [PHONE]);
  assert.deepEqual(await parentsOf("fake-social-loose-1"), [SOCIALS_FOLDER_ID]);
  assert.equal(await folderNamed(postsId, "DRAFT - A"), undefined, "trashed");
  assert.ok((await db.get("posts", a.id))!.deletedAt, "soft-deleted");
  assert.equal((await cmd("posts.list", {})).drafts.length, 0);

  const b = await cmd("posts.createDraft", { title: "B", driveFileIds: ["fake-social-loose-1"] });
  const bFolder = (await db.get("posts", b.id))!.driveFolderId as string;
  await drive.update("fake-social-pdf", { addParents: [bFolder], removeParents: [SOCIALS_FOLDER_ID] });
  const left = await cmd("posts.deleteDraft", { id: b.id });
  assert.deepEqual(left, { folderLeft: true, notMoved: [], message: "Left DRAFT - B in Drive: it has files Roadie didn't put there" });
  assert.ok(await folderNamed(postsId, "DRAFT - B"));
  assert.deepEqual(await parentsOf("fake-social-loose-1"), [SOCIALS_FOLDER_ID]);

  const c = await cmd("posts.createDraft", { title: "C", driveFileIds: ["fake-social-loose-2", "fake-social-late"] });
  await driveScenario({ failMove: 2 });
  const partly = await cmd("posts.deleteDraft", { id: c.id });
  assert.equal(partly.folderLeft, true);
  assert.deepEqual(partly.notMoved, ["IMG_2210"]);
  assert.match(partly.message, /^Couldn't move IMG_2210 back: .+\. The draft keeps it$/);
  const kept = (await db.get("posts", c.id))!;
  assert.equal(kept.deletedAt, null);
  assert.deepEqual(kept.media.map((m: any) => m.driveFileId), ["fake-social-late"]); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(await parentsOf("fake-social-loose-2"), [SOCIALS_FOLDER_ID]);
});

test("posts.get: each photo's 1080 preview, a trashed or missing photo flagged, and a changed modifiedTime saved without history", async () => {
  await setUpPosts();
  const { id } = await cmd("posts.createDraft", { title: "Tour", driveFileIds: ["fake-social-loose-1", "fake-social-late"] });
  const drive = driveClient({ artistId: TEST_ARTIST });
  const before = (await db.get("posts", id))!;
  await tick();
  await drive.trash("fake-social-late");
  const r = await cmd("posts.get", { id });
  assert.equal(r.title, "Tour");
  assert.deepEqual(r.photos["fake-social-loose-1"].trashed, false);
  assert.equal(r.photos["fake-social-loose-1"].missing, false);
  assert.match(r.photos["fake-social-loose-1"].thumb1080, /&s=1080&/);
  assert.equal(r.photos["fake-social-late"].trashed, true, "flagged");
  const after = (await db.get("posts", id))!;
  assert.notEqual(after.media[1].modifiedTime, before.media[1].modifiedTime, "trashing bumped it; saved back");
  assert.equal(after.rev, before.rev, "not an edit: no new rev or history");
  await code(cmd("posts.get", { id: "nope" }), "not_found");
});

test("undo: refuses createDraft, rename, removeFromDraft and deleteDraft runs; reverts an updateDraft caption edit", async () => {
  await setUpPosts();
  const made = await run("posts.createDraft", { title: "Tour", driveFileIds: ["fake-social-loose-1", "fake-social-loose-2", "fake-social-late"] });
  const id = made.out.id as string;
  const renamed = await run("posts.rename", { id, title: "Tour 2" });
  const removed = await run("posts.removeFromDraft", { id, driveFileId: "fake-social-late" });
  const edited = await run("posts.updateDraft", { id, patch: { caption: "Hello" } });
  const reordered = await run("posts.updateDraft", { id, patch: { order: ["fake-social-loose-2", "fake-social-loose-1"] } });
  for (const r of [made, renamed, removed]) {
    await refused(undoRun(fresh(), r.runId), "drive_changed", "This changed Drive, so it can't be undone. Take the photo out or delete the draft instead");
  }
  await undoRun(fresh(), reordered.runId);
  await undoRun(fresh(), edited.runId);
  const p = (await db.get("posts", id))!;
  assert.equal(p.caption, "");
  assert.deepEqual(p.media.map((m: any) => m.driveFileId), ["fake-social-loose-1", "fake-social-loose-2"]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const deleted = await run("posts.deleteDraft", { id });
  await refused(undoRun(fresh(), deleted.runId), "drive_changed", "This changed Drive, so it can't be undone. Take the photo out or delete the draft instead");
  assert.ok((await db.get("posts", id))!.deletedAt);
});

test("policy: posts commands are offered to Roadie; setup and publish ask and need a tap; reads don't ask; a 7-photo order doesn't; 6 photos into a draft does", () => {
  const offered = eligibleCommands("admin").map((c) => c.name);
  for (const n of ["posts.setup", "posts.photos", "posts.list", "posts.get", "posts.createDraft", "posts.addToDraft", "posts.updateDraft", "posts.rename", "posts.removeFromDraft", "posts.deleteDraft", "posts.publish", "posts.tidy"]) {
    assert.ok(offered.includes(n), n);
  }
  assert.ok(!offered.includes("posts.publishPhoto"));
  for (const n of ["posts.setup", "posts.publish"]) {
    assert.equal(needsConfirm(n, {}), true, n);
    assert.equal(voiceConfirmable(n, {}, false), false, n);
  }
  assert.equal(needsConfirm("posts.deleteDraft", { id: "p" }), true);
  assert.equal(needsConfirm("posts.removeFromDraft", { id: "p", driveFileId: "f" }), true);
  for (const n of ["posts.photos", "posts.list", "posts.get"]) assert.equal(isReadOnly(n), true, n);
  const seven = Array.from({ length: 7 }, (_, i) => `f${i}`);
  assert.equal(needsConfirm("posts.updateDraft", { id: "p", patch: { order: seven } }), false);
  assert.equal(needsConfirm("posts.createDraft", { title: "x", driveFileIds: seven.slice(0, 6) }), true);
  assert.equal(needsConfirm("posts.createDraft", { title: "x", driveFileIds: seven.slice(0, 5) }), false);
  assert.equal(needsConfirm("posts.rename", { id: "p", title: "x" }), false);
  assert.equal(needsConfirm("posts.tidy", { id: "p" }), false);
  assert.equal(summarize("posts.publish", { id: "p" }, undefined, { title: "Tour", count: 3 }), "Post Tour (3 photos) to Instagram now");
  assert.equal(summarize("posts.deleteDraft", { id: "p" }, undefined, { title: "Tour" }), "Delete the draft Tour and put its photos back in Socials");
  assert.equal(summarize("posts.removeFromDraft", { id: "p" }, undefined, { title: "Tour", photo: "IMG_4412" }), "Take IMG_4412 out of Tour");
  assert.equal(summarize("posts.setup", {}), "Set up the Socials folder and let the band add to it");
});

// ---------- publish and tidy ----------

/** Record which Graph calls a publish makes, in order. */
function recordGraph() {
  const calls: string[] = [];
  const orig = { ...graph };
  for (const k of ["createImage", "createCarouselItem", "createCarousel", "container", "publish", "permalink"] as const) {
    (graph as any)[k] = (...args: unknown[]) => { calls.push(k); return (orig as any)[k](...args); }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  return { calls: () => calls.filter((c) => c !== "container"), restore: () => Object.assign(graph, orig) };
}
const published = async () => ((await (await fetch(`${META}/__media`)).json()) as { media: { caption: string; imageUrl: string; alt?: string; children?: { imageUrl: string; alt?: string }[] }[] }).media;
const folderOf = async (id: string) => (await driveClient({ artistId: TEST_ARTIST }).get((await db.get("posts", id))!.driveFolderId)).name;

test("publish: one photo is one image container with its alt text, then published; the post keeps its link and the folder takes the date", async () => {
  const id = await oneDraft(["fake-social-loose-1"], "Thanks, Roots");
  await code(cmd("posts.publish", { id }), "meta_not_connected");
  await connect();
  await cmd("posts.updateDraft", { id, patch: { caption: "Thanks, Roots! #live", items: { "fake-social-loose-1": { alt: "The band on the Roots stage" } } } });
  const g = recordGraph();
  try {
    const r = await cmd("posts.publish", { id });
    assert.equal(r.status, "posted");
    assert.match(r.permalink, /^https:\/\/www\.instagram\.com\/p\/FAKE\d+\/$/);
    assert.equal(r.driveTidy, undefined);
    assert.deepEqual(g.calls(), ["createImage", "publish", "permalink"]);
  } finally { g.restore(); }
  const p = (await db.get("posts", id))!;
  assert.equal(p.status, "posted");
  assert.ok(Math.abs(Date.parse(p.postedAt) - Date.now()) < 60_000);
  const [m] = await published();
  assert.equal(m.caption, "Thanks, Roots! #live");
  assert.equal(m.alt, "The band on the Roots stage");
  assert.match(m.imageUrl, new RegExp(`/api/posts/media/${id}/0\\?`));
  assert.equal(await folderOf(id), `${dateInBandZone()} - Thanks, Roots`);
  await refused(cmd("posts.updateDraft", { id, patch: { caption: "x" } }), "post_locked", "This post has gone out; it can't be changed");
  await refused(cmd("posts.publish", { id }), "post_locked", "This post has gone out; it can't be changed");
});

test("publish: a carousel is an item container per photo in the editor's order (each with its alt text), then the carousel with the caption", async () => {
  await connect();
  const id = await oneDraft(["fake-social-loose-1", "fake-social-rotated", "fake-social-late"], "Hi-Dive announcement");
  await cmd("posts.updateDraft", { id, patch: { caption: "See you there", order: ["fake-social-late", "fake-social-loose-1", "fake-social-rotated"], items: { "fake-social-late": {}, "fake-social-loose-1": { alt: "Nora at the mic" }, "fake-social-rotated": {} } } });
  const g = recordGraph();
  try {
    assert.equal((await cmd("posts.publish", { id })).status, "posted");
    assert.deepEqual(g.calls(), ["createCarouselItem", "createCarouselItem", "createCarouselItem", "createCarousel", "publish", "permalink"]);
  } finally { g.restore(); }
  const [m] = await published();
  assert.equal(m.caption, "See you there");
  assert.deepEqual(m.children!.map((c) => [new URL(c.imageUrl).pathname, c.alt]), [
    [`/api/posts/media/${id}/0`, undefined], [`/api/posts/media/${id}/1`, "Nora at the mic"], [`/api/posts/media/${id}/2`, undefined],
  ]);
  assert.equal(await folderOf(id), `${dateInBandZone()} - Hi-Dive announcement`);
});

test("publish: a carousel item Instagram can't use leaves the post failed with the reason and the photo, Drive untouched; it can be posted again", async () => {
  await connect();
  const id = await oneDraft(["fake-social-loose-1", "fake-social-late"], "Tour");
  const folder = (await db.get("posts", id))!.driveFolderId;
  await scenario({ failItem: 2 });
  const r = await cmd("posts.publish", { id });
  assert.equal(r.status, "failed");
  assert.equal(r.error, "IMG_2210: Instagram couldn't take the photo: Error: The aspect ratio is not supported.");
  const p = (await db.get("posts", id))!;
  assert.equal(p.status, "failed");
  assert.equal(p.error, r.error);
  assert.equal(p.instagram, undefined);
  assert.equal(await folderOf(id), "DRAFT - Tour", "Drive untouched");
  assert.deepEqual(await parentsOf("fake-social-late"), [folder]);
  assert.equal((await published()).length, 0);
  await scenario({ failItem: 0 });
  assert.equal((await cmd("posts.publish", { id })).status, "posted");
  const after = (await db.get("posts", id))!;
  assert.equal(after.error, undefined, "the old reason is cleared");
  assert.equal(await folderOf(id), `${dateInBandZone()} - Tour`);
});

test("publish: a HEIC Drive has no preview of yet fails before Instagram is asked, saying so", async () => {
  await connect();
  const id = await oneDraft(["fake-social-loose-2"], "Heic");
  await driveScenario({ noThumbnail: ["fake-social-loose-2"] });
  const r = await cmd("posts.publish", { id });
  assert.equal(r.status, "failed");
  assert.equal(r.error, "IMG_4412: Instagram can't take it yet: Drive hasn't made a preview of IMG_4412 yet; try again in a minute");
  await driveScenario({ noThumbnail: [] });
  assert.equal((await cmd("posts.publish", { id })).status, "posted", "a HEIC posts from its preview");
});

test("publish: a second publish is refused while one is posting", async () => {
  await connect();
  const id = await oneDraft();
  const both = await Promise.allSettled([cmd("posts.publish", { id }), cmd("posts.publish", { id })]);
  assert.equal(both.filter((x) => x.status === "fulfilled").length, 1, "one posts");
  const no = both.find((x) => x.status === "rejected") as PromiseRejectedResult;
  assert.equal(no.reason.code, "post_locked");
  assert.equal((await published()).length, 1);
  const other = await oneDraft(["fake-social-loose-3"], "Poster");
  await db.update(ctx, "posts", other, { status: "publishing" });
  await refused(cmd("posts.publish", { id: other }), "post_locked", "This post is being posted right now");
});

test("publish: a failed folder rename leaves the post posted with driveTidy; tidy renames it and clears it; a second tidy is ok", async () => {
  await connect();
  const id = await oneDraft(["fake-social-loose-1"], "Roots");
  await refused(cmd("posts.tidy", { id }), "invalid_input", "Only a posted post's folder is tidied");
  await driveScenario({ failRename: true });
  const r = await cmd("posts.publish", { id });
  assert.equal(r.status, "posted");
  assert.match(r.driveTidy.error, /failRename/);
  assert.deepEqual((await db.get("posts", id))!.driveTidy, r.driveTidy);
  assert.equal(await folderOf(id), "DRAFT - Roots");
  assert.equal((await cmd("posts.list", {})).posts[0].driveTidy.error, r.driveTidy.error);
  await code(cmd("posts.tidy", { id }), "drive_tidy");
  await driveScenario({ failRename: false });
  assert.deepEqual(await cmd("posts.tidy", { id }), { ok: true });
  assert.equal((await db.get("posts", id))!.driveTidy, undefined);
  assert.equal(await folderOf(id), `${dateInBandZone()} - Roots`);
  assert.deepEqual(await cmd("posts.tidy", { id }), { ok: true });
});
