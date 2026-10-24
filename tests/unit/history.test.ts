import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { db, run, revId, diffDocs } from "@/server/db";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { historyOfRun, undoRun, runsOf } from "@/server/undo";
import { firestore } from "@/server/admin";
import { migrateHistory } from "../../scripts/migrate-history";
import { resetEmulators, venue } from "./helpers";

beforeEach(resetEmulators);
const T0 = new Date("2026-10-01T12:00:00Z");
const app = (uid: string, ms = 0, extra: Partial<Ctx> = {}): Ctx => ({ uid, role: "admin", via: "app", runId: newRunId(), now: new Date(T0.getTime() + ms), ...extra });
const cfg = (id: string, name: string) => ({ id, name, billingName: name, musicianIds: [] });
const artist = (configurations: unknown[]) => ({ name: "The Band", slug: "the-band", configurations, links: {}, driveFolderId: "d" });

test("each change is an entry at {doc}/history/{rev}, only changed fields, same transaction; nothing at the top level", async () => {
  const ctx = importCtx("tester", "run-1");
  const { id } = await db.create(ctx, "venues", venue("Bluebird", "Denver", { capacity: 100, notes: "hi" }));
  await db.update({ ...ctx, runId: "run-2" }, "venues", id, { capacity: 200 });
  const rows = await db.history("venues", id);
  assert.deepEqual(rows.map((r) => r.id), [revId(2), revId(1)], "newest first, zero-padded rev ids");
  assert.equal(revId(42), "000042");
  const upd = rows[0];
  assert.deepEqual(upd.diff, { capacity: { before: 100, after: 200 } }, "only the changed field");
  assert.equal(upd.runId, "run-2");
  assert.deepEqual(upd.entity, { kind: "venues", id });
  assert.deepEqual(upd.actor, { uid: "tester", via: "import" });
  assert.equal(upd.docRev, 2);
  assert.equal((await firestore().collection("history").limit(1).get()).size, 0, "no top-level history collection");

  // a unit that fails writes neither the change nor its entry
  await assert.rejects(run(ctx, async (w) => { await w.update("venues", id, { capacity: 999 }); throw new Error("boom"); }));
  assert.equal((await db.get("venues", id))!.capacity, 200);
  assert.equal((await db.history("venues", id)).length, 2);
  // two writes to one doc in one unit get two revs and two entries
  await run(ctx, async (w) => { await w.update("venues", id, { capacity: 300 }); await w.update("venues", id, { notes: "x" }); });
  assert.deepEqual((await db.history("venues", id)).map((r) => r.id), [revId(4), revId(3), revId(2), revId(1)]);
});

test("actor carries the session and client when the ctx has them", async () => {
  const ctx: Ctx = { ...importCtx("tester"), via: "assistant", sessionId: "s1", client: { name: "Roadie", model: "m" } };
  const { id } = await db.create(ctx, "venues", venue("Bluebird"));
  assert.deepEqual((await db.history("venues", id))[0].actor, { uid: "tester", via: "assistant", sessionId: "s1", client: { name: "Roadie", model: "m" } });
});

test("nested docs keep their history under themselves", async () => {
  const ctx = importCtx("tester", "r1");
  const p = await db.create(ctx, "pitches", { target: { kind: "venue", id: "v", name: "V" }, status: "toPitch", artistId: "a", personnel: [], showIds: [] });
  const a = await run(ctx, (w) => w.create(`pitches/${p.id}/activity`, { type: "note", text: "called" }));
  const rows = await db.list(`pitches/${p.id}/activity/${a.id}/history`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "000001");
  assert.equal(rows[0].entity.kind, `pitches/${p.id}/activity`);
  assert.equal((await db.listGroup("history", (q) => q.where("runId", "==", "r1"))).length, 2, "collection group sees both levels");
});

test("lists with item ids diff by item id; undo puts one item back and keeps others' edits", async () => {
  const ctx = importCtx("tester", "r1");
  const { id } = await db.create(ctx, "artists", artist([cfg("a", "Trio"), cfg("b", "Duo"), cfg("c", "Solo")]));
  const u = { ...ctx, runId: "r2" };
  await db.update(u, "artists", id, { configurations: [cfg("a", "Trio"), cfg("b", "Duo Acoustic"), cfg("c", "Solo")] });
  let e = (await db.history("artists", id))[0];
  assert.deepEqual(Object.keys((e.diff.configurations as any).byId), ["b"], "only the changed item is stored");
  assert.equal((e.diff.configurations as any).order, undefined);
  assert.ok(JSON.stringify(e.diff).length < 400);

  // move one, add one, remove one
  await db.update({ ...ctx, runId: "r3" }, "artists", id, { configurations: [cfg("c", "Solo"), cfg("a", "Trio"), cfg("d", "Quartet")] });
  e = (await db.history("artists", id))[0];
  const d = e.diff.configurations as any;
  assert.deepEqual(Object.keys(d.byId).sort(), ["b", "d"]);
  assert.deepEqual(d.byId.b, { before: cfg("b", "Duo Acoustic"), after: null, at: 1 });
  assert.deepEqual(d.order, { before: ["a", "b", "c"], after: ["c", "a", "d"] });

  const rep = await undoRun(app("jeff"), "r3");
  assert.equal(rep.reverted.length, 1);
  assert.deepEqual((await db.get("artists", id))!.configurations, [cfg("a", "Trio"), cfg("b", "Duo Acoustic"), cfg("c", "Solo")]);
  await undoRun(app("jeff", 1000), "r2");
  assert.deepEqual((await db.get("artists", id))!.configurations, [cfg("a", "Trio"), cfg("b", "Duo"), cfg("c", "Solo")]);

  // an item edited again since is left alone, the rest reverts
  await db.update({ ...ctx, runId: "r4" }, "artists", id, { configurations: [cfg("a", "Trio 2"), cfg("b", "Duo 2"), cfg("c", "Solo")] });
  await db.update({ ...ctx, runId: "r5" }, "artists", id, { configurations: [cfg("a", "Trio 2"), cfg("b", "Duo 3"), cfg("c", "Solo")] });
  const rep2 = await undoRun(app("jeff", 2000), "r4");
  assert.deepEqual((await db.get("artists", id))!.configurations, [cfg("a", "Trio"), cfg("b", "Duo 3"), cfg("c", "Solo")]);
  assert.deepEqual(rep2.reverted[0].skippedFields, ["configurations.b"]);
});

test("whole-field diff stays for lists without item ids", () => {
  const d = diffDocs({ items: [{ title: "a" }] }, { items: [{ title: "b" }] });
  assert.deepEqual(d.items, { before: [{ title: "a" }], after: [{ title: "b" }] });
});

test("coalescing reads the current-rev entry and moves it, leaving one entry for the burst", async () => {
  const { id } = await db.create(importCtx("setup"), "venues", venue("Hi-Dive", "Denver", { notes: "orig" }));
  const c1 = app("jeff", 0, { autosave: true });
  await db.update(c1, "venues", id, { notes: "h" });
  await db.update(app("jeff", 1000, { autosave: true }), "venues", id, { notes: "he" });
  await db.update(app("jeff", 2000, { autosave: true }), "venues", id, { notes: "hello" });
  const rows = await db.history("venues", id);
  assert.deepEqual(rows.map((r) => r.id), [revId(4), revId(1)], "the folded entry sits at the doc's current rev");
  assert.deepEqual(rows[0].diff.notes, { before: "orig", after: "hello" });
  assert.equal(rows[0].runId, c1.runId);
  // a list item field folds by item id too
  const a = await db.create(importCtx("setup"), "artists", artist([cfg("a", "Trio"), cfg("b", "Duo")]));
  await db.update(app("jeff", 0, { autosave: true }), "artists", a.id, { configurations: [cfg("a", "T"), cfg("b", "Duo")] });
  await db.update(app("jeff", 500, { autosave: true }), "artists", a.id, { configurations: [cfg("a", "Tr"), cfg("b", "Duo")] });
  const h = await db.history("artists", a.id);
  assert.equal(h.length, 2);
  assert.deepEqual((h[0].diff.configurations as any).byId.a, { before: cfg("a", "Trio"), after: cfg("a", "Tr") });
});

test("undoRun finds a run across several docs through the collection group, newest first", async () => {
  const ctx = importCtx("tester", "multi");
  const v = await db.create(importCtx("setup"), "venues", venue("Bluebird", "Denver", { notes: "o" }));
  const c = await db.create(importCtx("setup"), "contacts", { name: "Pat", emails: [], phones: [] });
  await run({ ...ctx, now: new Date(T0.getTime()) }, async (w) => { await w.update("venues", v.id, { notes: "1" }); await w.update("contacts", c.id, { title: "T" }); });
  await db.update({ ...ctx, now: new Date(T0.getTime() + 1000) }, "venues", v.id, { notes: "2" });
  const entries = await historyOfRun("multi");
  assert.equal(entries.length, 3);
  assert.ok(entries.every((e) => e.path.endsWith(`/history/${e.id}`)));
  const rep = await undoRun(app("jeff"), "multi");
  assert.equal(rep.reverted.length, 3);
  assert.equal((await db.get("venues", v.id))!.notes, "o", "newest first, so the earlier value wins");
  assert.equal((await db.get("contacts", c.id))!.title, undefined);
  const runs = await runsOf("tester", 5);
  assert.equal(runs[0].runId, "multi");
});

test("migration moves top-level history under the records, idempotently, with a dry run", async () => {
  const fs = firestore();
  const ctx = importCtx("tester", "r");
  const { id } = await db.create(ctx, "venues", venue("Bluebird"));
  await fs.recursiveDelete(fs.collection(`venues/${id}/history`)); // pretend the entry is still in the old place
  const old = (n: string, extra: Record<string, unknown>) => ({
    id: n, schemaVersion: 1, createdAt: Timestamp.fromMillis(T0.getTime() + Number(n.slice(1)) * 1000), updatedAt: Timestamp.now(), createdBy: "x", updatedBy: "x", via: "mcp", runId: `run-${n}`, deletedAt: null, rev: 1,
    entity: { kind: "venues", id }, op: "update", diff: { notes: { before: null, after: n } }, seq: 0, actor: { uid: "x", via: "mcp" }, ...extra,
  });
  await fs.collection("history").doc("h1").set(old("h1", { docRev: 1 }));
  await fs.collection("history").doc("h2").set(old("h2", { docRev: 2 }));
  await fs.collection("history").doc("h3").set(old("h3", {})); // from before docRev existed
  await fs.collection("history").doc("h4").set(old("h4", { docRev: 2 })); // collides with h2
  const p = await db.create(ctx, "pitches", { target: { kind: "venue", id, name: "V" }, status: "toPitch", artistId: "a", personnel: [], showIds: [] });
  const act = await run(ctx, (w) => w.create(`pitches/${p.id}/activity`, { type: "note", text: "x" }));
  await fs.recursiveDelete(fs.collection(`pitches/${p.id}/activity/${act.id}/history`));
  await fs.collection("history").doc("h5").set(old("h5", { docRev: 1, entity: { kind: `pitches/${p.id}/activity`, id: act.id } }));

  const dry = await migrateHistory(fs, { dryRun: true });
  assert.equal(dry.moved, 5);
  assert.equal((await fs.collection("history").get()).size, 5, "dry run writes nothing");

  const r = await migrateHistory(fs);
  assert.equal(r.moved, 5);
  assert.equal(r.collisions, 1);
  assert.equal(r.remaining, 0);
  assert.equal((await fs.collection("history").get()).size, 0, "nothing left at the top level");
  const ids = (await fs.collection(`venues/${id}/history`).get()).docs.map((d) => d.id).sort();
  assert.equal(ids.length, 4);
  assert.ok(ids.includes("000001") && ids.includes("000002"));
  assert.ok(ids.some((i) => i.startsWith("000000-") && i.endsWith("-h3")), "entries without a rev sort before real ones");
  assert.ok(ids.includes("000002-h4"), "a second entry for the same rev is kept next to the first");
  const moved = (await fs.doc(`venues/${id}/history/000001`).get()).data()!;
  assert.equal(moved.id, "000001");
  assert.equal(moved.runId, "run-h1");
  assert.equal((await fs.doc(`pitches/${p.id}/activity/${act.id}/history/000001`).get()).data()!.runId, "run-h5", "nested entries go under their own record");

  const again = await migrateHistory(fs);
  assert.deepEqual(again, { moved: 0, collisions: 0, remaining: 0 });
  assert.equal((await fs.collection(`venues/${id}/history`).get()).size, 4);
});

test("every history entry is stamped with the artist of its record: its own artistId, its parent's, an artist's own id, else null", async () => {
  const ctx = importCtx("tester", "run-artist");
  const room = await db.create(ctx, "venues", venue("Bluebird"));
  const note = await db.create(ctx, "venueNotes", { artistId: "A", venueId: room.id, contactIds: [], promoterIds: [] }, { id: `A__${room.id}` });
  const pitch = await db.create(ctx, "pitches", { target: { kind: "venue", id: room.id, name: "Bluebird" }, status: "toPitch", artistId: "A", personnel: [], showIds: [] });
  const act = await db.create(ctx, "pitches/" + pitch.id + "/activity", { type: "note", text: "called" });
  const a = await db.create(ctx, "artists", artist([]), { id: "A" });
  const show = await db.create(ctx, "shows", {
    date: "2027-01-01", status: "hold", times: {}, artistId: "A", personnel: [], sound: { provider: "venueProvided" }, kind: "other",
    needs: { poster: false, backline: false, merch: false }, checklist: [], gear: [], docs: [], listings: {},
  });
  await db.create(ctx, "showDeals", { contactIds: [], deal: "free", settled: false }, { id: show.id });
  await db.update(ctx, "venueNotes", note.id, { notes: "x" });
  await db.softDelete(ctx, "venueNotes", note.id);
  const stamp = async (path: string, id: string) => (await db.history(path, id)).map((h) => h.artistId);
  assert.deepEqual(await stamp("venues", room.id), [null], "a shared venue belongs to no one artist");
  assert.deepEqual(await stamp("venueNotes", note.id), ["A", "A", "A"], "create, update and delete of a note all carry its artist");
  assert.deepEqual(await stamp("pitches", pitch.id), ["A"]);
  assert.deepEqual(await stamp(`pitches/${pitch.id}/activity`, act.id), ["A"], "a sub-collection doc takes its parent's");
  assert.deepEqual(await stamp("showDeals", show.id), ["A"], "a deal takes its show's");
  assert.deepEqual(await stamp("artists", a.id), ["A"]);
  assert.deepEqual(await stamp("musicians", (await db.create(ctx, "musicians", { name: "M", instruments: [], active: true })).id), [null]);
  // the Admin History page's two queries
  const mine = await db.listGroup("history", (q) => q.where("artistId", "==", "A")), none = await db.listGroup("history", (q) => q.where("artistId", "==", null));
  assert.ok(mine.every((h) => h.artistId === "A") && none.every((h) => h.artistId === null) && mine.length > 5 && none.length >= 2);
});
