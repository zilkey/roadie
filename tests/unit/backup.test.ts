import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db, run } from "@/server/db";
import { firestore } from "@/server/admin";
import { importCtx } from "@/server/ctx";
import { registry } from "@/server/commands/registry";
import { dumpAll, restoreDump, validateDump, validateRow } from "@/server/backup";
import { backup } from "../../scripts/backup";
import { loadBackup } from "../../scripts/restore";
import { resetEmulators, venue } from "./helpers";

beforeEach(resetEmulators);

test("backup then restore round-trips every collection, subcollections, history and timestamps", async () => {
  const ctx = importCtx("tester", "seed-run");
  const v = await db.create(ctx, "venues", venue("Bluebird", "Denver", { capacity: 500 }));
  const c = await db.create(ctx, "contacts", { name: "Pat", emails: ["pat@example.com"], phones: ["+13035551212"] });
  await db.update(ctx, "venues", v.id, { website: "https://bluebird.example" });
  await db.create(ctx, "venueNotes", { artistId: "a", venueId: v.id, contactIds: [c.id], promoterIds: [], notes: "great room" }, { id: `a__${v.id}` });
  const p = await db.create(ctx, "pitches", { target: { kind: "venue", id: v.id, name: "Bluebird" }, status: "toPitch", artistId: "a", personnel: [], showIds: [] });
  await run(ctx, async (w) => {
    await w.create(`pitches/${p.id}/activity`, { type: "note", text: "called" });
    await w.create(`pitches/${p.id}/comments`, { authorId: "u", body: "hi" });
  });
  await db.create(ctx, "statSnapshots", { source: "spotifyApi", date: "2026-10-01", followers: 10, popularity: 1 });
  await db.softDelete(ctx, "contacts", c.id);

  const before = await dumpAll(firestore());
  assert.ok([before.venues, before.statSnapshots].every((rows) => rows.filter((r) => !r.path.includes("/history/")).length === 1));
  const histRows = (d: typeof before) => Object.values(d).flat().filter((r) => r.path.includes("/history/"));
  assert.ok(histRows(before).length >= 6 && !before.history, "history lives in each record's subcollection, so it is in the parent's file");
  assert.ok(before.venues.some((r) => r.path === `venues/${v.id}/history/000002`) && before.pitches.some((r) => r.path.includes("/activity/") && r.path.includes("/history/")));
  assert.ok(before.pitches.some((r) => r.path.includes("/activity/")), "subcollection docs are included");
  assert.deepEqual(validateDump(before), []);

  const out = fs.mkdtempSync(path.join(os.tmpdir(), "bk-"));
  try {
    const { dir, counts } = await backup(out, "2026-10-23");
    assert.ok(dir.endsWith("2026-10-23"));
    assert.ok(fs.existsSync(path.join(dir, "venues.json")) && !fs.existsSync(path.join(dir, "history.json")));
    assert.equal(counts.pitches, before.pitches.length);

    await resetEmulators();
    assert.deepEqual(await dumpAll(firestore()), {});
    const loaded = loadBackup(dir);
    assert.deepEqual(validateDump(loaded), []);
    const n = await restoreDump(firestore(), loaded);
    assert.equal(n, Object.values(before).flat().length);

    assert.deepEqual(await dumpAll(firestore()), before, "identical after restore");
    assert.equal(histRows(await dumpAll(firestore())).length, histRows(before).length, "history subcollections are put back");
    const doc = (await db.get("venues", v.id))!;
    assert.equal(typeof doc.createdAt.toMillis, "function", "timestamps are real timestamps again");
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test("the walk reads the same documents at any concurrency: nested sub-collections, parents that exist only as paths, skipped collections", async () => {
  const fs_ = firestore();
  const ctx = importCtx("tester", "seed-run");
  for (let i = 0; i < 12; i++) await db.create(ctx, "venues", venue(`Room ${i}`, "Denver", { capacity: 100 + i }));
  // a sub-collection under a parent document that was never written: walked into, the parent itself not returned
  await fs_.doc("pitches/ghost/comments/c1").set({ body: "orphan" });
  await fs_.doc("pitches/ghost/comments/c1/history/000001").set({ deep: true });
  await fs_.doc("mutations/m1").set({ at: 1 });

  const serial = await dumpAll(fs_, { concurrency: 1 });
  let last = 0;
  const parallel = await dumpAll(fs_, { concurrency: 32, onProgress: (n) => { last = n; } });
  assert.deepEqual(parallel, serial);
  assert.equal(last, Object.values(parallel).flat().length, "progress ends at the number of documents read");
  assert.deepEqual(parallel.pitches.map((r) => r.path), ["pitches/ghost/comments/c1", "pitches/ghost/comments/c1/history/000001"]);
  assert.equal(parallel.venues.filter((r) => !r.path.includes("/history/")).length, 12);
  assert.equal("mutations" in parallel, false, "left out of backups");
});

test("restore validates every document with the Zod schemas", async () => {
  const ctx = importCtx("tester", "r");
  await db.create(ctx, "venues", venue("Okay"));
  const dump = await dumpAll(firestore());
  const bad = structuredClone(dump);
  bad.venues[0].data.region = "mars";
  bad.venues[0].data.surprise = 1;
  bad.nonsense = [{ path: "nonsense/x", data: { id: "x" } }];
  const errs = validateDump(bad);
  assert.ok(errs.some((e) => /region/.test(e)), errs.join("\n"));
  assert.ok(errs.some((e) => /surprise|unrecognized/i.test(e)));
  assert.ok(errs.some((e) => /no schema for collection "nonsense"/.test(e)));
  const wrongId = structuredClone(dump);
  wrongId.venues[0].path = "venues/other";
  assert.ok(validateRow(wrongId.venues[0]).some((e) => /does not match/.test(e)));
});

test("restore validator: venueNotes need their artist and venue, and an old-shape venue (private fields still on it) still restores", async () => {
  const ctx = importCtx("tester", "r2");
  const v = await db.create(ctx, "venues", venue("Okay"));
  await db.create(ctx, "venueNotes", { artistId: "a", venueId: v.id, contactIds: [], promoterIds: [], notes: "n" }, { id: `a__${v.id}` });
  const dump = await dumpAll(firestore());
  assert.deepEqual(validateDump(dump), []);
  assert.ok(dump.venueNotes.some((r) => r.path === `venueNotes/a__${v.id}`), "the new collection is in the dump");
  const bad = structuredClone(dump);
  delete bad.venueNotes.find((r) => r.path === `venueNotes/a__${v.id}`)!.data.artistId;
  assert.ok(validateDump(bad).some((e) => /artistId/.test(e)));
  // a backup taken before the split has the private fields on the venue itself: it must still restore until migrate:venue-notes has run
  const old = structuredClone(dump);
  Object.assign(old.venues.find((r) => r.path === `venues/${v.id}`)!.data, { notes: "old", contactIds: ["c"], promoterIds: [], loadInNotes: "dock" });
  assert.deepEqual(validateDump(old), []);
  // history entries from before the artist stamp have none
  const oldHist = structuredClone(dump);
  delete oldHist.venues.find((r) => r.path.includes("/history/"))!.data.artistId;
  assert.deepEqual(validateDump(oldHist), []);
});
