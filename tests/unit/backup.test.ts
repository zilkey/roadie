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
  await db.update(ctx, "venues", v.id, { contactIds: [c.id], notes: "great room" });
  const p = await db.create(ctx, "pitches", { target: { kind: "venue", id: v.id, name: "Bluebird" }, status: "toPitch", artistId: "a", personnel: [], showIds: [] });
  await run(ctx, async (w) => {
    await w.create(`pitches/${p.id}/activity`, { type: "note", text: "called" });
    await w.create(`pitches/${p.id}/comments`, { authorId: "u", body: "hi" });
  });
  await registry["ledger.record"].run(ctx as never, registry["ledger.record"].input.parse({ kind: "income", amount: 5000, category: "door", method: "cash", date: "2026-10-01" }));
  await db.softDelete(ctx, "contacts", c.id);

  const before = await dumpAll(firestore());
  assert.ok(before.venues.length === 1 && before.history.length >= 6 && before.ledger.length === 1);
  assert.ok(before.pitches.some((r) => r.path.includes("/activity/")), "subcollection docs are included");
  assert.deepEqual(validateDump(before), []);

  const out = fs.mkdtempSync(path.join(os.tmpdir(), "bk-"));
  try {
    const { dir, counts } = await backup(out, "2026-10-23");
    assert.ok(dir.endsWith("2026-10-23"));
    assert.ok(fs.existsSync(path.join(dir, "venues.json")) && fs.existsSync(path.join(dir, "history.json")));
    assert.equal(counts.pitches, 3);

    await resetEmulators();
    assert.deepEqual(await dumpAll(firestore()), {});
    const loaded = loadBackup(dir);
    assert.deepEqual(validateDump(loaded), []);
    const n = await restoreDump(firestore(), loaded);
    assert.equal(n, Object.values(before).flat().length);

    assert.deepEqual(await dumpAll(firestore()), before, "identical after restore");
    const doc = (await db.get("venues", v.id))!;
    assert.equal(typeof doc.createdAt.toMillis, "function", "timestamps are real timestamps again");
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
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
