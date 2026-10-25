/**
 * Acceptance tests for migrate:crowd: the crowd estimate comes out of the deal's rating onto its own field, a rating
 * left with nothing in it goes away, a top-level crowd already there wins, soft-deleted deals are fixed too, and one
 * Undo puts it all back. Pre-migration deals keep working: the after-page read and shows.afterShow are covered in
 * shows.test.ts.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { undoRun } from "@/server/undo";
import { firestore } from "@/server/admin";
import { ShowDeal } from "@/schema/shows";
import { migrateCrowd } from "../../scripts/migrate-crowd";
import { resetEmulators } from "./helpers";

beforeEach(resetEmulators);

const deal = (id: string, body: Record<string, unknown>) =>
  db.create(importCtx("old", "old-run"), "showDeals", { contactIds: [], deal: "guarantee", ...body }, { id });

test("migrate:crowd lifts the crowd out of the rating, drops an empty rating, and one Undo puts it back", async () => {
  const ctx = importCtx("old", "old-run");
  await deal("full", { rating: { show: 4, venue: 5, crowd: 60, notes: "Great room" } });
  await deal("only-crowd", { rating: { crowd: 120 } });
  await deal("no-crowd", { rating: { show: 3, venue: 3 } });
  await deal("none", {});
  await deal("gone", { rating: { crowd: 45, notes: "closed down" } });
  await db.softDelete(ctx, "showDeals", "gone");
  const fs = firestore();

  const dry = await migrateCrowd(fs, { dryRun: true });
  assert.deepEqual([dry.moved.length, dry.kept.length], [3, 0]);
  assert.equal((await db.get("showDeals", "full"))!.crowd, undefined, "a dry run writes nothing");
  assert.equal(((await db.get("showDeals", "full"))!.rating as Record<string, unknown>).crowd, 60);

  const r = await migrateCrowd(fs);
  assert.deepEqual(r.moved.map((m) => m.id).sort(), ["full", "gone", "only-crowd"]);
  assert.equal(r.kept.length, 0);

  const full = (await db.get("showDeals", "full"))!;
  assert.equal(full.crowd, 60);
  assert.deepEqual(full.rating, { show: 4, venue: 5, notes: "Great room" });

  // the rating held nothing but a crowd: it goes away rather than staying as {}
  const only = (await db.get("showDeals", "only-crowd"))!;
  assert.equal(only.crowd, 120);
  assert.equal(only.rating, undefined);

  // untouched
  assert.deepEqual((await db.get("showDeals", "no-crowd"))!.rating, { show: 3, venue: 3 });
  assert.equal((await db.get("showDeals", "no-crowd"))!.crowd, undefined);
  assert.equal((await db.get("showDeals", "none"))!.rating, undefined);

  // a soft-deleted deal is fixed in place, still archived
  const gone = (await db.get("showDeals", "gone"))!;
  assert.equal(gone.crowd, 45);
  assert.deepEqual(gone.rating, { notes: "closed down" });
  assert.ok(gone.deletedAt);

  // every migrated deal still parses, now with the crowd on the outside
  for (const id of ["full", "only-crowd", "no-crowd"]) {
    const d = (await db.get("showDeals", id))!;
    assert.equal(ShowDeal.partial().safeParse(d).success, true, id);
  }

  // running again is a no-op
  const again = await migrateCrowd(fs);
  assert.deepEqual([again.moved.length, again.kept.length], [0, 0]);
  assert.equal((await db.get("showDeals", "full"))!.crowd, 60);
});

test("migrate:crowd keeps a crowd the deal already has and reports the disagreement", async () => {
  await deal("both", { crowd: 90, rating: { show: 4, crowd: 60 } });
  const r = await migrateCrowd(firestore());
  assert.deepEqual(r.moved, []);
  assert.deepEqual(r.kept, [{ id: "both", had: 90, nested: 60 }]);
  const d = (await db.get("showDeals", "both"))!;
  assert.equal(d.crowd, 90, "the top-level one wins");
  assert.deepEqual(d.rating, { show: 4 }, "the nested one is dropped either way");
});

test("migrate:crowd goes through the writer, so Admin → History can undo the whole run", async () => {
  await deal("full", { rating: { show: 4, crowd: 60 } });
  const r = await migrateCrowd(firestore());
  await undoRun(importCtx("undo"), r.runId);
  const back = (await db.get("showDeals", "full"))!;
  assert.deepEqual(back.rating, { show: 4, crowd: 60 });
  assert.equal(back.crowd, undefined);
});
