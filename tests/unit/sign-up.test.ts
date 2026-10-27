import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/sign-up/route";
import { adminAuth } from "@/server/admin";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { startSession } from "@/server/session";
import { resetEmulators, makeUser, makeArtist, idToken, readySession } from "./helpers";

beforeEach(resetEmulators);
const bearer = (t: string) => `Bearer ${t}`;
type Err = { error: { code: string; message: string; issues?: { path: string; message: string }[] } };
async function stranger(email = "pat@example.com", name = "Pat Stranger") {
  const u = await adminAuth().createUser({ email, emailVerified: true, displayName: name });
  return { uid: u.uid, token: await idToken(u.uid) };
}
const call = async (token: string | null, body: unknown) => {
  const res = await POST(new NextRequest("http://localhost/api/sign-up", { method: "POST", headers: token ? { authorization: bearer(token) } : {}, body: JSON.stringify(body) }));
  return { status: res.status, json: (await res.json()) as { slug: string } & Err };
};

test("artists.signUp: a stranger gets a user, an artist with its templates, and an admin membership", async () => {
  const p = await stranger();
  const r = await call(p.token, { name: "The Night Owls" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { slug: "the-night-owls" });
  const user = (await db.get("users", p.uid))!;
  assert.equal(user.email, "pat@example.com");
  assert.equal(user.name, "Pat Stranger");
  const [artist] = await db.list("artists", (q) => q.where("slug", "==", "the-night-owls"));
  assert.equal(artist.name, "The Night Owls");
  assert.equal(artist.createdBy, p.uid);
  assert.deepEqual(user.artists, [{ artistId: artist.id, role: "admin", mcpAccess: false }]);
  assert.equal(user.musicianId, undefined);
  assert.equal((await db.list("musicians")).length, 0);
  assert.deepEqual((await db.list("checklistTemplates", (q) => q.where("artistId", "==", artist.id))).map((t) => t.name).sort(), ["Follow Up", "Promo"]);
  assert.deepEqual((await adminAuth().getUser(p.uid)).customClaims, { artists: { [artist.id]: "admin" } });
  // History records it like any other write
  assert.equal((await db.history("artists", artist.id)).length, 1);
  assert.equal((await db.history("users", p.uid))[0].via, "app");
  // and the next sign-in opens the band
  const s = await readySession(bearer(await idToken(p.uid)));
  assert.deepEqual(s.artists, [{ artistId: artist.id, slug: "the-night-owls", name: "The Night Owls", role: "admin" }]);
});

test("artists.signUp: instruments make the creator a Band Member linked to their login", async () => {
  const p = await stranger();
  assert.equal((await call(p.token, { name: "The Night Owls", instruments: [" guitar ", "", "vocals"] })).status, 200);
  const user = (await db.get("users", p.uid))!;
  const m = (await db.get("musicians", user.musicianId))!;
  assert.deepEqual([m.name, m.email, m.instruments, m.active, m.userId], ["Pat Stranger", "pat@example.com", ["guitar", "vocals"], true, p.uid]);
  assert.equal((await adminAuth().getUser(p.uid)).customClaims!.musicianId, user.musicianId);
});

test("artists.signUp: refuses someone who already belongs to a band", async () => {
  await makeArtist("Test Band", "test-band");
  const member = await makeUser("m@example.com", "member");
  const r = await call(member.token, { name: "Another Band" });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, "already_member");
  assert.equal((await db.list("artists")).length, 1);
  // not even after a first sign-up
  const p = await stranger();
  assert.equal((await call(p.token, { name: "One" })).status, 200);
  assert.equal((await call(p.token, { name: "Two" })).status, 409);
  assert.equal((await db.list("artists")).length, 2);
});

test("artists.signUp: a taken name gets -2; a chosen slug that is taken is a 409 on the slug", async () => {
  const a = await stranger("a@example.com", "A");
  const b = await stranger("b@example.com", "B");
  const c = await stranger("c@example.com", "C");
  assert.equal((await call(a.token, { name: "The Night Owls" })).json.slug, "the-night-owls");
  assert.equal((await call(b.token, { name: "The Night Owls" })).json.slug, "the-night-owls-2");
  const taken = await call(c.token, { name: "Other", slug: "the-night-owls" });
  assert.equal(taken.status, 409);
  assert.equal(taken.json.error.code, "slug_taken");
  assert.deepEqual(taken.json.error.issues, [{ path: "slug", message: "Already taken" }]);
  assert.equal((await db.get("users", c.uid)), null); // the failed attempt wrote nothing
  assert.equal((await call(c.token, { name: "Other", slug: "Not Valid" })).status, 400);
  assert.equal((await call(c.token, { name: "  " })).status, 400);
  assert.equal((await call(c.token, { name: "Other", slug: "my-own" })).json.slug, "my-own");
});

test("artists.signUp: needs a verified ID token", async () => {
  assert.equal((await call(null, { name: "X Band" })).status, 401);
  assert.equal((await call("garbage", { name: "X Band" })).status, 401);
  const u = await adminAuth().createUser({ email: "unverified@example.com", emailVerified: false });
  assert.equal((await call(await idToken(u.uid), { name: "X Band" })).status, 401);
});

test("artists.signUp: an AI-tools-only login and a removed person can't use it", async () => {
  await makeArtist("Test Band", "test-band");
  const bot = await makeUser("bot@example.com", "ai");
  assert.equal((await call(bot.token, { name: "Bot Band" })).status, 409);
  const gone = await makeUser("gone@example.com", "member");
  await db.softDelete(importCtx(), "users", gone.uid);
  assert.equal((await call(gone.token, { name: "Gone Band" })).status, 403);
  await assert.rejects(startSession(bearer(gone.token)), (e: { code: string }) => e.code === "not_invited");
});
