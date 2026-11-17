import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, run } from "@/server/db";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { registry } from "@/server/commands/registry";
import { undoRun } from "@/server/undo";
import { resetEmulators, makeUser, venue, TEST_ARTIST, approveTestEditors, SYS } from "./helpers";

// The people (and AI logins) editing shared venues here are approved shared editors, as on prod.
beforeEach(async () => { await resetEmulators(); await approveTestEditors("ai-user", "ai", "me", "them", "rudy"); });
const as = (uid: string, via: Ctx["via"] = "mcp", runId = newRunId()): Ctx => ({ uid, artistId: TEST_ARTIST, role: via === "mcp" ? "mcp" : "admin", via, runId });
const hist = (runId: string) => db.listGroup(SYS, "history", (q) => q.where("runId", "==", runId));

test("undo of a mixed run restores state; reversals are history under a new run; immutable docs are reported", async () => {
  const setup = importCtx(TEST_ARTIST, "setup", "setup-run");
  const keep = await db.create(setup, "venues", venue("Keep Me", "Denver", { capacity: 100, instagram: "original" }));
  const gone = await db.create(setup, "venues", venue("Delete Me"));
  const people = await db.create(setup, "contacts", { artistId: TEST_ARTIST, name: "Pat Booker", emails: ["pat@example.com"], phones: [] });
  const pitch = await db.create(setup, "pitches", { target: { kind: "venue", id: keep.id, name: "Keep Me" }, status: "toPitch", artistId: TEST_ARTIST, personnel: [], showIds: [] });
  const beforeKeep = (await db.get(SYS, "venues", keep.id))!;

  const ctx = as("ai-user");
  // one run: create, merge-update, update + clear a field, delete, atomic multi-doc unit, append-only activity, an immutable stat snapshot
  const created = await db.create(ctx, "venues", venue("Brand New"));
  await db.update(ctx, "venues", keep.id, { capacity: 999, instagram: null, website: "https://x.example" });
  await db.update(ctx, "venues", keep.id, { capacity: 1234 });
  await db.softDelete(ctx, "venues", gone.id);
  await run(ctx, async (w) => {
    await w.update("pitches", pitch.id, { status: "pitched" });
    await w.create(`pitches/${pitch.id}/activity`, { type: "status", fromStatus: "toPitch", toStatus: "pitched" });
    await w.update("contacts", people.id, { title: "Booker" });
  });
  await db.create(ctx, "statSnapshots", { source: "spotifyApi", date: "2026-10-01", followers: 10, popularity: 1 });
  assert.equal((await db.list(SYS, "statSnapshots")).length, 1);

  // shared venues in the run can only be undone by whoever made it, so the same person undoes it from the app
  const admin = as("ai-user", "app");
  const report = await undoRun(admin, ctx.runId);

  // state is back
  const k = (await db.get(SYS, "venues", keep.id))!;
  assert.equal(k.capacity, 100);
  assert.equal(k.instagram, "original");
  assert.equal("website" in k, false);
  assert.equal(k.deletedAt, null);
  assert.equal((await db.get(SYS, "venues", gone.id))!.deletedAt, null, "delete was restored");
  assert.ok((await db.get(SYS, "venues", created.id))!.deletedAt, "created doc is soft-deleted");
  assert.equal((await db.get(SYS, "pitches", pitch.id))!.status, "toPitch");
  assert.equal((await db.get(SYS, "contacts", people.id))!.title, undefined);
  assert.equal((await db.list(SYS, `pitches/${pitch.id}/activity`)).length, 0, "created activity is archived");
  assert.equal(k.matchKey, beforeKeep.matchKey);

  // the snapshot is untouched and reported
  assert.equal((await db.list(SYS, "statSnapshots")).length, 1);
  assert.equal(report.needsManualCorrection.length, 1);
  assert.equal(report.needsManualCorrection[0].kind, "statSnapshots");
  assert.equal(report.failed.length, 0);
  assert.ok(report.reverted.length === 7);

  // reversals are themselves history, under a new run id, attributed to the undoer
  assert.notEqual(report.undoRunId, ctx.runId);
  const rev = await hist(report.undoRunId);
  assert.ok(rev.length === 7);
  assert.ok(rev.every((h) => h.actor.uid === "ai-user" && h.actor.via === "app"));
  assert.ok(rev.some((h) => h.op === "delete" && h.entity.id === created.id));
  assert.ok(rev.some((h) => h.op === "restore" && h.entity.id === gone.id));
  // the original run is still in history
  assert.ok((await hist(ctx.runId)).length === 8);

  // redo = undo the undo
  await undoRun(admin, report.undoRunId);
  const again = (await db.get(SYS, "venues", keep.id))!;
  assert.equal(again.capacity, 1234);
  assert.equal(again.website, "https://x.example");
  assert.equal((await db.get(SYS, "venues", gone.id))!.deletedAt !== null, true);
  assert.equal((await db.get(SYS, "venues", created.id))!.deletedAt, null);
});

test("undo refreshes denormalized copies and survives later edits to the same record", async () => {
  const setup = importCtx(TEST_ARTIST, "setup", "s");
  const v = await db.create(setup, "venues", venue("Old Name"));
  const p = await db.create(setup, "pitches", { target: { kind: "venue", id: v.id, name: "Old Name" }, status: "toPitch", artistId: TEST_ARTIST, personnel: [], showIds: [] });
  const ctx = as("ai");
  await db.update(ctx, "venues", v.id, { name: "New Name" });
  assert.equal((await db.get(SYS, "pitches", p.id))!.target.name, "New Name");
  await db.update(SYS, "venues", v.id, { capacity: 50 }); // someone else edits another field later
  await undoRun(as("ai", "app"), ctx.runId);
  const after = (await db.get(SYS, "venues", v.id))!;
  assert.equal(after.name, "Old Name");
  assert.equal(after.capacity, 50, "unrelated later edits survive");
  assert.equal((await db.get(SYS, "pitches", p.id))!.target.name, "Old Name");
});

test("MCP users undo only their own runs; unknown runs are not found", async () => {
  const mine = as("me"), theirs = as("them"), theirsPat = as("them");
  await db.create(mine, "venues", venue("Mine"));
  await db.create(theirs, "venues", venue("Theirs"));
  const pat = await db.create(theirsPat, "contacts", { name: "Pat", emails: [], phones: [] });
  const mcp = as("me");
  // another person's run on an artist record is forbidden to an AI login...
  await assert.rejects(registry["history.undoRun"].run(mcp, { runId: theirsPat.runId }), (e: any) => e.code === "forbidden");
  // ...and one that touched a shared venue is not found at all (tenancy phase 4: a person's shared edits are theirs alone to undo)
  await assert.rejects(registry["history.undoRun"].run(mcp, { runId: theirs.runId }), (e: any) => e.code === "not_found");
  await assert.rejects(registry["history.undoRun"].run(mcp, { runId: "nothing" }), (e: any) => e.code === "not_found");
  const ok = (await registry["history.undoRun"].run(mcp, { runId: mine.runId })) as any;
  assert.equal(ok.reverted.length, 1);
  const venues = await db.list(SYS, "venues");
  assert.deepEqual(venues.map((v) => v.name), ["Theirs"]);
  // an admin of the artist can undo anyone's run on the artist's own records, but not another person's shared edits
  const admin = { ...as("rudy", "app"), role: "admin" as const };
  await assert.rejects(registry["history.undoRun"].run(admin, { runId: theirs.runId }), (e: any) => e.code === "not_found");
  await registry["history.undoRun"].run(admin, { runId: theirsPat.runId });
  assert.ok((await db.get(SYS, "contacts", pat.id))!.deletedAt);
  assert.equal((await db.list(SYS, "venues")).length, 1);
  void makeUser;
});
