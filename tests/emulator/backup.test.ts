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
import { resetEmulators, venue, TEST_ARTIST } from "./helpers";

beforeEach(resetEmulators);

test("backup then restore round-trips every collection, subcollections, history and timestamps", async () => {
  const ctx = importCtx("tester", "seed-run");
  const v = await db.create(ctx, "venues", venue("Bluebird", "Denver", { capacity: 500 }));
  const c = await db.create(ctx, "contacts", { artistId: TEST_ARTIST, name: "Pat", emails: ["pat@example.com"], phones: ["+13035551212"] });
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

test("what the server keeps outside db.ts is backed up and restored as it is; a collection nobody listed is still refused", async () => {
  const fs_ = firestore();
  const ctx = importCtx("tester", "kept");
  const u = await db.create(ctx, "users", { email: "a@example.com", name: "Ann", artists: [] });
  const at = new Date("2026-11-10T12:00:00Z");
  const kept: Record<string, Record<string, unknown>> = {
    "assistantThreads/t1": { uid: u.id, artistId: "a", lastActiveAt: at, runs: [{ runId: "r1", at }] },
    "assistantThreads/t1/messages/m1": { role: "user", text: "hi", at },
    "assistantThreads/t1/pending/p1": { command: "shows.create", input: { date: "2026-12-01" }, status: "pending" },
    "userPrefs/u1": { uid: "u1", askChannel: "email" },
    "googleGrants/u1": { emails: ["a@example.com"], refreshToken: "x" },
    "metaConnections/a": { pageId: "1" },
    "stagePlotTokens/p1": { token: "t" },
    "routeCache/k1": { miles: 12.5, at },
    "geocodes/k1": { lat: 40, lng: -105 },
    "fuelPrices/s1": { price: 3.1, at },
    [`users/${u.id}/private/driving`]: { mpg: 22 },
  };
  for (const [p, d] of Object.entries(kept)) await fs_.doc(p).set(d);
  const dump = await dumpAll(fs_);
  assert.deepEqual(validateDump(dump), [], "nothing here fails validation");
  // only the listed places skip validation: a stray sub-collection of a validated record and an unknown collection are refused
  assert.ok(validateRow({ path: `users/${u.id}/secrets/x`, data: {} }).some((e) => /no schema for collection "secrets"/.test(e)));
  assert.ok(validateRow({ path: "nonsense/x", data: {} }).some((e) => /no schema for collection "nonsense"/.test(e)));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-kept-"));
  try {
    const { dir: out } = await backup(dir, "2026-11-10");
    await resetEmulators();
    const loaded = loadBackup(out);
    assert.deepEqual(validateDump(loaded), []);
    await restoreDump(fs_, loaded);
    for (const [p, d] of Object.entries(kept)) {
      const got = (await fs_.doc(p).get()).data();
      assert.ok(got, `${p} came back`);
      assert.deepEqual(JSON.parse(JSON.stringify(got, (_k, v) => (v && typeof v.toDate === "function" ? v.toDate().toISOString() : v))), JSON.parse(JSON.stringify(d)), p);
    }
    assert.ok((await fs_.doc("assistantThreads/t1").get()).data()!.lastActiveAt.toDate, "timestamps come back as timestamps");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("restore validator: venueNotes need their artist and venue, and a venue that carries a band's private fields is refused", async () => {
  const ctx = importCtx("tester", "r2");
  const v = await db.create(ctx, "venues", venue("Okay"));
  await db.create(ctx, "venueNotes", { artistId: "a", venueId: v.id, contactIds: [], promoterIds: [], notes: "n" }, { id: `a__${v.id}` });
  const dump = await dumpAll(firestore());
  assert.deepEqual(validateDump(dump), []);
  assert.ok(dump.venueNotes.some((r) => r.path === `venueNotes/a__${v.id}`), "the new collection is in the dump");
  const bad = structuredClone(dump);
  delete bad.venueNotes.find((r) => r.path === `venueNotes/a__${v.id}`)!.data.artistId;
  assert.ok(validateDump(bad).some((e) => /artistId/.test(e)));
  // the private fields live on venueNotes only: a venue doc that carries them does not restore
  const old = structuredClone(dump);
  Object.assign(old.venues.find((r) => r.path === `venues/${v.id}`)!.data, { notes: "old" });
  assert.ok(validateDump(old).some((e) => /venues\/.*notes|Unrecognized key/.test(e)));
  // history entries from before the artist stamp have none
  const oldHist = structuredClone(dump);
  delete oldHist.venues.find((r) => r.path.includes("/history/"))!.data.artistId;
  assert.deepEqual(validateDump(oldHist), []);
});
