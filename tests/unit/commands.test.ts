import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "@/server/commands/dispatch";
import { POST } from "@/app/api/commands/[name]/route";
import { startSession } from "@/server/session";
import { adminAuth } from "@/server/admin";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { resetEmulators, makeUser, idToken } from "./helpers";

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
  assert.deepEqual((await adminAuth().getUser(uid)).customClaims, { role: "member", musicianId: mid });
  assert.equal((await dispatch("users.add", bearer(admin.token), { email: "david@example.com", name: "D", role: "member" })).status, 409);

  const s = await startSession(bearer(await idToken(uid)));
  assert.equal(s.role, "member");
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
