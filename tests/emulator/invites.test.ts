import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "@/server/commands/dispatch";
import { authenticatePerson, startSession } from "@/server/session";
import { acceptInvite, declineInvite } from "@/server/commands/invites";
import { adminAuth } from "@/server/admin";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import type { Membership } from "@/schema";
import { resetEmulators, makeUser, makeArtist, SYS } from "./helpers";

// Tenancy plan Q2-A and D3 "Joining another artist": adding someone who's already in another artist writes an invite, and they
// join only when they accept it.

beforeEach(resetEmulators);
const bearer = (t: string) => `Bearer ${t}`;
type R = { status: number; json: unknown };
const ok = <T = Record<string, unknown>>(r: R) => { assert.equal(r.status, 200, JSON.stringify(r.json)); return (r.json as { result: T }).result; };

async function twoArtists() {
  await makeArtist("Alpha", "alpha", "A");
  await makeArtist("Beta", "beta", "B");
  const adminA = await makeUser("ann@a.example", "admin", { artistId: "A" });
  const bea = await makeUser("bea@b.example", "admin", { artistId: "B" });
  await db.update(SYS, "users", bea.uid, { driving: { home: { address: "12 Secret St", lat: 39.7, lng: -105 } } });
  return { adminA, bea };
}

test("adding a person who's in another artist makes an invite, not a membership; A sees only the invite", async () => {
  const { adminA, bea } = await twoArtists();
  const r = ok<{ id: string; invited?: boolean }>(await dispatch("users.add", bearer(adminA.token), { email: "bea@b.example", name: "Bea", role: "member", musician: { instruments: ["fiddle"] } }, "A"));
  assert.equal(r.invited, true);
  const u = (await db.get(SYS, "users", bea.uid))!;
  assert.deepEqual((u.artists as Membership[]).map((m) => m.artistId), ["B"]);
  assert.equal((await db.list(SYS, "musicians", (q) => q.where("artistId", "==", "A"))).length, 0, "no musician until they accept");
  const pending = ok<{ invites: { email: string }[] }>(await dispatch("invites.pending", bearer(adminA.token), {}, "A")).invites;
  assert.deepEqual(pending.map((i) => i.email), ["bea@b.example"]);
  // Not in A: not on A's People list, and A can't read or change her driving settings.
  const people = ok<{ people: { email: string }[] }>(await dispatch("people.list", bearer(adminA.token), {}, "A")).people;
  assert.ok(!people.some((p) => p.email === "bea@b.example"));
  assert.equal((await dispatch("expenses.estimateGas", bearer(adminA.token), { forId: bea.uid, to: { address: "Boulder", lat: 40, lng: -105 } }, "A")).status, 404);
  assert.equal((await dispatch("people.updateDriving", bearer(adminA.token), { userId: bea.uid, home: null }, "A")).status, 404);
  // A second invite for the same email is refused.
  assert.equal((await dispatch("users.add", bearer(adminA.token), { email: "bea@b.example", name: "Bea", role: "member" }, "A")).status, 409);
});

test("accepting makes the membership and a musician in A, deletes the invite, and updates the claims", async () => {
  const { adminA, bea } = await twoArtists();
  const inv = ok<{ id: string }>(await dispatch("users.add", bearer(adminA.token), { email: "bea@b.example", name: "Bea", role: "admin", musician: { instruments: ["fiddle"] } }, "A"));
  const s = await startSession(bearer(bea.token));
  assert.deepEqual((s as { invites: { id: string; artistName: string }[] }).invites.map((i) => [i.id, i.artistName]), [[inv.id, "Alpha"]]);
  const me = await authenticatePerson(bearer(bea.token));
  const out = await acceptInvite(me, inv.id);
  const u = (await db.get(SYS, "users", bea.uid))!;
  const a = (u.artists as Membership[]).find((m) => m.artistId === "A")!;
  assert.equal(a.role, "admin");
  assert.equal(a.musicianId, out.musicianId);
  const m = (await db.get(SYS, "musicians", out.musicianId!))!;
  assert.deepEqual([m.artistId, m.userId, m.instruments], ["A", bea.uid, ["fiddle"]]);
  assert.ok((await db.get(SYS, "invites", inv.id))!.deletedAt);
  const claims = (await adminAuth().getUser(bea.uid)).customClaims as { artists: Record<string, string>; musicians: Record<string, string> };
  assert.deepEqual(claims.artists, { A: "admin", B: "admin" });
  assert.equal(claims.musicians.A, out.musicianId);
  // History: the membership is the person's, the musician A's.
  const uh = await db.history(SYS, "users", bea.uid);
  assert.equal(uh[0].ownerUid, bea.uid);
  assert.equal((await db.history(SYS, "musicians", out.musicianId!))[0].artistId, "A");
  // She can now work in A.
  assert.equal((await dispatch("people.list", bearer(bea.token), {}, "A")).status, 200);
});

test("declining deletes the invite; only the invited email can answer it", async () => {
  const { adminA, bea } = await twoArtists();
  const other = await makeUser("cy@b.example", "member", { artistId: "B" });
  const inv = ok<{ id: string }>(await dispatch("users.add", bearer(adminA.token), { email: "bea@b.example", name: "Bea", role: "member" }, "A"));
  await assert.rejects(acceptInvite(await authenticatePerson(bearer(other.token)), inv.id), { code: "not_found" });
  await assert.rejects(declineInvite(await authenticatePerson(bearer(other.token)), inv.id), { code: "not_found" });
  await declineInvite(await authenticatePerson(bearer(bea.token)), inv.id);
  assert.ok((await db.get(SYS, "invites", inv.id))!.deletedAt);
  assert.deepEqual(((await db.get(SYS, "users", bea.uid))!.artists as Membership[]).map((m) => m.artistId), ["B"]);
  await assert.rejects(acceptInvite(await authenticatePerson(bearer(bea.token)), inv.id), { code: "not_found" });
});

test("an admin can withdraw an invite; another artist's admin can't", async () => {
  const { adminA, bea } = await twoArtists();
  const inv = ok<{ id: string }>(await dispatch("users.add", bearer(adminA.token), { email: "bea@b.example", name: "Bea", role: "member" }, "A"));
  assert.equal((await dispatch("invites.withdraw", bearer(bea.token), { id: inv.id }, "B")).status, 404);
  ok(await dispatch("invites.withdraw", bearer(adminA.token), { id: inv.id }, "A"));
  assert.deepEqual(((await startSession(bearer(bea.token))) as { invites: unknown[] }).invites, []);
});

test("someone who can't open any artist yet (an AI-only login) still sees their invite at sign-in", async () => {
  const { adminA } = await twoArtists();
  const ai = await makeUser("bot@b.example", "ai", { artistId: "B" });
  await assert.rejects(startSession(bearer(ai.token)), { code: "ai_only" });
  const inv = ok<{ id: string; invited?: boolean }>(await dispatch("users.add", bearer(adminA.token), { email: "bot@b.example", name: "Bot", role: "member" }, "A"));
  assert.equal(inv.invited, true);
  const s = await startSession(bearer(ai.token));
  assert.equal(s.status, "noBand");
  assert.deepEqual((s as { invites: { id: string }[] }).invites.map((i) => i.id), [inv.id]);
});

test("availability.answer and ctx.musicianId use the person's musician in the ctx's artist", async () => {
  await makeArtist("Alpha", "alpha", "A");
  await makeArtist("Beta", "beta", "B");
  const mA = (await db.create(importCtx("A"), "musicians", { name: "Pat A", instruments: ["bass"], active: true })).id;
  const mB = (await db.create(importCtx("B"), "musicians", { name: "Pat B", instruments: ["keys"], active: true })).id;
  const pat = await makeUser("pat@x.example", "admin", { artists: [{ artistId: "A", role: "admin", musicianId: mA }, { artistId: "B", role: "member", musicianId: mB }] });
  const avA = (await db.create(importCtx("A"), "availability", { date: "2027-06-01", label: "A gig", askedMusicianIds: [mA], responses: {}, linkTokens: {} })).id;
  const avB = (await db.create(importCtx("B"), "availability", { date: "2027-06-01", label: "B gig", askedMusicianIds: [mB], responses: {}, linkTokens: {} })).id;
  ok(await dispatch("availability.answer", bearer(pat.token), { id: avA, answer: "yes" }, "A"));
  ok(await dispatch("availability.answer", bearer(pat.token), { id: avB, answer: "no" }, "B"));
  assert.deepEqual(Object.keys((await db.get(SYS, "availability", avA))!.responses), [mA]);
  assert.deepEqual(Object.keys((await db.get(SYS, "availability", avB))!.responses), [mB]);
  // A's ask through B's ctx: not found.
  assert.equal((await dispatch("availability.answer", bearer(pat.token), { id: avA, answer: "no" }, "B")).status, 404);
});
