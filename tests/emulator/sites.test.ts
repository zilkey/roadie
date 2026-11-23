import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { newRunId, type Ctx } from "@/server/ctx";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { fakeHostingState, fakeServe, hostingClient, resetFakeHosting, type HostingApi } from "@/server/integrations/hosting";
import { createSiteDoc, readSite, saveAsset, writeDraft, draftFiles } from "@/server/sites/store";
import { reconcile } from "@/server/sites/publish";
import { refreshSite } from "@/server/sites/refresh";
import { undoRun } from "@/server/undo";
import { isEligible } from "@/server/assistant/policy";
import { resetEmulators, makeUser, makeArtist, venue, TEST_ARTIST, SYS } from "./helpers";

// docs/designs/sites: the draft through the Writer; publish, promote, rollback and refresh through one lease-guarded release.

let ctx: Ctx, mctx: Ctx, aictx: Ctx, roadie: Ctx;
const api = (): HostingApi => hostingClient();
const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const refused = (p: Promise<unknown>, code = "forbidden") => assert.rejects(p, (e: AppError) => e.code === code);
const SHOW = { sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false }, docs: [], times: { set: "20:00", setLengthSec: 2400 } };
const tomorrow = () => new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  await resetEmulators();
  resetFakeHosting();
  await makeArtist("Ingrid Avison", "ingrid-avison");
  const a = await makeUser("ingrid@example.com", "admin", { name: "Ingrid" });
  ctx = { uid: a.uid, role: "admin", artistId: TEST_ARTIST, via: "app", runId: newRunId() };
  const m = await makeUser("drums@example.com", "member", { name: "Drums" });
  mctx = { uid: m.uid, role: "member", artistId: TEST_ARTIST, via: "app", runId: newRunId() };
  aictx = { uid: a.uid, role: "mcp", artistId: TEST_ARTIST, via: "mcp", runId: newRunId() };
  roadie = { ...ctx, via: "assistant", runId: newRunId() };
  await createSiteDoc(TEST_ARTIST, "Ingrid Avison", { project: "demo", liveSite: "ingrid", stagingSite: "ingrid-staging" }, a.uid);
  await cmd("site.write", { path: "index.html", body: "<title>Home</title><h1>Ingrid</h1><roadie-shows></roadie-shows>" });
  await cmd("site.write", { path: "partials/header.html", body: "<header>Ingrid</header>" });
  await cmd("site.write", { path: "style.css", body: "h1{color:red}" });
});

test("no site: every command refuses", async () => {
  const other: Ctx = { ...ctx, artistId: "someone-else" };
  await refused(cmd("site.status", {}, other));
  await refused(cmd("site.write", { path: "index.html", body: "x" }, other));
});

test("the draft: write twice updates one doc; edit needs a unique match; members read only; site.json is person only", async () => {
  await cmd("site.write", { path: "about.html", body: "<p>One</p>" });
  await cmd("site.write", { path: "about.html", body: "<p>Two</p><script>x</script>" });
  const files = await draftFiles(ctx);
  assert.equal(files.filter((f) => f.path === "about.html").length, 1);
  assert.equal((await cmd("site.read", { path: "about.html" })).body, "<p>Two</p>", "sanitized at write");
  await refused(cmd("site.edit", { path: "about.html", find: "nope", replace: "x" }), "invalid_input");
  await cmd("site.edit", { path: "about.html", find: "Two", replace: "Three" });
  assert.equal((await cmd("site.read", { path: "about.html" }, mctx)).body, "<p>Three</p>");
  await refused(cmd("site.write", { path: "about.html", body: "x" }, mctx));
  await refused(cmd("site.write", { path: "site.json", body: "{}" }, aictx));
  await refused(cmd("site.write", { path: "site.json", body: "{}" }, roadie));
  await cmd("site.write", { path: "site.json", body: JSON.stringify({ title: "Ingrid" }) });
  await refused(cmd("site.write", { path: "index.html", body: "<roadie-gallery></roadie-gallery>" }), "invalid_input");
  // removed, then written again
  await cmd("site.remove", { path: "about.html" });
  assert.equal((await draftFiles(ctx)).some((f) => f.path === "about.html"), false);
  await cmd("site.write", { path: "about.html", body: "<p>Back</p>" });
  assert.equal((await cmd("site.read", { path: "about.html" })).body, "<p>Back</p>");
});

test("Roadie gets the draft tools, never publish, promote, rollback or settings", () => {
  for (const n of ["site.status", "site.pages", "site.read", "site.write", "site.edit", "site.remove"]) assert.ok(isEligible(n, "admin"), n);
  for (const n of ["site.publish", "site.promote", "site.rollback", "site.reconcile", "site.settings.update", "site.preview"]) assert.equal(isEligible(n, "admin"), false, n);
  for (const n of ["site.publish", "site.promote", "site.rollback"]) assert.equal(registry[n].roles.includes("mcp"), false, n);
});

test("undoing Roadie's edit run reverts the draft and never the public site", async () => {
  await cmd("site.publish", { site: "live" });
  await cmd("site.edit", { path: "index.html", find: "Ingrid</h1>", replace: "Ingrid Avison</h1>" }, roadie);
  assert.match((await cmd("site.read", { path: "index.html" })).body, /Ingrid Avison/);
  await undoRun(roadie, roadie.runId);
  assert.doesNotMatch((await cmd("site.read", { path: "index.html" })).body, /Ingrid Avison/);
  assert.equal((await readSite(TEST_ARTIST))!.liveVersion, 1);
});

test("publish to staging, promote (uploads nothing), history, rollback; images upload once", async () => {
  const sha = await saveAsset(TEST_ARTIST, Buffer.from("png-bytes"), "image/png", "a.png", ctx.uid, ctx.runId);
  await writeDraft(ctx, { path: "img/a.png", kind: "image", body: sha });
  const s1 = await cmd("site.publish", { site: "staging", note: "first" });
  assert.equal(s1.n, 1); assert.equal(s1.state, "done");
  assert.match((await fakeServe("ingrid-staging", "/"))!, /<h1>Ingrid<\/h1>/);
  const status = await cmd("site.status", {});
  assert.equal(status.stagingVersion, 1);
  assert.equal(status.liveVersion, null);
  assert.ok(status.changes.length > 0, "live has nothing yet");
  const uploads = fakeHostingState().uploads;
  const p = await cmd("site.promote", {});
  assert.equal(p.n, 2); assert.equal(p.uploaded, 0, "the same files: nothing uploads");
  assert.equal(fakeHostingState().uploads, uploads);
  assert.match((await fakeServe("ingrid", "/"))!, /Ingrid/);
  assert.deepEqual((await cmd("site.status", {})).changes, [], "live matches the draft");

  await cmd("site.edit", { path: "index.html", find: "<h1>Ingrid</h1>", replace: "<h1>New</h1>" });
  assert.deepEqual((await cmd("site.status", {})).changes, [{ path: "index.html", change: "changed" }]);
  const l3 = await cmd("site.publish", { site: "live" });
  assert.equal(l3.n, 3);
  assert.equal(l3.uploaded, 1, "only the changed page uploads");
});

test("rollback re-releases a held version without building, pauses refresh; the next publish resumes it", async () => {
  await cmd("site.publish", { site: "live" });
  await cmd("site.edit", { path: "index.html", find: "<h1>Ingrid</h1>", replace: "<h1>New</h1>" });
  await cmd("site.publish", { site: "live" });
  assert.match((await fakeServe("ingrid", "/"))!, /New/);
  const versionsBefore = Object.keys(fakeHostingState().versions).length;
  const r = await cmd("site.rollback", { site: "live", n: 1 });
  assert.equal(r.n, 3);
  assert.equal(Object.keys(fakeHostingState().versions).length, versionsBefore, "no new build");
  assert.doesNotMatch((await fakeServe("ingrid", "/"))!, /New/);
  let site = (await readSite(TEST_ARTIST))!;
  assert.equal(site.liveVersion, 3); assert.equal(site.refreshPaused?.live, true);
  await cmd("site.publish", { site: "live" });
  site = (await readSite(TEST_ARTIST))!;
  assert.equal(site.refreshPaused?.live, false);
  const v = await cmd("site.versions", {});
  assert.deepEqual(v.versions.map((x: { kind: string }) => x.kind), ["publish", "rollback", "publish", "publish"]);
});

test("a held lease refuses a publish; a failure before release marks the version failed", async () => {
  const r = await (await import("@/server/sites/store")).refs(TEST_ARTIST);
  await r.site.update({ lease: { token: "x", by: "someone", until: Date.now() + 60_000 } });
  await refused(cmd("site.publish", { site: "live" }), "busy");
  await r.site.update({ lease: null });
  fakeHostingState().failNext.release = "boom";
  await assert.rejects(cmd("site.publish", { site: "live" }));
  const v = await cmd("site.versions", {});
  assert.equal(v.versions[0].state, "failed");
  assert.equal((await readSite(TEST_ARTIST))!.liveVersion, undefined);
  assert.equal((await readSite(TEST_ARTIST))!.lease ?? null, null);
});

test("reconcile: a release that landed but was never recorded is settled done; a console rollback is recorded and pauses refresh", async () => {
  await cmd("site.publish", { site: "live" });
  await cmd("site.edit", { path: "index.html", find: "<h1>Ingrid</h1>", replace: "<h1>Two</h1>" });
  await cmd("site.publish", { site: "live" });
  const r = await (await import("@/server/sites/store")).refs(TEST_ARTIST);
  // Pretend step 4 never ran for version 2.
  await r.versions.doc("2").update({ state: "pending" });
  await r.site.update({ liveVersion: 1 });
  await reconcile(TEST_ARTIST);
  assert.equal((await readSite(TEST_ARTIST))!.liveVersion, 2);
  assert.equal((await cmd("site.versions", {})).versions[0].state, "done");
  // A rollback in the Firebase console: a release of version 1's hosting version with no roadie: message.
  const v1 = (await r.versions.doc("1").get()).data()!;
  await api().release("ingrid", v1.hostingVersion, "");
  await reconcile(TEST_ARTIST);
  const site = (await readSite(TEST_ARTIST))!;
  assert.equal(site.liveVersion, 3); assert.equal(site.refreshPaused?.live, true);
  const rec = (await cmd("site.versions", {})).versions[0];
  assert.equal(rec.kind, "reconcile"); assert.equal(rec.rebuildable, true, "sources copied from version 1");
  await reconcile(TEST_ARTIST);
  assert.equal((await readSite(TEST_ARTIST))!.liveVersion, 3, "recorded once");
});

test("refresh: unchanged shows skip; a new public show re-renders live from its own sources, not the draft", async () => {
  await cmd("site.publish", { site: "live" });
  await cmd("site.edit", { path: "index.html", find: "<h1>Ingrid</h1>", replace: "<h1>Unpublished</h1>" });
  assert.deepEqual((await refreshSite(TEST_ARTIST)).refreshed, []);
  const v = await db.create(SYS, "venues", venue("Gold Hill Inn", "Boulder"));
  await db.create(ctx, "shows", { date: tomorrow(), status: "confirmed", venue: { id: v.id, name: "Gold Hill Inn", city: "Boulder" }, personnel: [], ...SHOW });
  const r = await refreshSite(TEST_ARTIST);
  assert.deepEqual(r.refreshed, ["live:2"]);
  const html = (await fakeServe("ingrid", "/"))!;
  assert.match(html, /Gold Hill Inn/);
  assert.doesNotMatch(html, /Unpublished/, "the draft never ships with a refresh");
  assert.deepEqual((await refreshSite(TEST_ARTIST)).refreshed, [], "nothing new");
  await cmd("site.settings.update", { autoRefresh: false });
  await db.create(ctx, "shows", { date: tomorrow(), status: "confirmed", venue: { id: v.id, name: "Gold Hill Inn", city: "Boulder" }, personnel: [], ...SHOW, times: { set: "21:00", setLengthSec: 2400 } });
  assert.deepEqual((await refreshSite(TEST_ARTIST)).refreshed, []);
  assert.equal((await cmd("site.status", {})).showsChanged.live, true);
});

test("preview renders the draft or a version, with signed image links", async () => {
  const sha = await saveAsset(TEST_ARTIST, Buffer.from("png"), "image/png", "a.png", ctx.uid, ctx.runId);
  await writeDraft(ctx, { path: "img/a.png", kind: "image", body: sha });
  await cmd("site.edit", { path: "index.html", find: "<h1>Ingrid</h1>", replace: `<h1>Ingrid</h1><img src="/img/a.png" alt="a">` });
  const p = await cmd("site.preview", { path: "index.html" }, mctx);
  assert.match(p.html, new RegExp(`/api/sites/img/${TEST_ARTIST}/${sha}\\?exp=\\d+&amp;sig=`));
  await cmd("site.publish", { site: "staging" });
  await cmd("site.edit", { path: "index.html", find: "<h1>Ingrid</h1>", replace: "<h1>Draft</h1>" });
  assert.doesNotMatch((await cmd("site.preview", { path: "index.html", n: 1 })).html, /Draft/);
  assert.match((await cmd("site.preview", { path: "index.html" })).html, /Draft/);
});
