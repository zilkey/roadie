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
import { signMetaState, verifyMetaState } from "@/server/meta/graph";
import { GET as mediaGET } from "@/app/api/posts/media/[id]/route";
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
    const m = /^\/api\/posts\/media\/([^/?]+)/.exec(rq.url ?? "");
    if (!m) { rs.writeHead(404); rs.end(); return; }
    const res = await mediaGET(new Request(`http://app${rq.url}`), { params: Promise.resolve({ id: decodeURIComponent(m[1]) }) });
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
  await code(cmd("posts.publishPhoto", { driveFileId: "fake-photo-roots", caption: "x" }), "meta_sign_in_again");
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
  await rejects(cmd("posts.publishPhoto", { driveFileId: "fake-photo-roots", caption: "x" }), "meta_sign_in_again", /24 hours old.*Connect again in Settings › Integrations/);
  assert.equal((await db.list("posts")).length, 0, "nothing is posted with a dead sign-in");

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
  assert.equal((await cmd("posts.publishPhoto", { driveFileId: "fake-photo-roots", caption: "x" })).status, "posted");
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
  for (const name of ["meta.status", "meta.connectUrl", "meta.disconnect", "posts.publishPhoto"]) {
    assert.equal((await dispatch(name, `Bearer ${hugo.token}`, {})).status, 403, name);
  }
});

// ---------- the signed media URL ----------

async function post(artistId = TEST_ARTIST, driveFileId = "fake-photo-roots") {
  return (await db.create({ ...ctx, artistId }, "posts", { artistId, caption: "c", media: [{ driveFileId, mimeType: "image/jpeg" }], status: "publishing", createdVia: "app" })).id;
}
const media = (url: string, id: string) => mediaGET(new Request(url), { params: Promise.resolve({ id }) });

test("media URL: streams the photo within the hour; expired, a wrong signature and another band's post are 404s", async () => {
  const id = await post();
  const ok = await media(signMediaUrl(TEST_ARTIST, id), id);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/jpeg");
  assert.equal((await media(signMediaUrl(TEST_ARTIST, id, Date.now() - 2 * 60 * 60_000), id)).status, 404, "expired");
  const u = new URL(signMediaUrl(TEST_ARTIST, id));
  u.searchParams.set("sig", u.searchParams.get("sig")!.replace(/^./, (c) => (c === "a" ? "b" : "a")));
  assert.equal((await media(u.toString(), id)).status, 404, "wrong signature");
  const other = await post("another-band");
  assert.equal((await media(signMediaUrl(TEST_ARTIST, other), other)).status, 404, "a link signed for this band doesn't open another band's post");
  assert.equal(mediaSigOk(TEST_ARTIST, id, null, null), false);
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
  assert.deepEqual({ ...d, thumb: undefined }, { id: draft, title: "Hi-Dive announcement", status: "draft", count: 1, thumb: undefined });
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

// ---------- publishPhoto ----------

test("publishPhoto: Instagram fetches the photo from the signed link, posts it, and the post keeps its link", async () => {
  await code(cmd("posts.publishPhoto", { driveFileId: "fake-photo-roots", caption: "Thanks, Roots!" }), "meta_not_connected");
  await connect();
  await code(cmd("posts.publishPhoto", { driveFileId: "fake-chart-1-b", caption: "x" }), "invalid_input"); // a PDF
  const r = await cmd("posts.publishPhoto", { driveFileId: "fake-photo-roots", caption: "Thanks, Roots!" });
  assert.equal(r.status, "posted");
  assert.match(r.permalink, /^https:\/\/www\.instagram\.com\/p\/FAKE\d+\/$/);
  const p = (await db.get("posts", r.id))!;
  assert.equal(p.status, "posted");
  assert.equal(p.caption, "Thanks, Roots!");
  assert.equal(p.createdVia, "app");
  assert.equal(p.artistId, TEST_ARTIST);
  assert.deepEqual(p.media, [{ driveFileId: "fake-photo-roots", mimeType: "image/jpeg", url: "http://localhost:3202/files/fake-photo-roots" }]);
  assert.equal(p.instagram.permalink, r.permalink);
  assert.ok(!JSON.stringify(r).includes("EAAsys"));
});

test("publishPhoto: a container Instagram can't use leaves the post failed with Instagram's reason", async () => {
  await connect();
  await scenario({ failContainers: true });
  const r = await cmd("posts.publishPhoto", { driveFileId: "fake-photo-roots", caption: "x" });
  assert.equal(r.status, "failed");
  assert.equal(r.error, "Instagram couldn't take the photo: Error: The aspect ratio is not supported.");
  const p = (await db.get("posts", r.id))!;
  assert.equal(p.status, "failed");
  assert.equal(p.error, r.error);
  assert.equal(p.instagram, undefined);
});
