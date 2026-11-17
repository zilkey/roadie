import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execute } from "@/server/commands/dispatch";
import { artistCtx, newRunId, type Ctx } from "@/server/ctx";
import { db } from "@/server/db";
import { undoRun } from "@/server/undo";
import { resetEmulators, makeUser, makeArtist, venue, approveTestEditors, SYS } from "./helpers";

// Tenancy plan D3: undo, `_meta.runId` and retries never reach another artist.

beforeEach(resetEmulators);
const ctxOf = (uid: string, artistId: string, runId = newRunId()): Ctx => artistCtx({ uid, role: "admin", artistId, via: "app", runId });
async function two() {
  await makeArtist("Alpha", "alpha", "A");
  await makeArtist("Beta", "beta", "B");
  const a = await makeUser("a@x.example", "admin", { artistId: "A" });
  const b = await makeUser("b@x.example", "admin", { artistId: "B" });
  return { a, b };
}

test("A can't undo B's run, and B's records stay as they are", async () => {
  const { a, b } = await two();
  const bCtx = ctxOf(b.uid, "B");
  const song = (await execute(bCtx, "songs.create", { title: "B's song", status: "active" })).result as { id: string };
  await assert.rejects(undoRun(ctxOf(a.uid, "A"), bCtx.runId), { code: "not_found" });
  await assert.rejects(execute(ctxOf(a.uid, "A"), "history.undoRun", { runId: bCtx.runId }), { code: "not_found" });
  assert.equal((await db.get(SYS, "songs", song.id))!.deletedAt, null);
  // B can.
  await undoRun(ctxOf(b.uid, "B"), bCtx.runId);
  assert.ok((await db.get(SYS, "songs", song.id))!.deletedAt);
});

test("A can't join B's run; a fresh run id, or the caller's own run, is fine", async () => {
  const { a, b } = await two();
  const bCtx = ctxOf(b.uid, "B");
  await execute(bCtx, "songs.create", { title: "B's song", status: "active" });
  await assert.rejects(execute(ctxOf(a.uid, "A"), "songs.create", { title: "Mine", status: "active", _meta: { runId: bCtx.runId } }), { code: "forbidden" });
  const fresh = newRunId();
  await execute(ctxOf(a.uid, "A"), "songs.create", { title: "One", status: "active", _meta: { runId: fresh } });
  await execute(ctxOf(a.uid, "A"), "songs.create", { title: "Two", status: "active", _meta: { runId: fresh } });
  assert.equal((await db.listGroup(SYS, "history", (q) => q.where("runId", "==", fresh))).length, 2);
});

test("a venue rename that updated both artists' shows (derived entries) undoes cleanly", async () => {
  const { a, b } = await two();
  await approveTestEditors(a.uid);
  const v = (await execute(ctxOf(a.uid, "A"), "venues.create", venue("Deep End"))).result as { id: string };
  const showOf = async (uid: string, artistId: string) => ((await execute(ctxOf(uid, artistId), "shows.create", { date: "2027-05-01", status: "hold", venueId: v.id })).result as { id: string }).id;
  const sa = await showOf(a.uid, "A"), sb = await showOf(b.uid, "B");
  const rename = ctxOf(a.uid, "A");
  await execute(rename, "venues.update", { id: v.id, patch: { name: "The Deep End" } });
  assert.equal((await db.get(SYS, "shows", sb))!.venue.name, "The Deep End");
  const entries = await db.listGroup(SYS, "history", (q) => q.where("runId", "==", rename.runId));
  assert.ok(entries.some((e) => e.artistId === "B" && e.derived), `B's show change is a derived entry: ${JSON.stringify(entries.map((e) => [e.entity, e.artistId, e.derived ?? null]))}`);
  await undoRun(ctxOf(a.uid, "A"), rename.runId);
  assert.equal((await db.get(SYS, "venues", v.id))!.name, "Deep End");
  assert.equal((await db.get(SYS, "shows", sa))!.venue.name, "Deep End");
  assert.equal((await db.get(SYS, "shows", sb))!.venue.name, "Deep End", "the hook re-derived B's copy");
});

test("the same clientMutationId in two artists never returns the other artist's result", async () => {
  await makeArtist("Alpha", "alpha", "A");
  await makeArtist("Beta", "beta", "B");
  const p = await makeUser("p@x.example", "admin", { artists: [{ artistId: "A", role: "admin" }, { artistId: "B", role: "admin" }] });
  const mid = "same-mutation-id-1";
  const first = await execute(ctxOf(p.uid, "A"), "songs.create", { title: "In A", status: "active", _meta: { clientMutationId: mid } });
  await assert.rejects(execute(ctxOf(p.uid, "B"), "songs.create", { title: "In B", status: "active", _meta: { clientMutationId: mid } }), { code: "mutation_id_in_use" });
  const again = await execute(ctxOf(p.uid, "A"), "songs.create", { title: "In A", status: "active", _meta: { clientMutationId: mid } });
  assert.deepEqual(again.result, first.result);
  assert.equal(again.repeated, true);
});

test("history.myRuns lists this artist's runs (and the caller's own shared edits), never another artist's", async () => {
  await makeArtist("Alpha", "alpha", "A");
  await makeArtist("Beta", "beta", "B");
  const p = await makeUser("p@x.example", "admin", { artists: [{ artistId: "A", role: "admin" }, { artistId: "B", role: "admin" }] });
  const inA = ctxOf(p.uid, "A"), inB = ctxOf(p.uid, "B");
  await execute(inA, "songs.create", { title: "A song", status: "active" });
  await execute(inB, "songs.create", { title: "B song", status: "active" });
  const runs = ((await execute(ctxOf(p.uid, "A"), "history.myRuns", {})).result as { runs: { runId: string }[] }).runs.map((r) => r.runId);
  assert.ok(runs.includes(inA.runId));
  assert.ok(!runs.includes(inB.runId));
});
