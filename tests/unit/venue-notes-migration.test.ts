import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { undoRun } from "@/server/undo";
import { firestore } from "@/server/admin";
import { migrateVenueNotes } from "../../scripts/migrate-venue-notes";
import { resetEmulators, makeArtist, venue } from "./helpers";

beforeEach(resetEmulators);

/** The state production is in before the migration: venues carry their private fields, history entries carry no artistId. */
async function legacyWorld() {
  const ctx = importCtx("old", "old-run");
  await makeArtist("Ingrid Avison Band", "ingrid-avison-band", "A");
  const hidive = (await db.create(ctx, "venues", venue("Hi-Dive", "Denver", { notes: "Ask for Sam", loadInNotes: "Alley", contactIds: ["c1"], promoterIds: ["p1"], capacity: 250 }))).id;
  const bare = (await db.create(ctx, "venues", venue("Bare Room", "Boulder", { contactIds: [], promoterIds: [] }))).id;
  const gone = (await db.create(ctx, "venues", venue("Closed Room", "Denver", { notes: "closed down", contactIds: [], promoterIds: [] }))).id;
  await db.update(ctx, "venues", hidive, { notes: "Ask for Sam at the bar" });
  await db.softDelete(ctx, "venues", gone);
  const pitch = (await db.create(ctx, "pitches", { target: { kind: "venue", id: hidive, name: "Hi-Dive" }, status: "toPitch", artistId: "A", personnel: [], showIds: [] })).id;
  const act = (await db.create(ctx, `pitches/${pitch}/activity`, { type: "note", text: "x" })).id;
  const fs = firestore();
  for (const h of (await fs.collectionGroup("history").get()).docs) await h.ref.update({ artistId: FieldValue.delete() }); // as written before the stamp existed
  return { hidive, bare, gone, pitch, act, fs };
}

test("migrate:venue-notes moves the private fields to the band's venueNotes, stamps history, and one Undo puts the venues back", async () => {
  const { hidive, bare, gone, pitch, act, fs } = await legacyWorld();
  const dry = await migrateVenueNotes(fs, { dryRun: true });
  assert.deepEqual([dry.notesCreated, dry.venuesCleaned], [2, 3]);
  assert.equal((await db.get("venues", hidive))!.notes, "Ask for Sam at the bar", "a dry run writes nothing");
  assert.equal((await fs.collection("venueNotes").get()).size, 0);
  assert.equal((await fs.collectionGroup("history").where("artistId", "==", null).get()).size, 0);

  const r = await migrateVenueNotes(fs);
  assert.equal(r.artistId, "A");
  const v = (await db.get("venues", hidive))!;
  for (const f of ["notes", "loadInNotes", "contactIds", "promoterIds"]) assert.equal(f in v, false, `${f} is gone from the shared venue`);
  assert.equal(v.capacity, 250);
  const n = (await db.get("venueNotes", `A__${hidive}`))!;
  assert.deepEqual([n.artistId, n.venueId, n.notes, n.loadInNotes, n.contactIds, n.promoterIds], ["A", hidive, "Ask for Sam at the bar", "Alley", ["c1"], ["p1"]]);
  assert.equal(await db.get("venueNotes", `A__${bare}`), null, "a venue with nothing private gets no notes doc");
  assert.equal("contactIds" in (await db.get("venues", bare))!, false, "but its empty arrays are removed too");
  // a venue archived before stays out of the band's lists: its notes are archived with it
  assert.ok((await db.get("venueNotes", `A__${gone}`))!.deletedAt);
  assert.equal("notes" in (await db.get("venues", gone))!, false);

  // history: every entry has an artistId; entries that show the band's old private content belong to the band, the rest to no one artist
  const all = (await fs.collectionGroup("history").get()).docs.map((d) => ({ path: d.ref.path, ...d.data() }) as Record<string, any>);
  assert.ok(all.every((h) => "artistId" in h));
  const byPath = (p: string) => all.filter((h) => h.path.startsWith(p));
  assert.ok(byPath(`venues/${hidive}/history`).every((h) => h.artistId === "A"), "the Hi-Dive entries all show private notes");
  assert.ok(byPath(`venues/${bare}/history`).every((h) => h.artistId === null), "a bare room's history is shared");
  assert.ok(byPath(`pitches/${pitch}/history`).every((h) => h.artistId === "A"));
  assert.ok(byPath(`pitches/${pitch}/activity/${act}/history`).every((h) => h.artistId === "A"), "a pitch's activity takes its pitch's artist");
  assert.ok(byPath(`venueNotes/A__${hidive}/history`).every((h) => h.artistId === "A"));

  // idempotent
  const again = await migrateVenueNotes(fs);
  assert.deepEqual([again.notesCreated, again.venuesCleaned, again.historyStamped], [0, 0, 0]);

  // one run: Undo reverses the venue part
  const rep = await undoRun(importCtx("undo"), r.runId);
  assert.equal(rep.failed.length, 0);
  assert.equal((await db.get("venues", hidive))!.notes, "Ask for Sam at the bar");
  assert.deepEqual((await db.get("venues", hidive))!.contactIds, ["c1"]);
  assert.ok((await db.get("venueNotes", `A__${hidive}`))!.deletedAt);
});

test("migrate:venue-notes leaves a notes doc the app already created, and needs --artist when there is more than one artist", async () => {
  const { hidive, fs } = await legacyWorld();
  await db.create(importCtx("app"), "venueNotes", { artistId: "A", venueId: hidive, notes: "newer", contactIds: [], promoterIds: [] }, { id: `A__${hidive}` });
  await migrateVenueNotes(fs);
  assert.equal((await db.get("venueNotes", `A__${hidive}`))!.notes, "newer", "the newer notes win");
  assert.equal("notes" in (await db.get("venues", hidive))!, false);

  await resetEmulators();
  const w2 = await legacyWorld();
  await makeArtist("Fern Valley", "fern-valley", "B");
  await assert.rejects(migrateVenueNotes(w2.fs), /more than one artist.*--artist/);
  const r = await migrateVenueNotes(w2.fs, { artistSlug: "ingrid-avison-band" });
  assert.equal(r.artistId, "A");
  assert.ok(await db.get("venueNotes", `A__${w2.hidive}`));
});

test("a not-yet-migrated venue can still be read and updated by the new code, and migrating afterwards loses nothing", async () => {
  const { hidive, fs } = await legacyWorld();
  const cmd = async (name: string, input: unknown) => {
    const { registry } = await import("@/server/commands/registry");
    return (await registry[name].run({ ...importCtx("app"), artistId: "A" }, registry[name].input.parse(input))) as Record<string, any>;
  };
  await cmd("venues.update", { id: hidive, patch: { capacity: 260 } });
  await cmd("venues.update", { id: hidive, patch: { loadInNotes: "Dock moved" } }); // starts the notes doc from the legacy fields
  assert.deepEqual((await db.get("venueNotes", `A__${hidive}`))!.contactIds, ["c1"]);
  await migrateVenueNotes(fs);
  const n = (await db.get("venueNotes", `A__${hidive}`))!;
  assert.deepEqual([n.loadInNotes, n.notes, n.contactIds, n.promoterIds], ["Dock moved", "Ask for Sam at the bar", ["c1"], ["p1"]]);
  assert.equal((await db.get("venues", hidive))!.capacity, 260);
});
