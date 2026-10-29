import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { venueNoteId } from "@/schema";
import { firestore } from "@/server/admin";
import { contextNow } from "@/server/assistant/context";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  stop = (await startAll({ dataDir: dir, ephemeral: true })).close;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

let sys: Ctx;
let mcp: Ctx;
let musId: string;
let venueA: string;
let venueB: string;
let showA: string;
let showB: string;

const list = (ctx: Ctx, input: Record<string, unknown>) => registry["records.list"].run(ctx, registry["records.list"].input.parse(input)) as Promise<{ count: number; rows: Record<string, any>[] }>;
const get = (ctx: Ctx, kind: string, id: string) => registry["records.get"].run(ctx, registry["records.get"].input.parse({ kind, id })) as Promise<Record<string, any>>;
const pitch = (target: Record<string, unknown>, status: string, extra: Record<string, unknown> = {}) =>
  db.create(sys, "pitches", { target, status, showIds: [], personnel: [], artistId: TEST_ARTIST, ...extra }).then((r) => r.id);

beforeEach(async () => {
  await resetEmulators();
  const admin = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  sys = { uid: admin.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
  mcp = { ...sys, role: "mcp" };
  musId = (await db.create(sys, "musicians", { name: "Ingrid", instruments: ["vox"], active: true, email: "ingrid@example.com", phone: "555-0100", payHandle: "@ingrid", userId: admin.uid })).id;
  await db.create(sys, "artists", { slug: "ingrid-avison-band", name: "Ingrid Avison Band", driveFolderId: "", links: {}, configurations: [{ id: "trio", name: "Trio", billingName: "Trio", musicianIds: [musId] }] }, { id: TEST_ARTIST });
  venueA = ((await registry["venues.create"].run(sys, registry["venues.create"].input.parse(venue("Hi-Dive")))) as { id: string }).id;
  venueB = ((await registry["venues.create"].run(sys, registry["venues.create"].input.parse(venue("Bluebird")))) as { id: string }).id;
  const mk = async (date: string, venueId: string) => ((await registry["shows.create"].run(sys, registry["shows.create"].input.parse({ date, venueId, status: "hold", times: { loadIn: "19:00", set: "21:15" } }))) as { id: string }).id;
  showA = await mk("2026-11-14", venueA);
  showB = await mk("2026-11-15", venueB);
});

test("musicians are whole for an admin and trimmed through mcp", async () => {
  const full = await get(sys, "musicians", musId);
  assert.equal(full.email, "ingrid@example.com");
  assert.equal(full.phone, "555-0100");
  assert.equal(full.payHandle, "@ingrid");
  assert.ok(full.userId);
  const trim = await get(mcp, "musicians", musId);
  assert.deepEqual(Object.keys(trim).sort(), ["active", "id", "instruments", "name"]);
  const rows = (await list(mcp, { kind: "musicians" })).rows;
  assert.equal(rows[0].email, undefined);
  assert.equal((await list(sys, { kind: "musicians" })).rows[0].email, "ingrid@example.com");
});

test("setlistTemplates are readable", async () => {
  const t = await db.create(sys, "setlistTemplates", { name: "Club 75", items: [] });
  assert.equal((await get(mcp, "setlistTemplates", t.id)).name, "Club 75");
  assert.equal((await list(mcp, { kind: "setlistTemplates" })).count, 1);
});

test("records.list filters: expenses by showId, pitches by status and venueId, shows by venueId", async () => {
  await db.create(sys, "expenses", { showId: showA, userId: "u1", date: "2026-11-14", what: "Gas", category: "travel", amount: 1000 });
  await db.create(sys, "expenses", { showId: showA, userId: "u1", date: "2026-11-14", what: "Snacks", category: "other", amount: 500 });
  await db.create(sys, "expenses", { showId: showB, userId: "u1", date: "2026-11-21", what: "Gas", category: "travel", amount: 700 });
  assert.equal((await list(sys, { kind: "expenses", showId: showA })).count, 2);
  assert.equal((await list(sys, { kind: "expenses", showId: showB })).count, 1);

  const p1 = await pitch({ kind: "venue", id: venueA, name: "Hi-Dive" }, "pitched");
  await pitch({ kind: "venue", id: venueB, name: "Bluebird" }, "pitched");
  await pitch({ kind: "venue", id: venueA, name: "Hi-Dive" }, "declined");
  await pitch({ kind: "promoter", id: venueA, name: "Same id, promoter" }, "pitched");
  assert.equal((await list(sys, { kind: "pitches", status: "declined" })).count, 1);
  assert.equal((await list(sys, { kind: "pitches", venueId: venueA })).count, 2);
  const both = await list(sys, { kind: "pitches", venueId: venueA, status: "pitched" });
  assert.deepEqual(both.rows.map((r) => r.id), [p1]);

  const shows = await list(sys, { kind: "shows", venueId: venueA });
  assert.deepEqual(shows.rows.map((r) => r.id), [showA]);
});

test("records.list missing: counts venues with no city, and fields trims the rows", async () => {
  // The schema requires a city now; older imported rooms can still lack one.
  await firestore().collection("venues").doc("legacy").set({ name: "Old Barn", type: "bar", address: { state: "CO" }, region: "denver", matchKey: "old-barn" });
  const none = await list(sys, { kind: "venues", missing: ["address.city"], limit: 1, fields: ["name"] });
  assert.equal(none.count, 1);
  assert.deepEqual(none.rows, [{ id: "legacy", name: "Old Barn" }]);
  assert.equal((await list(sys, { kind: "venues", missing: ["address.zip"] })).count, 3);
  assert.equal((await list(sys, { kind: "venues", limit: 1 })).count, 3, "count is every match, not the page");
});

test("availability asks filter by showId and pitchId", async () => {
  await db.create(sys, "availability", { showId: showA, date: "2026-11-14", label: "A", askedMusicianIds: [], responses: {}, linkTokens: {} });
  await db.create(sys, "availability", { pitchId: "p1", date: "2026-12-01", label: "B", askedMusicianIds: [], responses: {}, linkTokens: {} });
  assert.equal((await list(sys, { kind: "availability", showId: showA })).rows[0].label, "A");
  assert.equal((await list(sys, { kind: "availability", pitchId: "p1" })).rows[0].label, "B");
});

test("search and needingFollowUp skip another artist's pitches", async () => {
  const mine = await pitch({ kind: "venue", id: venueA, name: "Hi-Dive" }, "pitched", { artistId: TEST_ARTIST, nextStep: { text: "Email", due: "2020-01-01" } });
  const theirs = await pitch({ kind: "venue", id: venueA, name: "Hi-Dive" }, "pitched", { artistId: "other-artist", nextStep: { text: "Email", due: "2020-01-01" } });

  const found = (await registry.search.run(sys, registry.search.input.parse({ q: "Hi-Dive", kinds: ["pitch"] }))) as { results: { id: string }[] };
  assert.deepEqual(found.results.map((r) => r.id).sort(), [mine]);

  const due = (await registry["pitches.needingFollowUp"].run(sys, registry["pitches.needingFollowUp"].input.parse({ today: "2026-10-25" }))) as { pitches: { id: string }[] };
  const ids = due.pitches.map((p) => p.id);
  assert.ok(ids.includes(mine));
  assert.ok(!ids.includes(theirs));
});

test("records.get on a venue says archived when the band hid it", async () => {
  assert.equal((await get(sys, "venues", venueA)).archived, undefined);
  await db.create(sys, "venueNotes", { artistId: TEST_ARTIST, venueId: venueA, contactIds: [], promoterIds: [] }, { id: venueNoteId(TEST_ARTIST, venueA) });
  await db.softDelete(sys, "venueNotes", venueNoteId(TEST_ARTIST, venueA));
  assert.equal((await get(sys, "venues", venueA)).archived, true);
  assert.equal((await get(sys, "venues", venueB)).archived, undefined);
  assert.ok(!(await list(sys, { kind: "venues" })).rows.some((r) => r.id === venueA));
});

test("context.now carries the open projects, what we owe by person and what is owed to us, with ids", async () => {
  // the shows made in setup already needed a home for their money, so the Band default exists (made on first need); seed one only if not
  const band = (await db.list("projects")).find((p) => p.isDefault && !p.deletedAt) ?? { ...await db.create(sys, "projects", { artistId: TEST_ARTIST, kind: "band", name: "Band", status: "open", isDefault: true }), name: "Band" };
  const video = await db.create(sys, "projects", { artistId: TEST_ARTIST, kind: "video", name: "Lighthouse video", status: "open" });
  await db.create(sys, "projects", { artistId: TEST_ARTIST, kind: "release", name: "Old release", status: "closed" });
  const owed = await db.create(sys, "income", { artistId: TEST_ARTIST, date: "2026-11-14", amount: 40000, category: "guarantee", from: "Lost Lake", projectId: band.id, showId: showA });
  await db.create(sys, "income", { artistId: TEST_ARTIST, date: "2026-11-14", amount: 9000, category: "door", from: "Door", projectId: band.id, showId: showA, receivedAt: "2026-11-14" });
  const pay = await db.create(sys, "payouts", { artistId: TEST_ARTIST, to: { musicianId: musId, name: "Ingrid" }, kind: "pay", amount: 10000, projectId: band.id, showId: showA });
  await db.create(sys, "payouts", { artistId: TEST_ARTIST, to: { name: "Dana" }, kind: "pay", amount: 5000, projectId: band.id, paidAt: "2026-11-15" });
  const gas = await db.create(sys, "expenses", { userId: sys.uid, date: "2026-11-14", amount: 4200, category: "travel", what: "gas", payBack: true, projectId: video.id });
  const c = await contextNow({ ...sys, now: new Date("2026-11-16T12:00:00-07:00") }, { uid: sys.uid, name: "Ingrid", role: "admin", musicianId: musId });
  assert.deepEqual(c.projects.map((p) => [p.name, p.kind, p.isDefault]).sort(), [[band.name, "band", true], ["Lighthouse video", "video", false]].sort());
  assert.equal(c.projects.find((p) => p.name === "Lighthouse video")!.id, video.id);
  assert.equal(c.weOwe.length, 1); // the payout and the expense land in one group; the paid one is gone
  assert.equal(c.weOwe[0].name, "Ingrid");
  assert.equal(c.weOwe[0].userId, sys.uid);
  assert.equal(c.weOwe[0].totalCents, 14200);
  assert.deepEqual(c.weOwe[0].items.map((x) => [x.kind, x.id, x.amountCents]).sort(), [["expense", gas.id, 4200], ["payout", pay.id, 10000]]);
  assert.equal(c.owedToUs.totalCents, 40000);
  assert.deepEqual(c.owedToUs.items.map((x) => [x.id, x.from, x.showId]), [[owed.id, "Lost Lake", showA]]);
  assert.deepEqual(c.unsettledShows.map((x) => x.id), []); // showA has income; showB is a hold, not played
});
