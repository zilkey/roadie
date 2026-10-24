import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "@/server/commands/dispatch";
import { startSession } from "@/server/session";
import { adminAuth } from "@/server/admin";
import { db } from "@/server/db";
import { PersonForm, validatePerson, fieldErrors, parseInstruments, personIssues, roleIn, mcpIn } from "@/schema";
import { resetEmulators, makeUser, idToken, TEST_ARTIST } from "./helpers";

beforeEach(resetEmulators);
const bearer = (t: string) => `Bearer ${t}`;
type R = { status: number; json: unknown };
const ok = (r: R) => { assert.equal(r.status, 200, JSON.stringify(r.json)); return (r.json as { result: Record<string, string> }).result; };
const err = (r: R) => (r.json as { error: { message: string; issues?: { path: unknown; message: string }[] } }).error;

// ---------- shared schema ----------

test("parseInstruments splits, trims, drops blanks and repeats", () => {
  assert.deepEqual(parseInstruments(" violin, vocals ,, Violin\nguitar"), ["violin", "vocals", "guitar"]);
});

test("person rules: name, kind, instruments, email, role, AI access, each at its field", () => {
  assert.deepEqual(validatePerson({ name: " ", bandMember: false, team: false }).errors, { name: "Enter a name", kind: "Pick Band Member, Team, or both" });
  assert.deepEqual(validatePerson({ name: "A", bandMember: true, team: false, instruments: " , " }).errors, { instruments: "Add at least one instrument" });
  assert.deepEqual(validatePerson({ name: "A", bandMember: false, team: true, email: "nope", role: "" }).errors, { email: "Email address invalid", role: "Pick a role" });
  assert.deepEqual(validatePerson({ name: "A", bandMember: false, team: true, email: "a@b.co", role: "member", mcpAccess: true }).errors, { mcpAccess: "Only Admins can have AI access" });
  const good = validatePerson({ name: " Ann ", bandMember: true, team: true, instruments: "violin, vocals", email: " Ann@Example.COM ", role: "admin", mcpAccess: true });
  assert.deepEqual(good.values, { name: "Ann", bandMember: true, team: true, instruments: ["violin", "vocals"], email: "ann@example.com", role: "admin", mcpAccess: true });
  // band-only ignores email and role
  assert.equal(PersonForm.safeParse({ name: "B", bandMember: true, team: false, instruments: ["drums"], email: "junk" }).success, true);
  assert.deepEqual(personIssues({ name: "B", bandMember: true, team: false, instruments: ["drums"] }), []);
  assert.deepEqual(fieldErrors({ issues: [{ path: ["musician", "instruments"], message: "x" }, { path: [], message: "root" }] }), { instruments: "x", kind: "root" });
});

// ---------- add ----------

test("add band-only, team-only, and both; emails are normalized", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const t = admin.token;
  const band = ok(await dispatch("musicians.create", bearer(t), { name: " Sam ", instruments: [" drums ", ""], email: " Sam@Example.com " }));
  const sam = (await db.get("musicians", band.id))!;
  assert.deepEqual([sam.name, sam.instruments, sam.email, sam.active, sam.archivedAt ?? null], ["Sam", ["drums"], "sam@example.com", true, null]);
  assert.equal((await dispatch("musicians.create", bearer(t), { name: "S", instruments: [" "] })).status, 400);
  assert.deepEqual(err(await dispatch("musicians.create", bearer(t), { name: "S", instruments: ["x"], email: "bad" })).issues?.[0].message, "Email address invalid");

  const team = ok(await dispatch("users.add", bearer(t), { email: " Tia@Example.com ", name: "Tia", role: "member" }));
  const tia = (await db.get("users", team.id))!;
  assert.deepEqual([tia.email, tia.artists, tia.mcpAccess ?? null, tia.musicianId ?? null], ["tia@example.com", [{ artistId: TEST_ARTIST, role: "member" }], null, null]);

  const both = ok(await dispatch("users.add", bearer(t), { email: "bo@example.com", name: "Bo", role: "admin", mcpAccess: true, musician: { instruments: ["bass"] } }));
  assert.equal(mcpIn((await db.get("users", both.id))!, TEST_ARTIST), true);
  assert.equal((await db.get("musicians", both.musicianId))!.userId, both.id);

  // give Team access to the existing Band Member: linked both ways, email carried over when the musician had none
  const nomail = ok(await dispatch("musicians.create", bearer(t), { name: "Nem", instruments: ["keys"] }));
  const g = ok(await dispatch("users.add", bearer(t), { email: "nem@example.com", name: "Nem", role: "member", musicianId: nomail.id }));
  assert.equal((await db.get("musicians", nomail.id))!.userId, g.id);
  assert.equal((await db.get("musicians", nomail.id))!.email, "nem@example.com");
  assert.equal((await db.get("users", g.id))!.musicianId, nomail.id);

  // rules at the command boundary
  assert.deepEqual(err(await dispatch("users.add", bearer(t), { email: "x@example.com", name: "X", role: "member", mcpAccess: true })).issues?.[0].message, "Only Admins can have AI access");
  assert.deepEqual(err(await dispatch("users.add", bearer(t), { email: "nope", name: "X", role: "member" })).issues?.[0].message, "Email address invalid");
  assert.equal((await dispatch("users.add", bearer(t), { email: "y@example.com", name: "Y", role: "member", musician: { instruments: [] } })).status, 400);
  assert.equal((await dispatch("users.add", bearer(t), { email: "z@example.com", name: "", role: "member" })).status, 400);
});

test("sign-in matches a mixed-case, padded token email", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const s = await startSession(bearer(admin.token));
  assert.equal(s.email, "a@example.com");
});

// ---------- team role / AI ----------

test("admin to Standard clears AI access; Standard can't get it", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const other = ok(await dispatch("users.add", bearer(admin.token), { email: "o@example.com", name: "O", role: "admin", mcpAccess: true }));
  const bad = await dispatch("users.update", bearer(admin.token), { id: other.id, patch: { role: "member", mcpAccess: true } });
  assert.equal(bad.status, 400);
  assert.equal(err(bad).message, "Only Admins can have AI access");
  ok(await dispatch("users.update", bearer(admin.token), { id: other.id, patch: { role: "member" } }));
  const u = (await db.get("users", other.id))!;
  assert.deepEqual([roleIn(u, TEST_ARTIST), mcpIn(u, TEST_ARTIST)], ["member", false]);
  assert.equal((await dispatch("users.update", bearer(admin.token), { id: other.id, patch: { mcpAccess: true } })).status, 400);
  ok(await dispatch("users.update", bearer(admin.token), { id: other.id, patch: { role: "admin", mcpAccess: true } }));
  assert.equal(mcpIn((await db.get("users", other.id))!, TEST_ARTIST), true);
});

// ---------- remove team / remove from band / archive / restore ----------

test("remove Team access keeps the Band Member; access can be given again", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const t = admin.token;
  const p = ok(await dispatch("users.add", bearer(t), { email: "p@example.com", name: "Pat", role: "member", musician: { instruments: ["guitar"] } }));
  ok(await dispatch("users.remove", bearer(t), { id: p.id }));
  assert.equal((await db.get("users", p.id))!.deletedAt != null, true);
  const m = (await db.get("musicians", p.musicianId))!;
  assert.deepEqual([m.deletedAt ?? null, m.archivedAt ?? null, m.active, m.email, m.userId ?? null], [null, null, true, "p@example.com", null]);
  const again = ok(await dispatch("users.add", bearer(t), { email: "p@example.com", name: "Pat", role: "admin", musicianId: p.musicianId }));
  assert.equal(again.id, p.id);
  assert.equal(roleIn((await db.get("users", p.id))!, TEST_ARTIST), "admin");
});

test("remove from band keeps Team; archive removes both; restore brings back the band only", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const t = admin.token;
  const keep = ok(await dispatch("musicians.create", bearer(t), { name: "Keeper", instruments: ["drums"] }));
  const p = ok(await dispatch("users.add", bearer(t), { email: "p@example.com", name: "Pat", role: "member", musician: { instruments: ["guitar"] } }));
  void keep;

  ok(await dispatch("musicians.removeFromBand", bearer(t), { id: p.musicianId }));
  let m = (await db.get("musicians", p.musicianId))!;
  assert.deepEqual([!!m.archivedAt, m.active, m.userId, m.deletedAt ?? null], [true, false, p.id, null]);
  assert.equal(roleIn((await db.get("users", p.id))!, TEST_ARTIST), "member"); // still on the Team
  // adding Team-only Pat back to the band un-archives the same record with new instruments
  const back = ok(await dispatch("users.addToBand", bearer(t), { id: p.id, instruments: ["bass", "vocals"] }));
  assert.equal(back.musicianId, p.musicianId);
  m = (await db.get("musicians", p.musicianId))!;
  assert.deepEqual([m.archivedAt ?? null, m.active, m.instruments], [null, true, ["bass", "vocals"]]);
  assert.equal((await dispatch("users.addToBand", bearer(t), { id: p.id, instruments: ["x"] })).status, 409);

  ok(await dispatch("musicians.archive", bearer(t), { id: p.musicianId }));
  m = (await db.get("musicians", p.musicianId))!;
  assert.deepEqual([!!m.archivedAt, m.active, m.deletedAt ?? null], [true, false, null]);
  assert.equal((await db.get("users", p.id))!.deletedAt != null, true);
  assert.deepEqual((await adminAuth().getUser(p.id)).customClaims?.artists ?? {}, {});

  ok(await dispatch("musicians.restore", bearer(t), { id: p.musicianId }));
  m = (await db.get("musicians", p.musicianId))!;
  assert.deepEqual([m.archivedAt ?? null, m.active], [null, true]);
  assert.equal((await db.get("users", p.id))!.deletedAt != null, true); // no Team access back
  // archived people can't be given Team access until restored
  ok(await dispatch("musicians.archive", bearer(t), { id: p.musicianId }));
  assert.equal((await dispatch("users.add", bearer(t), { email: "p@example.com", name: "Pat", role: "member", musicianId: p.musicianId })).status, 409);
  // legacy musicians.remove archives (never soft-deletes)
  ok(await dispatch("musicians.restore", bearer(t), { id: p.musicianId }));
  ok(await dispatch("musicians.remove", bearer(t), { id: p.musicianId }));
  assert.deepEqual([!!(await db.get("musicians", p.musicianId))!.archivedAt, (await db.get("musicians", p.musicianId))!.deletedAt ?? null], [true, null]);
});

test("Team-only person gets a new linked Band Member record", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const p = ok(await dispatch("users.add", bearer(admin.token), { email: "t@example.com", name: "Tia", role: "member" }));
  const r = ok(await dispatch("users.addToBand", bearer(admin.token), { id: p.id, instruments: ["fiddle"] }));
  const m = (await db.get("musicians", r.musicianId))!;
  assert.deepEqual([m.name, m.email, m.userId, m.active], ["Tia", "t@example.com", p.id, true]);
  assert.equal((await db.get("users", p.id))!.musicianId, r.musicianId);
});

// ---------- guards ----------

test("self guards: can't demote or remove your own Team access", async () => {
  const a = await makeUser("a@example.com", "admin");
  await makeUser("b@example.com", "admin");
  const own = await dispatch("users.remove", bearer(a.token), { id: a.uid });
  assert.equal(own.status, 403);
  assert.equal(err(own).message, "You can't remove your own Team access");
  assert.equal(err(await dispatch("users.update", bearer(a.token), { id: a.uid, patch: { role: "member" } })).message, "You can't demote yourself");
});

test("last Band Member guard: remove from band and archive", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const only = ok(await dispatch("musicians.create", bearer(admin.token), { name: "Solo", instruments: ["x"] }));
  for (const cmd of ["musicians.removeFromBand", "musicians.archive", "musicians.remove"]) {
    const r = await dispatch(cmd, bearer(admin.token), { id: only.id });
    assert.equal(r.status, 409);
    assert.equal(err(r).message, "The band needs at least one Band Member");
  }
  assert.equal((await db.get("musicians", only.id))!.archivedAt ?? null, null);
  ok(await dispatch("musicians.create", bearer(admin.token), { name: "Two", instruments: ["y"] }));
  ok(await dispatch("musicians.archive", bearer(admin.token), { id: only.id }));
});

test("you can't archive yourself (it removes your own Team access)", async () => {
  const a = await makeUser("a@example.com", "admin");
  const self = ok(await dispatch("users.addToBand", bearer(a.token), { id: a.uid, instruments: ["voice"] }));
  ok(await dispatch("musicians.create", bearer(a.token), { name: "Other", instruments: ["y"] }));
  const r = await dispatch("musicians.archive", bearer(a.token), { id: self.musicianId });
  assert.equal(err(r).message, "You can't remove your own Team access");
  // but you can step out of the band and stay on the Team
  ok(await dispatch("musicians.removeFromBand", bearer(a.token), { id: self.musicianId }));
});

test("archived musicians stay readable (not soft-deleted) so past shows and pay keep their names", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const m = ok(await dispatch("musicians.create", bearer(admin.token), { name: "Gone", instruments: ["x"] }));
  ok(await dispatch("musicians.create", bearer(admin.token), { name: "Stay", instruments: ["y"] }));
  ok(await dispatch("musicians.archive", bearer(admin.token), { id: m.id }));
  const listed = await db.list("musicians");
  assert.ok(listed.some((x) => x.id === m.id && x.archivedAt && x.active === false));
  // new availability asks refuse archived people
  assert.equal((await dispatch("availability.ask", bearer(admin.token), { date: "2027-01-01", musicianIds: [m.id] })).status, 400);
});

// ---------- AI access is per band ----------

test("AI access is per band: demoting in A leaves B alone; MCP in B is denied without it; legacy flag falls back", async () => {
  const { authenticateToken } = await import("../../mcp/auth");
  const { hashToken } = await import("@/server/availability");
  const { importCtx } = await import("@/server/ctx");
  const key = async (userId: string, artistId: string) => {
    const token = `btk_${Math.random().toString(36).slice(2)}${Date.now()}`;
    await db.create(importCtx(), "mcpTokens", { userId, label: "k", artistId }, { id: hashToken(token) });
    return token;
  };
  const boss = await makeUser("boss@example.com", "admin", { artistId: "a" });
  const bossB = await makeUser("bossb@example.com", "admin", { artistId: "b" });
  // Pat: admin with AI in A, admin without AI in B
  const pat = await makeUser("pat@example.com", "admin", { artists: [{ artistId: "a", role: "admin" }, { artistId: "b", role: "admin" }] });
  assert.equal(ok(await dispatch("users.update", bearer(boss.token), { id: pat.uid, patch: { mcpAccess: true } }, "a")).id, pat.uid);
  let u = (await db.get("users", pat.uid))!;
  assert.deepEqual([mcpIn(u, "a"), mcpIn(u, "b")], [true, false]);
  assert.equal((await authenticateToken(await key(pat.uid, "a"))).artistId, "a");
  await assert.rejects(authenticateToken(await key(pat.uid, "b")), (e: { status: number }) => e.status === 403);
  // B turning it on does not touch A; A demoting Pat to Standard clears A only
  ok(await dispatch("users.update", bearer(bossB.token), { id: pat.uid, patch: { mcpAccess: true } }, "b"));
  ok(await dispatch("users.update", bearer(boss.token), { id: pat.uid, patch: { role: "member" } }, "a"));
  u = (await db.get("users", pat.uid))!;
  assert.deepEqual(u.artists, [{ artistId: "a", role: "member" }, { artistId: "b", role: "admin", mcpAccess: true }]);
  assert.deepEqual([mcpIn(u, "a"), mcpIn(u, "b")], [false, true]);
  assert.equal((await dispatch("users.update", bearer(boss.token), { id: pat.uid, patch: { mcpAccess: true } }, "a")).status, 400);
  await assert.rejects(authenticateToken(await key(pat.uid, "a")), (e: { status: number }) => e.status === 403);
  assert.equal((await authenticateToken(await key(pat.uid, "b"))).artistId, "b");

  // users.add of an existing login into another band sets the flag on the new membership only
  const joined = ok(await dispatch("users.add", bearer(boss.token), { email: "bossb@example.com", name: "BB", role: "admin", mcpAccess: true }, "a"));
  u = (await db.get("users", joined.id))!;
  assert.deepEqual([mcpIn(u, "a"), mcpIn(u, "b")], [true, false]);

  // legacy: old top-level flag counts for admin memberships without their own flag, never for members
  const old = { artists: [{ artistId: "a", role: "admin" }, { artistId: "b", role: "member" }, { artistId: "c", role: "admin", mcpAccess: false }, { artistId: "d", role: "ai" }], mcpAccess: true };
  assert.deepEqual(["a", "b", "c", "d", "zz"].map((x) => mcpIn(old, x)), [true, false, false, true, false]);
  assert.equal(mcpIn({ artists: [{ artistId: "a", role: "admin" }] }, "a"), false);
  const legacy = await makeUser("legacy@example.com", "admin", { artistId: "a" });
  await db.update(importCtx(), "users", legacy.uid, { mcpAccess: true });
  assert.equal((await authenticateToken(await key(legacy.uid, "a"))).artistId, "a");
});

test("migrate:mcp-per-band copies the old flag onto admin memberships and drops it; second run is a no-op", async () => {
  const { migrateMcpPerBand } = await import("../../scripts/migrate-mcp-per-band");
  const { firestore } = await import("@/server/admin");
  const fs = firestore();
  await fs.doc("users/u1").set({ email: "u1@example.com", name: "U", artists: [{ artistId: "a", role: "admin" }, { artistId: "b", role: "member" }], mcpAccess: true, deletedAt: null, schemaVersion: 1, rev: 1 });
  const dry = await migrateMcpPerBand(fs, { dryRun: true });
  assert.equal(dry.users.length, 1);
  assert.equal((await db.get("users", "u1"))!.mcpAccess, true);
  await migrateMcpPerBand(fs);
  const u = (await db.get("users", "u1"))!;
  assert.deepEqual(u.artists, [{ artistId: "a", role: "admin", mcpAccess: true }, { artistId: "b", role: "member" }]);
  assert.equal(u.mcpAccess ?? null, null);
  assert.equal((await migrateMcpPerBand(fs)).users.length, 0);
});
