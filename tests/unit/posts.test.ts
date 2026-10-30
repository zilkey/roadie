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
import { sealMeta, unsealMeta } from "@/server/meta/connection";
import { signMediaUrl, mediaSigOk } from "@/server/meta/media";
import { signMetaState, verifyMetaState } from "@/server/meta/graph";
import { GET as mediaGET } from "@/app/api/posts/media/[id]/route";
import { POST as uploadPOST } from "@/app/api/posts/upload/route";
import { GET as callbackGET } from "@/app/api/meta/callback/route";
import { resetEmulators, makeUser, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let META: string;
let app: http.Server;
let ctx: Ctx;
let jeff: { uid: string; token: string }, david: { uid: string; token: string };

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.DRIVE_BASE_URL = s.running["fake-drive"].url;
  META = s.running["fake-meta"].url;
  Object.assign(process.env, {
    META_APP_ID: "fake-meta-app", META_APP_SECRET: "fake-meta-secret", META_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64"),
    META_GRAPH_URL: META, META_DIALOG_URL: `${META}/dialog/oauth`,
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

/** Connect as Jeff: the dialog URL, then the fake's redirect to the callback, then the code and state the Integrations page gets. */
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
  jeff = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  david = await makeUser("david@example.com", "member", { name: "David" });
  ctx = { uid: jeff.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
  for (const k of ["jeff", "ingrid"]) await db.create(ctx, "musicians", { name: k, instruments: [], active: true, email: `${k}@example.com` });
  await db.create(ctx, "artists", { slug: "band", name: "Band", driveFolderId: "fake-band-folder", links: {}, configurations: [] }, { id: TEST_ARTIST });
});

// ---------- connecting ----------

test("the callback only forwards a state this server signed, to the band's Integrations page", async () => {
  const s = await signIn();
  assert.match(s.location, /\/artists\/band\/admin\/mcp\?meta_code=fake-code-\d+&meta_state=/);
  assert.equal((await callbackGET(new Request("http://x/api/meta/callback?code=c&state=forged.state"))).status, 400);
  await scenario({ scenario: "cancel" });
  assert.equal((await signIn()).error, "user_denied");
  // a state is tied to the admin and the band
  const st = verifyMetaState(signMetaState({ uid: jeff.uid, artistId: TEST_ARTIST, slug: "band" }))!;
  assert.equal(st.artistId, TEST_ARTIST);
  assert.equal(verifyMetaState(signMetaState({ uid: jeff.uid, artistId: TEST_ARTIST, slug: "band" }, -1)), null, "expired");
});

test("one Page with an Instagram: connected, Working, and the Page token never leaves the server", async () => {
  const before = await cmd("meta.status", {});
  assert.deepEqual(before, { configured: true, connection: null, check: null, choose: null });
  const out = await connect();
  assert.equal(out.connection.instagram.username, "ingridavisonband");
  assert.equal(out.connection.page.name, "Ingrid Avison Band");
  assert.equal(out.connection.connectedBy.name, "Jeff");
  assert.deepEqual(out.check, { working: true, username: "ingridavisonband" });
  // stored sealed, never in a command's answer
  const raw = (await firestore().doc(`metaConnections/${TEST_ARTIST}`).get()).data()!;
  assert.notEqual(raw.pageToken, "page-token-1");
  assert.equal(unsealMeta(raw.pageToken), "page-token-1");
  for (const name of ["meta.status", "meta.connectUrl", "meta.disconnect"]) assert.ok(!JSON.stringify(await cmd(name, {})).includes("page-token"), name);
  assert.ok(!JSON.stringify(out).includes("page-token"));
});

test("a revoked token reads Sign in again with Facebook's reason; Disconnect deletes the connection and connecting again works", async () => {
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

test("several Pages with an Instagram: the card asks which; only the admin who signed in can pick, and the pick is stored", async () => {
  await scenario({ scenario: "several" });
  const out = await connect();
  assert.equal(out.connection, null);
  assert.deepEqual(out.choose.map((p: { igUsername: string }) => p.igUsername), ["ingridavisonband", "ingridsolo"]);
  assert.ok(!JSON.stringify(out).includes("page-token"));
  const ingrid = await makeUser("ingrid@example.com", "admin", { name: "Ingrid" });
  const ictx: Ctx = { ...ctx, uid: ingrid.uid };
  assert.equal((await cmd("meta.status", {}, ictx)).choose, null, "someone else's choice isn't offered");
  await code(cmd("meta.choosePage", { pageId: "page-2" }, ictx), "invalid_state");
  const done = await cmd("meta.choosePage", { pageId: "page-2" });
  assert.equal(done.connection.instagram.username, "ingridsolo");
  assert.equal(done.choose, null);
  assert.equal(unsealMeta((await firestore().doc(`metaConnections/${TEST_ARTIST}`).get()).data()!.pageToken), "page-token-2");
});

test("no Page, a Page with no Instagram and a declined permission each say what to do, and store nothing", async () => {
  await scenario({ scenario: "none" });
  await assert.rejects(connect(), (e: any) => e.code === "meta_no_page" && /pick the band's Page/.test(e.message)); // eslint-disable-line @typescript-eslint/no-explicit-any
  await scenario({ scenario: "noInstagram" });
  await assert.rejects(connect(), (e: any) => e.code === "meta_no_instagram" && /Ingrid Avison Band has no Instagram Professional account/.test(e.message) && /Switch to professional account/.test(e.message)); // eslint-disable-line @typescript-eslint/no-explicit-any
  await scenario({ scenario: "declined" });
  await assert.rejects(connect(), (e: any) => e.code === "meta_declined" && /post to Instagram \(instagram_content_publish\)/.test(e.message) && /Connect with Facebook again/.test(e.message)); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal((await cmd("meta.status", {})).connection, null);
});

test("finishConnect refuses a state another admin started; members can't connect at all", async () => {
  const s = await signIn();
  const ingrid = await makeUser("ingrid@example.com", "admin", { name: "Ingrid" });
  await code(cmd("meta.finishConnect", { code: s.code, state: s.state }, { ...ctx, uid: ingrid.uid }), "invalid_state");
  await code(cmd("meta.finishConnect", { code: s.code, state: s.state }, { ...ctx, artistId: "another-band" }), "invalid_state");
  for (const name of ["meta.status", "meta.connectUrl", "meta.disconnect", "posts.publishPhoto"]) {
    assert.equal((await dispatch(name, `Bearer ${david.token}`, {})).status, 403, name);
  }
});

test("encryption round-trips, with a fresh IV each time", () => {
  const a = sealMeta("page-token-1"), b = sealMeta("page-token-1");
  assert.notEqual(a, b);
  assert.equal(unsealMeta(a), "page-token-1");
  assert.throws(() => unsealMeta(a.replace(/.$/, (c) => (c === "A" ? "B" : "A"))));
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

// ---------- upload ----------

const jpeg = (name = "Roots.jpg", type = "image/jpeg") => new File([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], name, { type });
async function upload(token: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  const res = await uploadPOST(new Request("http://app/api/posts/upload", { method: "POST", headers: { authorization: `Bearer ${token}`, "x-artist-id": TEST_ARTIST }, body }));
  return { status: res.status, json: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

test("upload: refused without a Posts folder, for anything but a JPEG, and for members; else into the month's folder, made once and reused", async () => {
  const none = await upload(jeff.token, jpeg());
  assert.equal(none.status, 400);
  assert.match(none.json.error.message, /Choose a Posts folder in Settings › Google/);
  assert.equal((await cmd("google.setPostsFolder", { folder: "https://drive.google.com/drive/folders/fake-folder-posts" })).postsFolder.name, "Posts");
  const png = await upload(jeff.token, jpeg("x.png", "image/png"));
  assert.equal(png.status, 400);
  assert.equal(png.json.error.message, "Instagram takes JPEG photos");
  assert.equal((await upload(david.token, jpeg())).status, 403);

  const a = await upload(jeff.token, jpeg("Roots.jpg"));
  assert.equal(a.status, 200, JSON.stringify(a.json));
  const b = await upload(jeff.token, jpeg("Hi-Dive.jpg"));
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
  assert.equal(a.json.folder.name, month);
  assert.equal(b.json.folder.id, a.json.folder.id, "the month's folder is reused");
  const drive = driveClient({ artistId: TEST_ARTIST });
  const folders = (await drive.search({ parent: "fake-folder-posts" })).filter((f) => f.name === month);
  assert.equal(folders.length, 1);
  const f = await drive.get(a.json.driveFileId);
  assert.equal(f.name, "Roots.jpg");
  assert.deepEqual(f.parents, [a.json.folder.id]);
  assert.ok(f.permissions.some((p) => p.email === "ingrid@example.com"), "shared with the band");
  assert.equal((await db.list("posts")).length, 0, "nothing is posted yet");
});

// ---------- publishPhoto ----------

test("publishPhoto: Instagram fetches the photo from the signed link, posts it, and the post keeps its link", async () => {
  await code(cmd("posts.publishPhoto", { driveFileId: "fake-photo-roots", caption: "Thanks, Roots!" }), "meta_not_connected");
  await connect();
  await code(cmd("posts.publishPhoto", { driveFileId: "fake-release-cover", caption: "x" }), "invalid_input"); // a PNG
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
  assert.ok(!JSON.stringify(r).includes("page-token"));
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
