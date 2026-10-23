import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, run } from "@/server/db";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { registry } from "@/server/commands/registry";
import { undoRun } from "@/server/undo";
import { resetEmulators, makeUser, venue } from "./helpers";

beforeEach(resetEmulators);
const as = (uid: string, via: Ctx["via"] = "mcp", runId = newRunId()): Ctx => ({ uid, role: via === "mcp" ? "mcp" : "admin", via, runId });
const hist = (runId: string) => db.list("history", (q) => q.where("runId", "==", runId));

test("undo of a mixed run restores state; reversals are history under a new run; ledger is reported", async () => {
  const setup = importCtx("setup", "setup-run");
  const keep = await db.create(setup, "venues", venue("Keep Me", "Denver", { capacity: 100, notes: "original" }));
  const gone = await db.create(setup, "venues", venue("Delete Me"));
  const people = await db.create(setup, "contacts", { name: "Pat Booker", emails: ["pat@example.com"], phones: [] });
  const pitch = await db.create(setup, "pitches", { target: { kind: "venue", id: keep.id, name: "Keep Me" }, status: "toPitch", artistId: "a", personnel: [], showIds: [] });
  const beforeKeep = (await db.get("venues", keep.id))!;

  const ctx = as("ai-user");
  // one run: create, merge-update, update + clear a field, delete, atomic multi-doc unit, append-only activity, ledger entry
  const created = await db.create(ctx, "venues", venue("Brand New"));
  await db.update(ctx, "venues", keep.id, { capacity: 999, notes: null, website: "https://x.example" });
  await db.update(ctx, "venues", keep.id, { capacity: 1234 });
  await db.softDelete(ctx, "venues", gone.id);
  await run(ctx, async (w) => {
    await w.update("pitches", pitch.id, { status: "pitched" });
    await w.create(`pitches/${pitch.id}/activity`, { type: "status", fromStatus: "toPitch", toStatus: "pitched" });
    await w.update("contacts", people.id, { title: "Booker" });
  });
  await registry["ledger.record"].run(ctx, registry["ledger.record"].input.parse({ kind: "expense", amount: 1500, category: "gear", method: "card", date: "2026-10-01", memo: "strings" }));
  const ledgerBefore = await db.list("ledger");
  assert.equal(ledgerBefore.length, 1);

  const admin = as("jeff", "app");
  const report = await undoRun(admin, ctx.runId);

  // state is back
  const k = (await db.get("venues", keep.id))!;
  assert.equal(k.capacity, 100);
  assert.equal(k.notes, "original");
  assert.equal("website" in k, false);
  assert.equal(k.deletedAt, null);
  assert.equal((await db.get("venues", gone.id))!.deletedAt, null, "delete was restored");
  assert.ok((await db.get("venues", created.id))!.deletedAt, "created doc is soft-deleted");
  assert.equal((await db.get("pitches", pitch.id))!.status, "toPitch");
  assert.equal((await db.get("contacts", people.id))!.title, undefined);
  assert.equal((await db.list(`pitches/${pitch.id}/activity`)).length, 0, "created activity is archived");
  assert.equal(k.matchKey, beforeKeep.matchKey);

  // ledger is untouched and reported
  assert.equal((await db.list("ledger")).length, 1);
  assert.equal(report.needsManualCorrection.length, 1);
  assert.equal(report.needsManualCorrection[0].kind, "ledger");
  assert.equal(report.failed.length, 0);
  assert.ok(report.reverted.length === 7);

  // reversals are themselves history, under a new run id, attributed to the undoer
  assert.notEqual(report.undoRunId, ctx.runId);
  const rev = await hist(report.undoRunId);
  assert.ok(rev.length === 7);
  assert.ok(rev.every((h) => h.actor.uid === "jeff" && h.actor.via === "app"));
  assert.ok(rev.some((h) => h.op === "delete" && h.entity.id === created.id));
  assert.ok(rev.some((h) => h.op === "restore" && h.entity.id === gone.id));
  // the original run is still in history
  assert.ok((await hist(ctx.runId)).length === 8);

  // redo = undo the undo
  await undoRun(admin, report.undoRunId);
  const again = (await db.get("venues", keep.id))!;
  assert.equal(again.capacity, 1234);
  assert.equal(again.website, "https://x.example");
  assert.equal((await db.get("venues", gone.id))!.deletedAt !== null, true);
  assert.equal((await db.get("venues", created.id))!.deletedAt, null);
});

test("undo refreshes denormalized copies and survives later edits to the same record", async () => {
  const setup = importCtx("setup", "s");
  const v = await db.create(setup, "venues", venue("Old Name"));
  const p = await db.create(setup, "pitches", { target: { kind: "venue", id: v.id, name: "Old Name" }, status: "toPitch", artistId: "a", personnel: [], showIds: [] });
  const ctx = as("ai");
  await db.update(ctx, "venues", v.id, { name: "New Name" });
  assert.equal((await db.get("pitches", p.id))!.target.name, "New Name");
  await db.update(importCtx("human", "h"), "venues", v.id, { capacity: 50 }); // someone else edits another field later
  await undoRun(as("jeff", "app"), ctx.runId);
  const after = (await db.get("venues", v.id))!;
  assert.equal(after.name, "Old Name");
  assert.equal(after.capacity, 50, "unrelated later edits survive");
  assert.equal((await db.get("pitches", p.id))!.target.name, "Old Name");
});

test("MCP users undo only their own runs; unknown runs are not found", async () => {
  const mine = as("me"), theirs = as("them");
  await db.create(mine, "venues", venue("Mine"));
  await db.create(theirs, "venues", venue("Theirs"));
  const mcp = as("me");
  await assert.rejects(registry["history.undoRun"].run(mcp, { runId: theirs.runId }), (e: any) => e.code === "forbidden");
  await assert.rejects(registry["history.undoRun"].run(mcp, { runId: "nothing" }), (e: any) => e.code === "not_found");
  const ok = (await registry["history.undoRun"].run(mcp, { runId: mine.runId })) as any;
  assert.equal(ok.reverted.length, 1);
  const venues = await db.list("venues");
  assert.deepEqual(venues.map((v) => v.name), ["Theirs"]);
  // an admin can undo anyone's run
  await registry["history.undoRun"].run({ ...as("jeff", "app"), role: "admin" }, { runId: theirs.runId });
  assert.equal((await db.list("venues")).length, 0);
  void makeUser;
});
