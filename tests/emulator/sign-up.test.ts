import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/sign-up/route";
import { adminAuth, firestore } from "@/server/admin";
import { dispatch } from "@/server/commands/dispatch";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { startSession } from "@/server/session";
import { resetEmulators, makeUser, makeArtist, makePlatformAdmins, idToken, readySession, SYS, TEST_ARTIST } from "./helpers";

/** Sign-up is closed unless platform/config says otherwise (scripts/platform-config.ts). Most tests here open it. */
const setSignUp = (open: boolean) => firestore().doc("platform/config").set({ signUpOpen: open });
beforeEach(async () => { await resetEmulators(); await setSignUp(true); });
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

test("artists.signUp: closed by default (no platform/config) and when signUpOpen isn't true: invite_only, nothing written", async () => {
  const p = await stranger();
  for (const close of [() => firestore().doc("platform/config").delete(), () => setSignUp(false), () => firestore().doc("platform/config").set({ signUpOpen: "yes" })]) {
    await close();
    const r = await call(p.token, { name: "The Night Owls" });
    assert.equal(r.status, 403);
    assert.deepEqual(r.json.error, { code: "invite_only", message: "Roadie is invite-only for now. Ask your band's admin to add you." });
  }
  // checked before the token, so even an anonymous caller learns only that
  assert.equal((await call(null, { name: "X" })).json.error.code, "invite_only");
  assert.equal(await db.get(SYS, "users", p.uid), null);
  assert.equal((await db.list(SYS, "artists")).length, 0);
  // opening it again needs no deploy
  await setSignUp(true);
  assert.equal((await call(p.token, { name: "The Night Owls" })).status, 200);
});

test("closed sign-up: someone an admin added with users.add still signs in to the band the first time", async () => {
  await setSignUp(false);
  await makeArtist("Test Band", "test-band");
  const admin = await makeUser("a@example.com", "admin");
  const r = await dispatch("users.add", bearer(admin.token), { email: "new@example.com", name: "New Person", role: "member" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const { id } = (r.json as { result: { id: string } }).result;
  // their first Google sign-in: the Auth account users.add made
  const uid = (await adminAuth().getUserByEmail("new@example.com")).uid;
  assert.equal(uid, id);
  const s = await readySession(bearer(await idToken(uid)));
  assert.deepEqual(s.artists, [{ artistId: "test-artist", slug: "test-band", name: "Test Band", role: "member", timeZone: "America/Denver" }]);
  // and Start a band stays shut for them too
  assert.equal((await call(await idToken(uid), { name: "Mine" })).json.error.code, "invite_only");
});

test("artists.signUp: a stranger gets a user, an artist with its templates, and an admin membership", async () => {
  const p = await stranger();
  const r = await call(p.token, { name: "The Night Owls" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { slug: "the-night-owls" });
  const user = (await db.get(SYS, "users", p.uid))!;
  assert.equal(user.email, "pat@example.com");
  assert.equal(user.name, "Pat Stranger");
  assert.ok(user.acceptedTermsAt, "starting an artist records that they agreed to the Terms");
  const [artist] = await db.list(SYS, "artists", (q) => q.where("slug", "==", "the-night-owls"));
  assert.equal(artist.name, "The Night Owls");
  assert.equal(artist.createdBy, p.uid);
  assert.equal(artist.timeZone, "America/Denver", "no zone sent: the default");
  assert.deepEqual(user.artists, [{ artistId: artist.id, role: "admin", mcpAccess: false }]);
  assert.equal(user.musicianId, undefined);
  assert.equal((await db.list(SYS, "musicians")).length, 0);
  assert.deepEqual((await db.list(SYS, "checklistTemplates", (q) => q.where("artistId", "==", artist.id))).map((t) => t.name).sort(), ["Follow Up", "Promo"]);
  // and the General project, so Money in / Money out can save before any other project exists
  assert.deepEqual((await db.list(SYS, "projects", (q) => q.where("artistId", "==", artist.id))).map((t) => [t.name, t.kind, t.isDefault, t.status]), [["General", "band", true, "open"]]);
  assert.deepEqual((await adminAuth().getUser(p.uid)).customClaims, { artists: { [artist.id]: "admin" }, adminOf: [artist.id], musicians: {} });
  // History records it like any other write
  assert.equal((await db.history(SYS, "artists", artist.id)).length, 1);
  assert.equal((await db.history(SYS, "users", p.uid))[0].via, "app");
  // and the next sign-in opens the band
  const s = await readySession(bearer(await idToken(p.uid)));
  assert.deepEqual(s.artists, [{ artistId: artist.id, slug: "the-night-owls", name: "The Night Owls", role: "admin", timeZone: "America/Denver" }]);
});

test("artists.signUp: instruments make the creator a Band Member linked to their login", async () => {
  const p = await stranger();
  assert.equal((await call(p.token, { name: "The Night Owls", instruments: [" guitar ", "", "vocals"] })).status, 200);
  const user = (await db.get(SYS, "users", p.uid))!;
  const m = (await db.get(SYS, "musicians", user.artists[0].musicianId))!;
  assert.deepEqual([m.name, m.email, m.instruments, m.active, m.userId], ["Pat Stranger", "pat@example.com", ["guitar", "vocals"], true, p.uid]);
  assert.equal(user.musicianId, undefined); // the link is on the membership
  // The artist first, then the musician in it (tenancy phase 2); the membership carries the link.
  assert.equal(m.artistId, user.artists[0].artistId);
  assert.deepEqual(user.artists, [{ artistId: m.artistId, role: "admin", mcpAccess: false, musicianId: m.id }]);
  assert.deepEqual((await adminAuth().getUser(p.uid)).customClaims!.musicians, { [m.artistId]: m.id });
});

test("artists.signUp: refuses someone who already belongs to a band", async () => {
  await makeArtist("Test Band", "test-band");
  const member = await makeUser("m@example.com", "member");
  const r = await call(member.token, { name: "Another Band" });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, "already_member");
  assert.equal((await db.list(SYS, "artists")).length, 1);
  // not even after a first sign-up
  const p = await stranger();
  assert.equal((await call(p.token, { name: "One" })).status, 200);
  assert.equal((await call(p.token, { name: "Two" })).status, 409);
  assert.equal((await db.list(SYS, "artists")).length, 2);
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
  assert.equal((await db.get(SYS, "users", c.uid)), null); // the failed attempt wrote nothing
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
  await db.softDelete(importCtx(TEST_ARTIST), "users", gone.uid);
  assert.equal((await call(gone.token, { name: "Gone Band" })).status, 403);
  await assert.rejects(startSession(bearer(gone.token)), (e: { code: string }) => e.code === "not_invited");
});

test("artists.signUp: the artist gets the time zone the form sends; one that isn't a zone is refused on the field", async () => {
  const p = await stranger();
  const bad = await call(p.token, { name: "The Night Owls", timeZone: "Mars/Olympus" });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json.error.issues?.map((i) => i.path), ["timeZone"]);
  const r = await call(p.token, { name: "The Night Owls", timeZone: "America/New_York" });
  assert.equal(r.status, 200);
  const [artist] = await db.list(SYS, "artists", (q) => q.where("slug", "==", "the-night-owls"));
  assert.equal(artist.timeZone, "America/New_York");
});

// ---------- tenancy phase 9: caps on new artists (checkNewArtist) ----------

const CAP = { code: "new_artist_limit", message: "Roadie isn't taking new artists right now. Try again tomorrow." };
const setLimits = (l: Record<string, number>) => firestore().doc("platform/limits").set(l);

test("new artists: at most newArtistsPerDay across Roadie (20 by default); past it nothing is written", async () => {
  await setLimits({ newArtistsPerDay: 2 });
  const [a, b, c] = [await stranger("a@example.com", "A"), await stranger("b@example.com", "B"), await stranger("c@example.com", "C")];
  assert.equal((await call(a.token, { name: "One" })).status, 200);
  assert.equal((await call(b.token, { name: "Two" })).status, 200);
  const r = await call(c.token, { name: "Three" });
  assert.equal(r.status, 429);
  assert.deepEqual(r.json.error, CAP);
  assert.equal(await db.get(SYS, "users", c.uid), null);
  assert.equal((await db.list(SYS, "artists")).length, 2);
  // someone refused for another reason (already in a band) takes no place
  await setLimits({ newArtistsPerDay: 3 });
  assert.equal((await call(a.token, { name: "Again" })).json.error.code, "already_member");
  assert.equal((await call(c.token, { name: "Three" })).status, 200);
});

test("new artists: artists.create counts too (3 per person per day by default), shares sign-up's switch, and platform admins pass", async () => {
  const p = await stranger();
  const made = await call(p.token, { name: "Mine" });
  assert.equal(made.status, 200);
  const [mine] = await db.list(SYS, "artists", (q) => q.where("slug", "==", made.json.slug));
  const create = async (name: string) => dispatch("artists.create", bearer(await idToken(p.uid)), { name, configurations: [] }, mine.id);
  assert.equal((await create("Second")).status, 200);
  assert.equal((await create("Third")).status, 200);
  const fourth = await create("Fourth");
  assert.equal(fourth.status, 429);
  assert.deepEqual((fourth.json as Err).error, CAP);
  // closed sign-up shuts artists.create as well
  await setSignUp(false);
  await setLimits({ newArtistsPerPerson: 10 });
  assert.equal(((await create("Fifth")).json as Err).error.code, "invite_only");
  // ...except for Roadie's platform admins, who pass every cap
  await makePlatformAdmins(p.uid);
  await setLimits({ newArtistsPerPerson: 0, newArtistsPerDay: 0 });
  assert.equal((await create("Sixth")).status, 200);
  assert.equal((await db.list(SYS, "artists")).length, 4);
});
