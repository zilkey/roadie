import { test } from "node:test";
import assert from "node:assert/strict";
import { DocumentReference, type DocumentData, type Transaction } from "firebase-admin/firestore";
import { Writer } from "@/server/db";
import { importCtx, type Ctx } from "@/server/ctx";
import { tenancyLog, type Unstamped } from "@/server/tenancy";

// Tenancy phase 2: the Writer stamps every new artist record with its artist (before validation), and every history entry
// with one scope. Runs on a fake transaction: no emulator needed.

function fakeTx(seed: Record<string, DocumentData> = {}) {
  const store = new Map<string, DocumentData>(Object.entries(seed));
  const writes = new Map<string, DocumentData>();
  const tx = {
    async get(ref: unknown) {
      if (ref instanceof DocumentReference) {
        const d = store.get(ref.path);
        return { exists: !!d, data: () => d };
      }
      return { docs: [] }; // queries (dedupe) find nothing
    },
    set(ref: DocumentReference, data: DocumentData) { writes.set(ref.path, data); store.set(ref.path, data); },
    delete(ref: DocumentReference) { writes.delete(ref.path); store.delete(ref.path); },
  };
  return { tx: tx as unknown as Transaction, writes };
}
const ctxFor = (artistId?: string): Ctx => ({ ...importCtx("u1", "run-1", artistId), via: "app", role: "admin" });
async function write(ctx: Ctx, seed: Record<string, DocumentData>, fn: (w: Writer) => Promise<unknown>) {
  const { tx, writes } = fakeTx(seed);
  const w = new Writer(tx, ctx);
  await fn(w);
  w.flush();
  return writes;
}
const history = (writes: Map<string, DocumentData>, docPath: string) => [...writes].find(([p]) => p.startsWith(`${docPath}/history/`))?.[1];
function captureUnstamped() {
  const seen: Unstamped[] = [];
  const orig = tenancyLog.unstamped;
  tenancyLog.unstamped = (e) => { seen.push(e); };
  return { seen, restore: () => { tenancyLog.unstamped = orig; } };
}

test("a new artist record takes the caller's artist; its history entry is scoped to it", async () => {
  let id = "";
  const writes = await write(ctxFor("A"), {}, async (w) => { id = (await w.create("songs", { title: "Lighthouse", status: "active" })).id; });
  assert.equal(writes.get(`songs/${id}`)?.artistId, "A");
  assert.equal(history(writes, `songs/${id}`)?.artistId, "A");
});

test("the artist named in the input wins (a new artist's templates are seeded from inside another one)", async () => {
  let id = "";
  const writes = await write(ctxFor("A"), {}, async (w) => { id = (await w.create("songs", { artistId: "B", title: "Lighthouse", status: "active" })).id; });
  assert.equal(writes.get(`songs/${id}`)?.artistId, "B");
});

test("a sub-collection doc takes its parent's artist", async () => {
  let id = "";
  const writes = await write(ctxFor(), { "shows/s1": { id: "s1", artistId: "B" } }, async (w) => {
    id = (await w.create("shows/s1/comments", { authorId: "u1", body: "Load in at 6" })).id;
  });
  assert.equal(writes.get(`shows/s1/comments/${id}`)?.artistId, "B");
  assert.equal(history(writes, `shows/s1/comments/${id}`)?.artistId, "B");
});

test("a show-keyed kind (showDeals) takes its show's artist", async () => {
  const writes = await write(ctxFor(), { "shows/s1": { id: "s1", artistId: "B" } }, async (w) => { await w.create("showDeals", { deal: "flat", contactIds: [] }, { id: "s1" }); });
  assert.equal(writes.get("showDeals/s1")?.artistId, "B");
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

test("no artist anywhere: the write still goes ahead, and tenancy.unstamped is logged", async () => {
  const log = captureUnstamped();
  try {
    let id = "";
    const writes = await write(ctxFor(), {}, async (w) => { id = (await w.create("songs", { title: "Lighthouse", status: "active" })).id; });
    assert.ok(writes.get(`songs/${id}`));
    assert.equal(writes.get(`songs/${id}`)?.artistId, undefined);
    assert.deepEqual(log.seen, [{ kind: "songs", id, via: "app", uid: "u1" }]);
  } finally { log.restore(); }
});

test("shared and person records aren't stamped; their history entries say shared / ownerUid with artistId null", async () => {
  const log = captureUnstamped();
  try {
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
    assert.deepEqual(log.seen, []);
  } finally { log.restore(); }
});

test("users: artistIds is computed from the memberships, and the linked musician lands on its artist's membership", async () => {
  const writes = await write(ctxFor("A"), { "musicians/m1": { id: "m1", artistId: "B", name: "Ann", instruments: [], active: true } }, async (w) => {
    await w.create("users", { email: "ann@example.com", name: "Ann", artists: [{ artistId: "A", role: "admin" }, { artistId: "B", role: "member" }], musicianId: "m1" }, { id: "ann" });
  });
  const u = writes.get("users/ann")!;
  assert.deepEqual(u.artistIds, ["A", "B"]);
  assert.deepEqual(u.artists, [{ artistId: "A", role: "admin" }, { artistId: "B", role: "member", musicianId: "m1" }]);
});
