import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, run } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { AppError } from "@/server/errors";
import { resetEmulators, venue } from "./helpers";

beforeEach(resetEmulators);
const ctx = () => importCtx("tester", "run-1");
const history = (entityId?: string) => db.listGroup("history", (q) => q).then((h) => h.filter((x) => !entityId || x.entity.id === entityId));

test("create stamps common fields and writes history with runId", async () => {
  const { id } = await db.create(ctx(), "venues", venue("The Hi-Dive"));
  const doc = (await db.get("venues", id))!;
  assert.equal(doc.createdBy, "tester");
  assert.equal(doc.via, "import");
  assert.equal(doc.runId, "run-1");
  assert.equal(doc.deletedAt, null);
  assert.equal(doc.matchKey, "the-hi-dive-denver");
  const h = await history(id);
  assert.equal(h.length, 1);
  assert.equal(h[0].op, "create");
  assert.equal(h[0].runId, "run-1");
  assert.equal(h[0].diff.name.after, "The Hi-Dive");
});

test("strict schemas reject unknown fields and bad values", async () => {
  await assert.rejects(db.create(ctx(), "venues", venue("X", "Denver", { bogus: 1 })), (e: AppError) => e.code === "invalid_input" && Array.isArray(e.issues));
  await assert.rejects(db.create(ctx(), "venues", { ...venue("X"), region: "mars" }), (e: AppError) => e.code === "invalid_input");
  await assert.rejects(db.create(ctx(), "venues", venue("X", "Denver", { id: "hack" })), (e: AppError) => e.code === "invalid_input");
});

test("update records a diff, null clears, no-op writes nothing", async () => {
  const { id } = await db.create(ctx(), "venues", venue("Lost Lake", "Denver", { capacity: 300 }));
  const r = await db.update({ ...ctx(), runId: "run-2" }, "venues", id, { capacity: 350, notes: "nice" });
  assert.equal(r.changed, true);
  const d = (await db.get("venues", id))!;
  assert.equal(d.capacity, 350);
  assert.equal(d.runId, "run-2");
  const upd = (await history(id)).find((x) => x.op === "update")!;
  assert.deepEqual(upd.diff.capacity, { before: 300, after: 350 });
  assert.ok(!("updatedAt" in upd.diff));
  assert.equal((await db.update(ctx(), "venues", id, { capacity: 350 })).changed, false);
  assert.equal((await history(id)).length, 2);
  await db.update(ctx(), "venues", id, { capacity: null });
  assert.equal((await db.get("venues", id))!.capacity, undefined);
  await assert.rejects(db.update(ctx(), "venues", id, { createdBy: "x" }), (e: AppError) => e.code === "invalid_input");
});

test("soft delete hides from list; restore brings back", async () => {
  const { id } = await db.create(ctx(), "songs", { title: "Glass Coast", status: "active" });
  await db.softDelete(ctx(), "songs", id);
  assert.ok((await db.get("songs", id))!.deletedAt);
  assert.equal((await db.list("songs")).length, 0);
  await assert.rejects(db.update(ctx(), "songs", id, { title: "x" }), (e: AppError) => e.code === "not_found");
  await db.restore(ctx(), "songs", id);
  assert.equal((await db.list("songs")).length, 1);
  assert.deepEqual((await history(id)).map((h) => h.op).sort(), ["create", "delete", "restore"]);
});

test("dedupe: a matching create merges into the existing venue", async () => {
  const src = (url: string) => ({ url, checkedAt: "2026-10-01" });
  const a = await db.create(ctx(), "venues", venue("Lost Lake", "Denver", { sources: [src("https://a.example")], capacity: 300 }));
  const b = await db.create(ctx(), "venues", venue("  lost lake ", "denver", { sources: [src("https://b.example")], capacity: 999, website: "https://lostlake.example" }));
  assert.equal(b.merged, true);
  assert.equal(b.id, a.id);
  const d = (await db.get("venues", a.id))!;
  assert.deepEqual(d.sources.map((x: { url: string }) => x.url), ["https://a.example", "https://b.example"], "lists are unioned");
  assert.equal(d.capacity, 300, "existing values win");
  assert.equal(d.website, "https://lostlake.example");
  assert.equal((await db.list("venues")).length, 1);
  assert.ok((await history(a.id)).some((h) => h.op === "merge"));
});

test("contacts: emails lowercased, matchKey from primary email", async () => {
  const a = await db.create(ctx(), "contacts", { name: "Haylee", emails: ["Haylee@LostLake.example"], phones: ["(303) 555-1212"] });
  const d = (await db.get("contacts", a.id))!;
  assert.deepEqual(d.emails, ["haylee@lostlake.example"]);
  assert.deepEqual(d.phones, ["+13035551212"]);
  assert.equal(d.matchKey, "haylee@lostlake.example");
  const b = await db.create(ctx(), "contacts", { name: "H. Jackson", emails: ["haylee@lostlake.example"], phones: [] });
  assert.equal(b.id, a.id);
});

test("ledger is append-only and corrections need reversesId", async () => {
  const entry = { date: "2026-10-01", kind: "income", amount: 30000, category: "guarantee", method: "check" };
  const { id } = await db.create(ctx(), "ledger", entry);
  await assert.rejects(db.update(ctx(), "ledger", id, { amount: 1 }), (e: AppError) => e.code === "immutable");
  await assert.rejects(db.softDelete(ctx(), "ledger", id), (e: AppError) => e.code === "immutable");
  await assert.rejects(db.create(ctx(), "ledger", { ...entry, kind: "correction" }), (e: AppError) => e.code === "invalid_input");
  await db.create(ctx(), "ledger", { ...entry, kind: "correction", reversesId: id });
});

test("setlist totalSec is computed", async () => {
  const { id } = await db.create(ctx(), "setlists", {
    name: "Hi-Dive 45", items: [{ type: "song", title: "A", lengthSec: 200 }, { type: "break", title: "Break" }, { type: "song", title: "B", lengthSec: 100 }],
  });
  assert.equal((await db.get("setlists", id))!.totalSec, 300);
});

test("explicit id and sub-collections", async () => {
  await db.create(ctx(), "showDeals", { contactIds: [], deal: "free", settled: false }, { id: "show1" });
  await assert.rejects(db.create(ctx(), "showDeals", { contactIds: [], deal: "free", settled: false }, { id: "show1" }), (e: AppError) => e.code === "already_exists");
  const { id } = await db.create(ctx(), "pitches/p1/comments", { authorId: "u1", body: "hi" });
  assert.ok(await db.get("pitches/p1/comments", id));
  await assert.rejects(db.update(ctx(), "pitches/p1/activity", "x", {}), (e: AppError) => e.code === "immutable");
});

test("a unit of work is atomic and shares one runId", async () => {
  await assert.rejects(run(ctx(), async (w) => {
    await w.create("songs", { title: "One", status: "active" });
    await w.create("songs", { title: "Two", status: "bogus" });
  }));
  assert.equal((await db.list("songs")).length, 0);
  assert.equal((await history()).length, 0);
  await run(ctx(), async (w) => {
    const a = await w.create("songs", { title: "One", status: "active" });
    await w.update("songs", a.id, { bpm: 90 });
  });
  const h = await history();
  assert.equal(h.length, 2);
  assert.ok(h.every((x) => x.runId === "run-1"));
});

test("denormalization: renaming a venue/song/festival refreshes copies", async () => {
  const v = await db.create(ctx(), "venues", venue("Lost Lake"));
  const show = await db.create(ctx(), "shows", {
    date: "2027-01-16", status: "confirmed", venue: { id: v.id, name: "Lost Lake", city: "Denver" }, times: {}, artistId: "a1", personnel: [],
    sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false }, checklist: [], gear: [], docs: [], public: false, listings: {},
  });
  const pitch = await db.create(ctx(), "pitches", { target: { kind: "venue", id: v.id, name: "Lost Lake" }, status: "idea", artistId: "a1", personnel: [], showIds: [] });
  await db.update(ctx(), "venues", v.id, { name: "Lost Lake Lounge" });
  assert.equal((await db.get("shows", show.id))!.venue.name, "Lost Lake Lounge");
  assert.equal((await db.get("pitches", pitch.id))!.target.name, "Lost Lake Lounge");

  const f = await db.create(ctx(), "festivals", { name: "UMS", type: "festival", region: "denver", contactIds: [] });
  const e = await db.create(ctx(), "editions", { festivalId: f.id, festivalName: "UMS", year: 2027, label: "2027", venueIds: [] });
  const ep = await db.create(ctx(), "pitches", { target: { kind: "edition", id: e.id, name: "UMS 2027" }, status: "idea", artistId: "a1", personnel: [], showIds: [] });
  await db.update(ctx(), "festivals", f.id, { name: "Underground Music Showcase" });
  assert.equal((await db.get("editions", e.id))!.festivalName, "Underground Music Showcase");
  assert.equal((await db.get("pitches", ep.id))!.target.name, "Underground Music Showcase 2027");

  const s = await db.create(ctx(), "songs", { title: "Glass Coast", status: "active", lengthSec: 200 });
  const sl = await db.create(ctx(), "setlists", { name: "S", items: [{ type: "song", songId: s.id, title: "Glass Coast", lengthSec: 200 }] });
  await db.update(ctx(), "songs", s.id, { title: "Glass Coast (Live)", lengthSec: 250 });
  const list = (await db.get("setlists", sl.id))!;
  assert.equal(list.items[0].title, "Glass Coast (Live)");
  assert.equal(list.totalSec, 250);
});
