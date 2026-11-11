import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { dispatch } from "@/server/commands/dispatch";
import { POST } from "@/app/api/commands/[name]/route";
import { startSession } from "@/server/session";
import { adminAuth, firestore } from "@/server/admin";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { hashToken } from "@/server/availability";
import { registry } from "@/server/commands/registry";
import { authenticateToken, mcpCtx } from "../../mcp/auth";
import { readySession, resetEmulators, makeUser, makeArtist, idToken, venue, TEST_ARTIST } from "./helpers";

beforeEach(resetEmulators);
const bearer = (t: string) => `Bearer ${t}`;
type Err = { error: { code: string; message: string } };
const result = <T = { id: string }>(r: { json: unknown }) => (r.json as { result: T }).result;
const band = (name: string, extra: Record<string, unknown> = {}) => ({ name, configurations: [], ...extra });

// ---------- slugs ----------

test("artists.create: slug from the name, unique (suffixes when free-picked, 409 when asked for), creator becomes admin", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const a = await dispatch("artists.create", bearer(admin.token), band("Nora Quill"));
  assert.equal(a.status, 200);
  assert.equal(result<{ slug: string }>(a).slug, "nora-quill");
  // now in two artists, so calls say which one they are made from
  const create = (input: unknown) => dispatch("artists.create", bearer(admin.token), input, TEST_ARTIST);
  assert.equal((await dispatch("artists.create", bearer(admin.token), band("X"))).status, 400);
  const b = await create(band("Nora Quill"));
  assert.equal(result<{ slug: string }>(b).slug, "nora-quill-2");
  // asking for a taken slug is refused, naming the field
  const c = await create(band("Other", { slug: "nora-quill" }));
  assert.equal(c.status, 409);
  assert.equal((c.json as Err).error.code, "slug_taken");
  // an invalid slug is a validation error
  assert.equal((await create(band("Other", { slug: "Not Valid" }))).status, 400);
  // the creator is an admin of each new artist (and keeps their first one)
  const me = (await db.get("users", admin.uid))!;
  assert.deepEqual(me.artists, [
    { artistId: TEST_ARTIST, role: "admin" }, { artistId: result(a).id, role: "admin", mcpAccess: false }, { artistId: result(b).id, role: "admin", mcpAccess: false },
  ]);
  assert.equal(((await adminAuth().getUser(admin.uid)).customClaims!.artists as Record<string, string>)[result(a).id], "admin");
});

test("artists.update: slug is validated, unique among artists, and only for the artist you are in", async () => {
  await makeArtist("Test Band", "test-band");
  await makeArtist("Other Band", "other-band", "other");
  const admin = await makeUser("a@example.com", "admin");
  const set = (id: string, slug: unknown) => dispatch("artists.update", bearer(admin.token), { id, patch: { slug } });
  assert.equal((await set(TEST_ARTIST, "Bad Slug")).status, 400);
  assert.equal((await set(TEST_ARTIST, null)).status, 400); // required
  const taken = await set(TEST_ARTIST, "other-band");
  assert.equal(taken.status, 409);
  assert.equal((taken.json as Err).error.code, "slug_taken");
  assert.equal((await set(TEST_ARTIST, "test-band")).status, 200); // its own slug is fine
  assert.equal((await set(TEST_ARTIST, "the-test-band")).status, 200);
  assert.equal((await db.get("artists", TEST_ARTIST))!.slug, "the-test-band");
  // you can't edit an artist you aren't working in
  assert.equal((await set("other", "mine-now")).status, 403);
  // a soft-deleted artist still holds its slug
  await db.softDelete(importCtx(), "artists", "other");
  assert.equal((await set(TEST_ARTIST, "other-band")).status, 409);
});

// ---------- membership ----------

test("membership: the request names the artist; non-members are refused; your role is the one in that artist", async () => {
  await makeArtist("Band A", "band-a", "a");
  await makeArtist("Band B", "band-b", "b");
  await makeArtist("Band C", "band-c", "c");
  const mia = await makeUser("mia@example.com", "admin", { artists: [{ artistId: "a", role: "admin" }, { artistId: "b", role: "member" }] });
  const sam = await makeUser("sam@example.com", "member", { artistId: "a" });
  const input = { name: "Riley", instruments: ["drums"] };
  // admin in A: allowed
  assert.equal((await dispatch("musicians.create", bearer(mia.token), input, "a")).status, 200);
  // member in B: the same person is a member there
  const inB = await dispatch("musicians.create", bearer(mia.token), input, "b");
  assert.equal(inB.status, 403);
  assert.equal((inB.json as Err).error.code, "forbidden");
  // not a member of C at all
  const inC = await dispatch("musicians.create", bearer(mia.token), input, "c");
  assert.equal(inC.status, 403);
  assert.equal((inC.json as Err).error.code, "not_a_member");
  // several artists and no header: must say which
  const none = await dispatch("musicians.create", bearer(mia.token), input);
  assert.equal(none.status, 400);
  assert.equal((none.json as Err).error.code, "artist_required");
  // one artist and no header: that one (sam is a member there, so the role check is what refuses)
  assert.equal(((await dispatch("musicians.create", bearer(sam.token), input)).json as Err).error.code, "forbidden");
  assert.equal(((await dispatch("musicians.create", bearer(sam.token), input, "b")).json as Err).error.code, "not_a_member");

  // the HTTP route reads the x-artist-id header
  const call = (artist: string) => POST(new Request("http://x/api/commands/musicians.create", {
    method: "POST", headers: { "content-type": "application/json", authorization: bearer(mia.token), "x-artist-id": artist }, body: JSON.stringify(input),
  }), { params: Promise.resolve({ name: "musicians.create" }) });
  assert.equal((await call("a")).status, 200);
  assert.equal((await call("c")).status, 403);
});

test("session: lists your app artists (slug, name, role), sets {artists} claims; ai memberships stay out", async () => {
  await makeArtist("Band B", "band-b", "b");
  await makeArtist("Band A", "band-a", "a");
  await makeArtist("Bots", "bots", "z");
  const mia = await makeUser("mia@example.com", "admin", { artists: [{ artistId: "b", role: "member" }, { artistId: "a", role: "admin" }, { artistId: "z", role: "ai" }] });
  const s = await readySession(bearer(await idToken(mia.uid)));
  assert.deepEqual(s.artists, [
    { artistId: "a", slug: "band-a", name: "Band A", role: "admin" },
    { artistId: "b", slug: "band-b", name: "Band B", role: "member" },
  ]);
  assert.deepEqual((await adminAuth().getUser(mia.uid)).customClaims, { artists: { b: "member", a: "admin" } });
});

test("users.*: per artist. Adding someone from another artist joins them; removing takes them out of this artist only", async () => {
  await makeArtist("Band A", "band-a", "a");
  await makeArtist("Band B", "band-b", "b");
  const anna = await makeUser("anna@example.com", "admin", { artistId: "a" });
  const ben = await makeUser("ben@example.com", "admin", { artistId: "b" });
  const added = await dispatch("users.add", bearer(ben.token), { email: "anna@example.com", name: "Anna", role: "member" });
  assert.equal(added.status, 200);
  assert.equal(result(added).id, anna.uid);
  assert.deepEqual((await db.get("users", anna.uid))!.artists, [{ artistId: "a", role: "admin" }, { artistId: "b", role: "member" }]);
  assert.deepEqual((await adminAuth().getUser(anna.uid)).customClaims!.artists, { a: "admin", b: "member" });
  // adding again in the same artist is a duplicate
  assert.equal((await dispatch("users.add", bearer(ben.token), { email: "anna@example.com", name: "Anna", role: "member" })).status, 409);
  // a role change in B leaves A alone
  assert.equal((await dispatch("users.update", bearer(ben.token), { id: anna.uid, patch: { role: "admin" } })).status, 200);
  assert.deepEqual((await db.get("users", anna.uid))!.artists, [{ artistId: "a", role: "admin" }, { artistId: "b", role: "admin", mcpAccess: false }]);
  // B can't touch someone who isn't in B
  const carl = await makeUser("carl@example.com", "member", { artistId: "a" });
  assert.equal((await dispatch("users.update", bearer(ben.token), { id: carl.uid, patch: { role: "admin" } })).status, 404);
  assert.equal((await dispatch("users.remove", bearer(ben.token), { id: carl.uid })).status, 404);
  // removing Anna from B keeps her login and her place in A
  assert.equal((await dispatch("users.remove", bearer(ben.token), { id: anna.uid })).status, 200);
  const after = (await db.get("users", anna.uid))!;
  assert.equal(after.deletedAt, null);
  assert.deepEqual(after.artists, [{ artistId: "a", role: "admin" }]);
  assert.equal((await dispatch("musicians.create", bearer(await idToken(anna.uid)), { name: "x", instruments: [] }, "b")).status, 403);
  assert.equal((await dispatch("musicians.create", bearer(await idToken(anna.uid)), { name: "x", instruments: ["x"] }, "a")).status, 200);
});

test("records.get / records.list: artist docs and other artists' shows and pitches stay in their artist", async () => {
  await makeArtist("Band A", "band-a", "a");
  await makeArtist("Band B", "band-b", "b");
  const v = await db.create(importCtx(), "venues", venue("Deep End"));
  const mine = await db.create(importCtx(), "pitches", { target: { kind: "venue", id: v.id, name: "Deep End" }, status: "toPitch", artistId: "a", personnel: [], showIds: [] });
  const theirs = await db.create(importCtx(), "pitches", { target: { kind: "venue", id: v.id, name: "Deep End" }, status: "toPitch", artistId: "b", personnel: [], showIds: [] });
  const ctx = { ...importCtx(), via: "app" as const, artistId: "a" };
  const get = (kind: string, id: string) => registry["records.get"].run(ctx, { kind, id });
  await get("pitches", mine.id);
  await assert.rejects(get("pitches", theirs.id), (e: { status: number }) => e.status === 404);
  await get("artists", "a");
  await assert.rejects(get("artists", "b"), (e: { status: number }) => e.status === 404);
  const list = (await registry["records.list"].run(ctx, { kind: "pitches", limit: 50 })) as { rows: { id: string }[] };
  assert.deepEqual(list.rows.map((r) => r.id), [mine.id]);
});

test("MCP keys work on one artist: the one they name, or the person's only one", async () => {
  await makeArtist("Band A", "band-a", "a");
  await makeArtist("Band B", "band-b", "b");
  const key = async (userId: string, artistId?: string) => {
    const token = `btk_${randomBytes(32).toString("base64url")}`;
    await db.create(importCtx(), "mcpTokens", { userId, label: "k", ...(artistId ? { artistId } : {}) }, { id: hashToken(token) });
    return token;
  };
  const solo = await makeUser("solo@example.com", "ai", { artistId: "a" });
  const who = await authenticateToken(await key(solo.uid));
  assert.equal(who.artistId, "a");
  assert.equal(mcpCtx(who, "r1").artistId, "a");
  const multi = await makeUser("multi@example.com", "ai", { artists: [{ artistId: "a", role: "ai" }, { artistId: "b", role: "admin" }] });
  await db.update(importCtx(), "users", multi.uid, { artists: [{ artistId: "a", role: "ai" }, { artistId: "b", role: "admin", mcpAccess: true }] });
  await assert.rejects(authenticateToken(await key(multi.uid)), (e: { status: number }) => e.status === 403);
  assert.equal((await authenticateToken(await key(multi.uid, "b"))).artistId, "b");
  await assert.rejects(authenticateToken(await key(solo.uid, "b")), (e: { status: number }) => e.status === 403);
});

// ---------- URLs ----------

// ---------- migration ----------
