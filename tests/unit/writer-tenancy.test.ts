import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp, type DocumentData } from "firebase-admin/firestore";
import { Writer, visibleTo } from "@/server/db";
import { fakeTx, logical } from "./fake-tx";
import { importCtx, personCtx, systemCtx, type AnyCtx } from "@/server/ctx";

// Tenancy plan D3, phase 4: the Writer refuses other artists. A's ctx can't read, overwrite, change or move B's records; id-keyed
// creates never replace B's doc; undo never moves a record. Runs on a fake transaction: no emulator needed.

const A = importCtx("A", "ua", "run-a");
const t0 = Timestamp.fromMillis(1_700_000_000_000);
const stamp = (id: string, artistId: string | undefined, extra: DocumentData = {}) => ({ id, ...(artistId ? { artistId } : {}), createdAt: t0, updatedAt: t0, createdBy: "ub", updatedBy: "ub", via: "app", runId: "r", rev: 1, deletedAt: null, schemaVersion: 1, ...extra });
async function write(ctx: AnyCtx, seed: Record<string, DocumentData>, fn: (w: Writer<AnyCtx>) => Promise<unknown>) {
  const { tx, writes: w0, store: s0 } = fakeTx(seed, { clone: true });
  const w = new Writer<AnyCtx>(tx, ctx);
  const out = await fn(w);
  w.flush();
  return { writes: logical(w0), store: logical(s0), out };
}

/** B's record of each id-keyed kind: its path and id, and a valid input A might send with that id. */
const KEYED: { path: string; id: string; input: DocumentData }[] = [
  { path: "showDeals", id: "showB", input: { deal: "flat", contactIds: [] } },
  { path: "setlists", id: "showB", input: { items: [] } },
  { path: "venueNotes", id: "B__v1", input: { venueId: "v1", contactIds: [], promoterIds: [] } },
  { path: "actNotes", id: "B__a1", input: { actId: "a1" } },
  { path: "festivalNotes", id: "B__f1", input: { festivalId: "f1" } },
  { path: "editionNotes", id: "B__e1", input: { editionId: "e1" } },
  { path: "promoterNotes", id: "B__p1", input: { promoterId: "p1" } },
  { path: "contactNotes", id: "B__c1", input: { contactId: "c1" } },
  { path: "venueEventNotes", id: "B__ev1", input: { venueId: "v1", eventId: "ev1" } },
  { path: "socialChecklists", id: "B", input: {} },
  { path: "mcpTokens", id: "hashB", input: { userId: "ua", label: "Claude" } },
  { path: "statSnapshots", id: "B_spotifyApi_2027-01-01", input: { source: "spotifyApi", date: "2027-01-01", followers: 1 } },
];

test("for each id-keyed kind, creating with B's id as A is not_found and leaves B's doc unchanged", async () => {
  for (const k of KEYED) {
    const seed = { [`${k.path}/${k.id}`]: stamp(k.id, "B", { secret: "B's" }), "shows/showB": stamp("showB", "B") };
    const { tx, store: s0 } = fakeTx(seed, { clone: true });
    const w = new Writer(tx, A);
    await assert.rejects(w.create(k.path, k.input, { id: k.id }), { code: "not_found" }, k.path);
    w.flush();
    assert.equal(logical(s0).get(`${k.path}/${k.id}`)?.secret, "B's", k.path);
  }
});

test("A reads B's record as null; a record with no artistId reads as null too (fail closed)", async () => {
  const { out } = await write(A, { "songs/s1": stamp("s1", "B"), "songs/s2": stamp("s2", undefined), "songs/s3": stamp("s3", "A") }, async (w) =>
    Promise.all([w.get("songs", "s1"), w.get("songs", "s2"), w.get("songs", "s3")]));
  assert.deepEqual((out as (DocumentData | null)[]).map((d) => d?.id ?? null), [null, null, "s3"]);
});

test("update, merge, softDelete and restore of B's id are not_found", async () => {
  const seed = { "songs/s1": stamp("s1", "B", { title: "B song", status: "active" }), "contacts/c1": stamp("c1", "B", { name: "Rosa", emails: [], phones: [], deletedAt: t0 }) };
  await assert.rejects(write(A, seed, (w) => w.update("songs", "s1", { title: "Mine now" })), { code: "not_found" });
  await assert.rejects(write(A, seed, (w) => w.merge("songs", "s1", { key: "E" })), { code: "not_found" });
  await assert.rejects(write(A, seed, (w) => w.softDelete("songs", "s1")), { code: "not_found" });
  await assert.rejects(write(A, seed, (w) => w.restore("contacts", "c1")), { code: "not_found" });
  await assert.rejects(write(A, seed, (w) => w.revert("songs", "s1", "update", { title: { before: "x", after: "B song" } })), { code: "not_found" });
});

test("a patch that moves a record to another artist is refused", async () => {
  const seed = { "songs/s1": stamp("s1", "A", { title: "Mine", status: "active" }) };
  await assert.rejects(write(A, seed, (w) => w.update("songs", "s1", { artistId: "B" })), { code: "invalid_input" });
});

test("undoing a create archives it and keeps its artistId; an undo never moves a record", async () => {
  const seed = { "songs/s1": stamp("s1", "A", { title: "Mine", status: "active" }) };
  const { writes } = await write(A, seed, (w) => w.revert("songs", "s1", "create", {}));
  assert.ok(writes.get("songs/s1")?.deletedAt);
  assert.equal(writes.get("songs/s1")?.artistId, "A");
  const moved = await write(A, seed, (w) => w.revert("songs", "s1", "update", { artistId: { before: "B", after: "A" }, title: { before: "Old", after: "Mine" } }));
  assert.equal(moved.writes.get("songs/s1")?.artistId, "A");
  assert.equal(moved.writes.get("songs/s1")?.title, "Old");
});

test("the artist's own doc: only its own id", async () => {
  const seed = { "artists/A": stamp("A", undefined, { name: "A", slug: "a" }), "artists/B": stamp("B", undefined, { name: "B", slug: "b" }) };
  const { out } = await write(A, seed, async (w) => [await w.get("artists", "A"), await w.get("artists", "B")]);
  assert.deepEqual((out as (DocumentData | null)[]).map((d) => d?.id ?? null), ["A", null]);
  await assert.rejects(write(A, {}, (w) => w.create("artists", { name: "C", slug: "c", configurations: [], links: {}, driveFolderId: "" }, { id: "C" })), { code: "not_found" });
});

test("a person with no artist reads no artist's records and can't create one directly", async () => {
  const p = personCtx("ua", "ann@example.com");
  const { out } = await write(p, { "songs/s1": stamp("s1", "A"), "users/ua": stamp("ua", undefined, { name: "Ann" }) }, async (w) => [await w.get("songs", "s1"), await w.get("users", "ua")]);
  assert.deepEqual((out as (DocumentData | null)[]).map((d) => d?.id ?? null), [null, "ua"]);
  await assert.rejects(write(p, {}, (w) => w.create("songs", { title: "x", status: "active" })), { code: "not_found" });
});

test("system(): reads are unscoped inside, scoped again after", async () => {
  const { out } = await write(A, { "songs/s1": stamp("s1", "B") }, async (w) => [(await w.system(() => w.get("songs", "s1")))?.id ?? null, (await w.get("songs", "s1"))?.id ?? null]);
  assert.deepEqual(out, ["s1", null]);
});

test("visibleTo: history entries of another artist are hidden; shared and person entries aren't", () => {
  assert.equal(visibleTo(A, "songs/s1/history", "000001", { artistId: "B" }), false);
  assert.equal(visibleTo(A, "songs/s1/history", "000001", { artistId: "A" }), true);
  assert.equal(visibleTo(A, "venues/v1/history", "000001", { artistId: null, shared: true }), true);
  assert.equal(visibleTo(systemCtx("t"), "songs/s1", "s1", { artistId: "B" }), true);
});
