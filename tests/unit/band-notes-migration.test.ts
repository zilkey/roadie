import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { undoRun } from "@/server/undo";
import { firestore } from "@/server/admin";
import { migrateBandNotes } from "../../scripts/migrate-band-notes";
import { resetEmulators, makeArtist } from "./helpers";

beforeEach(resetEmulators);

/** The state production is in before the migration: festivals, years, promoters and contacts carry the band's notes themselves. */
async function legacyWorld() {
  const ctx = importCtx("old", "old-run");
  await makeArtist("Ingrid Avison Band", "ingrid-avison-band", "A");
  const fest = (await db.create(ctx, "festivals", { name: "UMS", type: "festival", region: "denver", contactIds: [], notes: "Tier A" })).id;
  await db.update(ctx, "festivals", fest, { notes: "Tier A, apply early" });
  const bare = (await db.create(ctx, "festivals", { name: "Levitt", type: "series", region: "denver", contactIds: [] })).id;
  const ed = (await db.create(ctx, "editions", { festivalId: fest, festivalName: "UMS", year: 2027, label: "2027", venueIds: [], payNotes: "$400", notes: "Saturday" })).id;
  const prom = (await db.create(ctx, "promoters", { name: "Front Range", kind: "promoter", contactIds: [], venueIds: ["v1"], howToPitch: "Email Marcus" })).id;
  const empty = (await db.create(ctx, "promoters", { name: "Dairy", kind: "nonprofit", contactIds: [], venueIds: [] })).id;
  const con = (await db.create(ctx, "contacts", { name: "Dana", emails: [], phones: [], notes: "Prefers calls" })).id;
  const gone = (await db.create(ctx, "contacts", { name: "Old", emails: [], phones: [], notes: "left" })).id;
  await db.softDelete(ctx, "contacts", gone);
  return { fest, bare, ed, prom, empty, con, gone, fs: firestore() };
}

test("migrate:band-notes moves notes to the band's notes docs, stamps their history, and one Undo puts them back", async () => {
  const { fest, bare, ed, prom, empty, con, gone, fs } = await legacyWorld();
  const dry = await migrateBandNotes(fs, { dryRun: true });
  assert.deepEqual([dry.notesCreated, dry.recordsCleaned], [5, 6], "Levitt holds no note field; Dairy holds only an empty venueIds");
  assert.equal((await db.get("festivals", fest))!.notes, "Tier A, apply early", "a dry run writes nothing");
  assert.equal((await fs.collection("festivalNotes").get()).size, 0);

  const r = await migrateBandNotes(fs);
  assert.equal(r.artistId, "A");
  assert.equal("notes" in (await db.get("festivals", fest))!, false);
  assert.equal((await db.get("festivals", fest))!.name, "UMS");
  const fn = (await db.get("festivalNotes", `A__${fest}`))!;
  assert.deepEqual([fn.artistId, fn.festivalId, fn.notes], ["A", fest, "Tier A, apply early"]);
  assert.equal(await db.get("festivalNotes", `A__${bare}`), null);
  const en = (await db.get("editionNotes", `A__${ed}`))!;
  assert.deepEqual([en.editionId, en.payNotes, en.notes], [ed, "$400", "Saturday"]);
  for (const f of ["payNotes", "notes"]) assert.equal(f in (await db.get("editions", ed))!, false);
  const pn = (await db.get("promoterNotes", `A__${prom}`))!;
  assert.deepEqual([pn.promoterId, pn.howToPitch, pn.venueIds], [prom, "Email Marcus", ["v1"]]);
  for (const f of ["howToPitch", "venueIds"]) assert.equal(f in (await db.get("promoters", prom))!, false);
  assert.equal(await db.get("promoterNotes", `A__${empty}`), null, "nothing to keep: no notes doc");
  assert.equal("venueIds" in (await db.get("promoters", empty))!, false, "but the empty list is removed");
  assert.equal((await db.get("contactNotes", `A__${con}`))!.notes, "Prefers calls");
  assert.equal("notes" in (await db.get("contacts", gone))!, false, "an archived contact is cleaned too");

  // history: entries that show a note belong to the band; the bare festival's stay shared
  const hist = async (p: string) => (await fs.collection(`${p}/history`).get()).docs.map((d) => d.data());
  assert.ok((await hist(`festivals/${fest}`)).every((h) => h.artistId === "A"));
  assert.ok((await hist(`promoters/${prom}`)).every((h) => h.artistId === "A"));
  assert.ok((await hist(`festivals/${bare}`)).every((h) => h.artistId !== "A"));
  assert.ok(r.historyStamped > 0);

  const again = await migrateBandNotes(fs);
  assert.deepEqual([again.notesCreated, again.recordsCleaned, again.historyStamped], [0, 0, 0], "safe to run again");

  const rep = await undoRun(importCtx("undo"), r.runId);
  assert.equal(rep.failed.length, 0);
  assert.equal((await db.get("festivals", fest))!.notes, "Tier A, apply early");
  assert.deepEqual((await db.get("promoters", prom))!.venueIds, ["v1"]);
  assert.ok((await db.get("festivalNotes", `A__${fest}`))!.deletedAt);
});

test("migrate:band-notes keeps a notes doc the app already created, and needs --artist when there is more than one artist", async () => {
  const { fest, fs } = await legacyWorld();
  await db.create(importCtx("app"), "festivalNotes", { artistId: "A", festivalId: fest, notes: "newer" }, { id: `A__${fest}` });
  await migrateBandNotes(fs);
  assert.equal((await db.get("festivalNotes", `A__${fest}`))!.notes, "newer", "the newer notes win");
  assert.equal("notes" in (await db.get("festivals", fest))!, false);

  await resetEmulators();
  const w2 = await legacyWorld();
  await makeArtist("Fern Valley", "fern-valley", "B");
  await assert.rejects(migrateBandNotes(w2.fs), /more than one artist.*--artist/);
  assert.equal((await migrateBandNotes(w2.fs, { artistSlug: "ingrid-avison-band" })).artistId, "A");
});

test("before the migration the commands read the legacy notes and start the band's notes doc from them; migrating afterwards loses nothing", async () => {
  const { fest, prom, fs } = await legacyWorld();
  const { registry } = await import("@/server/commands/registry");
  const cmd = async (name: string, input: unknown) =>
    (await registry[name].run({ ...importCtx("app"), artistId: "A" }, registry[name].input.parse(input))) as Record<string, any>;
  assert.equal((await cmd("records.get", { kind: "festivals", id: fest })).notes, "Tier A, apply early");
  await cmd("promoters.update", { id: prom, patch: { notes: "Met at UMS" } });
  const pn = (await db.get("promoterNotes", `A__${prom}`))!;
  assert.deepEqual([pn.notes, pn.howToPitch, pn.venueIds], ["Met at UMS", "Email Marcus", ["v1"]]);
  await migrateBandNotes(fs);
  const after = await cmd("records.get", { kind: "promoters", id: prom });
  assert.deepEqual([after.notes, after.howToPitch, after.venueIds], ["Met at UMS", "Email Marcus", ["v1"]]);
});
