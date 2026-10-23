import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "@/server/commands/dispatch";
import { POST } from "@/app/api/commands/[name]/route";
import { startSession } from "@/server/session";
import { adminAuth } from "@/server/admin";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { resetEmulators, makeUser, idToken, makeArtist, TEST_ARTIST } from "./helpers";

beforeEach(resetEmulators);
const bearer = (t: string) => `Bearer ${t}`;

test("auth: no token 401, garbage token 401, no role 403", async () => {
  assert.equal((await dispatch("musicians.create", null, {})).status, 401);
  assert.equal((await dispatch("musicians.create", "Bearer nope", {})).status, 401);
  const u = await adminAuth().createUser({ email: "x@example.com" });
  assert.equal((await dispatch("musicians.create", bearer(await idToken(u.uid)), {})).status, 403);
});

test("roles: member cannot run admin commands; admin can", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const member = await makeUser("m@example.com", "member");
  const input = { name: "Sam", instruments: ["drums"] };
  const denied = await dispatch("musicians.create", bearer(member.token), input);
  assert.equal(denied.status, 403);
  assert.equal(((denied.json as { error: { code: string } }).error.code), "forbidden");
  const ok = await dispatch("musicians.create", bearer(admin.token), input);
  assert.equal(ok.status, 200);
  const id = (ok.json as { result: { id: string } }).result.id;
  assert.equal((await db.get("musicians", id))!.active, true);
  assert.equal((await db.get("musicians", id))!.createdBy, admin.uid);
});

test("validation errors come back as 400 with zod issues; unknown command 404", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const bad = await dispatch("musicians.create", bearer(admin.token), { name: "", instruments: "drums", extra: 1 });
  assert.equal(bad.status, 400);
  const err = (bad.json as { error: { code: string; issues: { path: string }[] } }).error;
  assert.equal(err.code, "invalid_input");
  assert.ok(err.issues.length >= 2);
  assert.equal((await dispatch("nope.nothing", bearer(admin.token), {})).status, 404);
});

test("the HTTP route wraps dispatch", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const call = (name: string, body: unknown, token?: string) =>
    POST(new Request(`http://x/api/commands/${name}`, {
      method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: bearer(token) } : {}) }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ name }) });
  assert.equal((await call("musicians.create", {})).status, 401);
  const res = await call("musicians.create", { name: "Eric", instruments: ["drums"] }, admin.token);
  assert.equal(res.status, 200);
  assert.ok((await res.json()).runId);
});

test("users.add creates invite + claims + musician link; session picks it up; removal revokes", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const m = await dispatch("musicians.create", bearer(admin.token), { name: "David", instruments: ["bass"] });
  const mid = (m.json as { result: { id: string } }).result.id;
  const add = await dispatch("users.add", bearer(admin.token), { email: "David@Example.com", name: "David", role: "member", musicianId: mid });
  assert.equal(add.status, 200);
  const uid = (add.json as { result: { id: string } }).result.id;
  assert.equal((await db.get("users", uid))!.email, "david@example.com");
  assert.equal((await db.get("musicians", mid))!.userId, uid);
  assert.deepEqual((await db.get("users", uid))!.artists, [{ artistId: TEST_ARTIST, role: "member" }]);
  assert.deepEqual((await adminAuth().getUser(uid)).customClaims, { artists: { [TEST_ARTIST]: "member" }, musicianId: mid });
  assert.equal((await dispatch("users.add", bearer(admin.token), { email: "david@example.com", name: "D", role: "member" })).status, 409);

  await makeArtist("Test Band", "test-band");
  const s = await startSession(bearer(await idToken(uid)));
  assert.deepEqual(s.artists, [{ artistId: TEST_ARTIST, slug: "test-band", name: "Test Band", role: "member" }]);
  assert.equal(s.musicianId, mid);

  const rm = await dispatch("users.remove", bearer(admin.token), { id: uid });
  assert.equal(rm.status, 200);
  assert.equal((await db.get("musicians", mid))!.userId, undefined);
  await assert.rejects(startSession(bearer(await idToken(uid))), (e: AppError) => e.code === "not_invited");
  // an old token no longer works
  assert.equal((await dispatch("musicians.create", bearer(await idToken(uid)), { name: "x", instruments: [] })).status, 403);
  // can't demote or remove yourself
  assert.equal((await dispatch("users.update", bearer(admin.token), { id: admin.uid, patch: { role: "member" } })).status, 403);
  assert.equal((await dispatch("users.remove", bearer(admin.token), { id: admin.uid })).status, 403);
});

test("users.add with musician: one call makes the band member and the login, linked", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const add = await dispatch("users.add", bearer(admin.token), { email: "Emma@Example.com", name: "Emma", role: "member", musician: { instruments: ["fiddle", "vocals"] } });
  assert.equal(add.status, 200);
  const { id: uid, musicianId } = (add.json as { result: { id: string; musicianId: string } }).result;
  const m = (await db.get("musicians", musicianId))!;
  assert.deepEqual([m.name, m.email, m.instruments, m.active, m.userId], ["Emma", "emma@example.com", ["fiddle", "vocals"], true, uid]);
  assert.equal((await db.get("users", uid))!.musicianId, musicianId);
  assert.deepEqual((await adminAuth().getUser(uid)).customClaims, { artists: { [TEST_ARTIST]: "member" }, musicianId });
  // musicianId and musician together is refused
  const both = await dispatch("users.add", bearer(admin.token), { email: "x@example.com", name: "X", role: "member", musicianId: musicianId, musician: { instruments: [] } });
  assert.equal(both.status, 400);
});

test("ai role: always has AI access, can't sign in to the app or call commands, can't be self-assigned", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const add = await dispatch("users.add", bearer(admin.token), { email: "bot@example.com", name: "Bot", role: "ai" });
  assert.equal(add.status, 200);
  const uid = (add.json as { result: { id: string } }).result.id;
  const u = (await db.get("users", uid))!;
  assert.deepEqual(u.artists, [{ artistId: TEST_ARTIST, role: "ai" }]);
  assert.equal(u.mcpAccess, true);
  assert.deepEqual((await adminAuth().getUser(uid)).customClaims, { artists: {} }); // ai is never a Firestore-reading role
  await assert.rejects(startSession(bearer(await idToken(uid))), (e: AppError) => e.code === "ai_only" && e.status === 403);
  assert.equal((await dispatch("musicians.create", bearer(await idToken(uid)), { name: "x", instruments: [] })).status, 403);
  // turning AI access off doesn't stick for an ai login; moving a member to ai turns it on
  await dispatch("users.update", bearer(admin.token), { id: uid, patch: { mcpAccess: false } });
  assert.equal((await db.get("users", uid))!.mcpAccess, true);
  const member = await makeUser("m@example.com", "member");
  assert.equal((await dispatch("users.update", bearer(admin.token), { id: member.uid, patch: { role: "ai" } })).status, 200);
  assert.equal((await db.get("users", member.uid))!.mcpAccess, true);
  assert.equal((await dispatch("users.update", bearer(admin.token), { id: admin.uid, patch: { role: "ai" } })).status, 403);
  assert.equal((await dispatch("users.add", bearer(admin.token), { email: "z@example.com", name: "Z", role: "robot" })).status, 400);
});

test("session: uninvited email is 403 not_invited", async () => {
  const u = await adminAuth().createUser({ email: "stranger@example.com", emailVerified: true });
  await assert.rejects(startSession(bearer(await idToken(u.uid))), (e: AppError) => e.code === "not_invited" && e.status === 403);
});

test("artists: configuration ids are assigned", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const r = await dispatch("artists.create", bearer(admin.token), {
    name: "Ingrid Avison Band",
    configurations: [{ name: "Full band", billingName: "Ingrid Avison Band", musicianIds: [], gear: [] }, { name: "Trio", billingName: "Ingrid Avison Trio", musicianIds: [], gear: [{ label: "Keys rig" }] }],
  });
  assert.equal(r.status, 200);
  const a = (await db.get("artists", (r.json as { result: { id: string } }).result.id))!;
  assert.deepEqual(a.configurations.map((c: { id: string }) => c.id), ["full-band", "trio"]);
});
