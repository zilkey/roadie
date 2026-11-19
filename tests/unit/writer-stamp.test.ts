import { test } from "node:test";
import assert from "node:assert/strict";
import type { DocumentData } from "firebase-admin/firestore";
import { Writer } from "@/server/db";
import { fakeTx, logical } from "./fake-tx";
import { importCtx, systemCtx, type AnyCtx, type Ctx } from "@/server/ctx";

// Tenancy phases 2 and 4: the Writer stamps every new artist record with its artist (before validation), refuses one that names
// another artist, and gives every history entry one scope. Runs on a fake transaction: no emulator needed.

const ctxFor = (artistId: string): Ctx => ({ ...importCtx(artistId, "u1", "run-1"), via: "app", role: "admin" });
async function write(ctx: AnyCtx, seed: Record<string, DocumentData>, fn: (w: Writer<AnyCtx>) => Promise<unknown>) {
  const { tx, writes: w0 } = fakeTx(seed);
  const w = new Writer<AnyCtx>(tx, ctx);
  await fn(w);
  w.flush();
  return logical(w0);
}
const history = (writes: Map<string, DocumentData>, docPath: string) => [...writes].find(([p]) => p.startsWith(`${docPath}/history/`))?.[1];

test("a new artist record takes the caller's artist; its history entry is scoped to it", async () => {
  let id = "";
  const writes = await write(ctxFor("A"), {}, async (w) => { id = (await w.create("songs", { title: "Lighthouse", status: "active" })).id; });
  assert.equal(writes.get(`songs/${id}`)?.artistId, "A");
  assert.equal(history(writes, `songs/${id}`)?.artistId, "A");
});

test("input that names another artist is refused (not_found)", async () => {
  await assert.rejects(write(ctxFor("A"), {}, (w) => w.create("songs", { artistId: "B", title: "Lighthouse", status: "active" })), { code: "not_found" });
});

test("forArtist: a new artist's records go into it, in the same write unit", async () => {
  let id = "";
  const writes = await write(ctxFor("A"), {}, async (w) => { id = (await w.forArtist("B").create("songs", { title: "Lighthouse", status: "active" })).id; });
  assert.equal(writes.get(`songs/${id}`)?.artistId, "B");
});

test("a sub-collection doc takes its parent's artist", async () => {
  let id = "";
  const writes = await write(ctxFor("B"), { "shows/s1": { id: "s1", artistId: "B" } }, async (w) => {
    id = (await w.create("shows/s1/comments", { authorId: "u1", body: "Load in at 6" })).id;
  });
  assert.equal(writes.get(`shows/s1/comments/${id}`)?.artistId, "B");
  assert.equal(history(writes, `shows/s1/comments/${id}`)?.artistId, "B");
});

test("a show-keyed kind (showDeals) takes its show's artist", async () => {
  const writes = await write(ctxFor("B"), { "shows/s1": { id: "s1", artistId: "B" } }, async (w) => { await w.create("showDeals", { deal: "flat", contactIds: [] }, { id: "s1" }); });
  assert.equal(writes.get("showDeals/s1")?.artistId, "B");
});

test("a foreign or missing parent is refused (not_found)", async () => {
  const seed = { "shows/s1": { id: "s1", artistId: "B" } };
  await assert.rejects(write(ctxFor("A"), seed, (w) => w.create("shows/s1/comments", { authorId: "u1", body: "hi" })), { code: "not_found" });
  await assert.rejects(write(ctxFor("A"), seed, (w) => w.create("showDeals", { deal: "flat", contactIds: [] }, { id: "s1" })), { code: "not_found" });
  await assert.rejects(write(ctxFor("A"), {}, (w) => w.create("shows/nope/comments", { authorId: "u1", body: "hi" })), { code: "not_found" });
});

test("stamped before validation: a contact needs its artistId and builds its dedupe key from it", async () => {
  const one = await write(ctxFor("A"), {}, (w) => w.create("contacts", { name: "Rosa Jackson", emails: ["rosa@example.com"], phones: [] }));
  const two = await write(ctxFor("B"), {}, (w) => w.create("contacts", { name: "Rosa Jackson", emails: ["rosa@example.com"], phones: [] }));
  const a = [...one].find(([p]) => /^contacts\/[^/]+$/.test(p))![1], b = [...two].find(([p]) => /^contacts\/[^/]+$/.test(p))![1];
  assert.equal(a.artistId, "A");
  assert.equal(b.artistId, "B");
  // The same email in two artists is two contacts: their keys differ.
  assert.equal(a.matchKey, "A:rosa@example.com");
  assert.equal(b.matchKey, "B:rosa@example.com");
});

test("no artist anywhere (a system write naming none): stamping throws, nothing is written", async () => {
  let writes: Map<string, DocumentData> | undefined;
  await assert.rejects(async () => { writes = await write(systemCtx("test"), {}, (w) => w.create("songs", { title: "Lighthouse", status: "active" })); }, { code: "artist_required" });
  assert.equal(writes, undefined);
});

test("shared and person records aren't stamped; their history entries say shared / ownerUid with artistId null", async () => {
  {
    let vid = "";
    const writes = await write(ctxFor("A"), {}, async (w) => {
      vid = (await w.create("venues", { name: "Deep End", type: "bar", address: { city: "Denver", state: "CO" }, region: "denver" })).id;
      await w.create("users", { email: "ann@example.com", name: "Ann", artists: [{ artistId: "A", role: "admin" }] }, { id: "ann" });
    });
    assert.equal(writes.get(`venues/${vid}`)?.artistId, undefined);
    const vh = history(writes, `venues/${vid}`)!;
    assert.equal(vh.artistId, null);
    assert.equal(vh.shared, true);
    const uh = history(writes, "users/ann")!;
    assert.equal(uh.artistId, null);
    assert.equal(uh.ownerUid, "ann");
    assert.equal(uh.shared, undefined);
  }
});

test("users: artistIds is computed from the memberships; a membership's musician must be in its artist and free", async () => {
  const seed = { "musicians/m1": { id: "m1", artistId: "B", name: "Ann", instruments: [], active: true }, "musicians/m2": { id: "m2", artistId: "B", name: "Bo", instruments: [], active: true, userId: "bo" } };
  const writes = await write(ctxFor("A"), seed, async (w) => {
    await w.create("users", { email: "ann@example.com", name: "Ann", artists: [{ artistId: "A", role: "admin" }, { artistId: "B", role: "member", musicianId: "m1" }] }, { id: "ann" });
  });
  const u = writes.get("users/ann")!;
  assert.deepEqual(u.artistIds, ["A", "B"]);
  assert.deepEqual(u.artists, [{ artistId: "A", role: "admin" }, { artistId: "B", role: "member", musicianId: "m1" }]);
  // m1 is B's, not A's; m2 is someone else's.
  await assert.rejects(write(ctxFor("A"), seed, (w) => w.create("users", { email: "c@example.com", name: "C", artists: [{ artistId: "A", role: "member", musicianId: "m1" }] }, { id: "c" })), { code: "not_found" });
  await assert.rejects(write(ctxFor("A"), seed, (w) => w.create("users", { email: "c@example.com", name: "C", artists: [{ artistId: "B", role: "member", musicianId: "m2" }] }, { id: "c" })), { code: "conflict" });
});

test("phase 7: users.musicianId is gone; a stored one (before the drop script) is stripped on the next write", async () => {
  const seed = { "users/ann": { id: "ann", email: "ann@example.com", name: "Ann", artists: [{ artistId: "A", role: "admin", musicianId: "m1" }], artistIds: ["A"], musicianId: "m1", rev: 1, deletedAt: null } };
  const writes = await write(ctxFor("A"), seed, (w) => w.update("users", "ann", { name: "Ann B" }));
  const after = writes.get("users/ann")!;
  assert.equal(after.name, "Ann B");
  assert.equal("musicianId" in after, false);
  assert.deepEqual(after.artists, [{ artistId: "A", role: "admin", musicianId: "m1" }]);
});
