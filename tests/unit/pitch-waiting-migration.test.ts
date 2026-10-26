/**
 * Acceptance tests for migrate:pitch-waiting: pitches still in "waiting" move to "pitched" (soft-deleted ones too),
 * lastContactAt is kept, old "Waiting" timeline entries still read, and a dry run writes nothing.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { firestore } from "@/server/admin";
import { migratePitchWaiting } from "../../scripts/migrate-pitch-waiting";
import { resetEmulators } from "./helpers";

beforeEach(resetEmulators);

test("migrate:pitch-waiting moves Waiting pitches to Pitched and leaves the rest", async () => {
  const fs = firestore();
  const ctx = importCtx("old", "old-run");
  const contacted = new Date("2026-10-01T18:00:00Z");
  const pitch = (id: string, status: string) => db.create(ctx, "pitches", { target: { kind: "venue", id: "v", name: id }, status: "toPitch", artistId: "a", personnel: [], showIds: [] }, { id })
    .then(() => fs.collection("pitches").doc(id).update({ status, ...(status === "waiting" ? { lastContactAt: contacted } : {}) }));
  await pitch("w1", "waiting");
  await pitch("w2", "waiting");
  await pitch("t", "talking");
  await db.softDelete(ctx, "pitches", "w2");
  await fs.collection("pitches/w1/activity").add({ type: "status", fromStatus: "pitched", toStatus: "waiting", createdAt: contacted, updatedAt: contacted });

  const dry = await migratePitchWaiting(fs, { dryRun: true });
  assert.deepEqual(dry.migrated.map((m) => m.id).sort(), ["w1", "w2"]);
  assert.equal((await fs.collection("pitches").doc("w1").get()).data()!.status, "waiting", "a dry run writes nothing");

  await migratePitchWaiting(fs);
  const w1 = (await db.get("pitches", "w1"))!;
  assert.equal(w1.status, "pitched");
  assert.equal(w1.lastContactAt!.toMillis(), contacted.getTime(), "the two-week clock is not restarted");
  assert.equal((await fs.collection("pitches").doc("w2").get()).data()!.status, "pitched");
  assert.equal((await db.get("pitches", "t"))!.status, "talking");
  const acts = await db.list("pitches/w1/activity");
  assert.equal(acts[0].toStatus, "waiting", "old timeline entries still parse");

  assert.equal((await migratePitchWaiting(fs)).migrated.length, 0, "safe to run again");
});
