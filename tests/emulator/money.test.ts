import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { AppError } from "@/server/errors";
import { undoRun } from "@/server/undo";
import { statsCurrent, statsTemplateFields } from "@/lib/stats";
import { buildTemplateContext, fillTemplate } from "@/lib/booking";
import { resetEmulators, makeUser, makeArtist } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx, mctx: Ctx;
let ids: Record<string, string>;
let showId: string;
let memberUid: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.SPOTIFY_BASE_URL = s.running["fake-spotify"].url;
  process.env.DRIVE_BASE_URL = s.running["fake-drive"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};
beforeEach(async () => {
  await resetEmulators();
  await makeArtist("Test Band", "test-band", "a"); // money needs an artist: every expense lands on a project
  const a = await makeUser("rudy@example.com", "admin", { name: "Rudy" });
  ctx = { uid: a.uid, role: "admin", via: "app", runId: newRunId() };
  ids = {};
  for (const k of ["nora", "rudy", "hugo"]) ids[k] = (await db.create(ctx, "musicians", { name: k, instruments: [], active: true })).id;
  const m = await makeUser("hugo@example.com", "member", { musicianId: ids.hugo, name: "Hugo" });
  memberUid = m.uid;
  await db.update(ctx, "musicians", ids.hugo, { userId: m.uid });
  mctx = { uid: m.uid, role: "member", musicianId: ids.hugo, via: "app", runId: newRunId() };
  const venue = (await db.create(ctx, "venues", { name: "Deep End", type: "bar", address: { city: "Denver", state: "CO" }, region: "denver" })).id;
  showId = (await db.create(ctx, "shows", {
    date: "2026-10-10", status: "played", venue: { id: venue, name: "Deep End" }, times: {}, artistId: "a", personnel: [ids.nora, ids.rudy, ids.hugo],
    sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false }, checklists: [], docs: [],
  })).id;
  await db.create(ctx, "showDeals", { contactIds: [], deal: "guarantee" }, { id: showId });
});

const totalsNow = async () => { const t = ((await db.get("showDeals", showId)) as any).totals; return t && { income: t.income, expenses: t.expenses }; };

test("expenses: members add, fix and remove their own until paid back; admins mark paid back", async () => {
  await assert.rejects(registry["expenses.add"].run(mctx, registry["expenses.add"].input.parse({ amount: 100, what: "x", category: "gear", userId: "someone-else" })), (e: AppError) => e.code === "forbidden");
  const { id } = await cmd("expenses.add", { amount: 6400, what: "Drum heads", category: "gear", showId, receipt: { driveFileId: "f1", url: "https://drive.google.com/file/d/f1/view" } }, mctx);
  assert.equal(((await db.get("expenses", id)) as any).userId, memberUid);
  assert.deepEqual(await totalsNow(), { income: 0, expenses: 6400 });
  await cmd("expenses.update", { id, patch: { amount: 7000, receipt: null } }, mctx);
  const after = (await db.get("expenses", id)) as any;
  assert.equal(after.amount, 7000); assert.equal(after.receipt, undefined);
  assert.deepEqual(await totalsNow(), { income: 0, expenses: 7000 });
  const theirs = await cmd("expenses.add", { amount: 500, what: "Strings", category: "gear" });
  await assert.rejects(cmd("expenses.update", { id: theirs.id, patch: { amount: 1 } }, mctx), (e: AppError) => e.code === "forbidden");
  await assert.rejects(cmd("expenses.remove", { id: theirs.id }, mctx), (e: AppError) => e.code === "forbidden");
  assert.equal(registry["expenses.setPaidBack"].roles.includes("member"), false);
  await cmd("expenses.setPaidBack", { id, paid: true });
  const paid = (await db.get("expenses", id)) as any;
  assert.ok(paid.paidBackAt); assert.equal(paid.paidBackBy, ctx.uid);
  await assert.rejects(cmd("expenses.update", { id, patch: { amount: 1 } }, mctx), (e: AppError) => e.code === "paid_back");
  await assert.rejects(cmd("expenses.remove", { id }, ctx), (e: AppError) => e.code === "paid_back");
  await cmd("expenses.setPaidBack", { id, paid: false });
  assert.equal(((await db.get("expenses", id)) as any).paidBackAt, undefined);
  await cmd("expenses.remove", { id }, mctx);
  assert.ok(((await db.get("expenses", id)) as any).deletedAt);
  assert.deepEqual(await totalsNow(), { income: 0, expenses: 0 });
});

test("shows.setExpenses: adds, updates and removes the caller's lines; leaves others' and paid-back ones alone", async () => {
  const mine = await cmd("expenses.add", { amount: 1000, what: "Gas", category: "travel", showId }, mctx);
  const admins = await cmd("expenses.add", { amount: 2000, what: "Food", category: "other", showId });
  // the member sees only their own: changing it, adding one, and not touching the admin's
  const r = await cmd("shows.setExpenses", { id: showId, lines: [{ id: mine.id, what: "Gas (both ways)", amount: 1500, payBack: true }, { what: "Strings", amount: 1499, payBack: true }] }, mctx);
  assert.deepEqual(r.updated, [mine.id]); assert.equal(r.added.length, 1); assert.deepEqual(r.removed, []);
  const added = (await db.get("expenses", r.added[0])) as any;
  assert.equal(added.userId, memberUid); assert.equal(added.showId, showId);
  assert.equal(((await db.get("expenses", admins.id)) as any).deletedAt, null);
  await assert.rejects(cmd("shows.setExpenses", { id: showId, lines: [{ what: "x", amount: 1, payBack: true, userId: ctx.uid }] }, mctx), (e: AppError) => e.code === "forbidden");
  // dropping a line removes it
  await cmd("shows.setExpenses", { id: showId, lines: [{ id: mine.id, what: "Gas (both ways)", amount: 1500, payBack: true }] }, mctx);
  assert.ok(((await db.get("expenses", r.added[0])) as any).deletedAt);
  assert.deepEqual(await totalsNow(), { income: 0, expenses: 3500 });
  // a paid-back line can be sent as it is, but not changed or dropped
  await cmd("expenses.setPaidBack", { id: mine.id, paid: true });
  await cmd("shows.setExpenses", { id: showId, lines: [{ id: mine.id, what: "Gas (both ways)", amount: 1500, payBack: true }] }, mctx);
  await assert.rejects(cmd("shows.setExpenses", { id: showId, lines: [] }, mctx), (e: AppError) => e.code === "paid_back");
});

test("rehearsals.setExpenses: same member/admin split as shows, lines land on the rehearsal and don't touch show totals", async () => {
  const rehearsalId = (await db.create(ctx, "rehearsals", { date: "2026-10-29", personnel: [], songs: [] })).id;
  const mine = await cmd("expenses.add", { amount: 1000, what: "Gas", category: "travel", rehearsalId }, mctx);
  const admins = await cmd("expenses.add", { amount: 2000, what: "Food", category: "other", rehearsalId });
  const r = await cmd("rehearsals.setExpenses", { id: rehearsalId, lines: [{ id: mine.id, what: "Gas (both ways)", amount: 1500, payBack: true }, { what: "Strings", amount: 1499, payBack: true }] }, mctx);
  assert.deepEqual(r.updated, [mine.id]); assert.equal(r.added.length, 1); assert.deepEqual(r.removed, []);
  const added = (await db.get("expenses", r.added[0])) as any;
  assert.equal(added.userId, memberUid); assert.equal(added.rehearsalId, rehearsalId); assert.equal(added.showId, undefined);
  assert.equal(((await db.get("expenses", admins.id)) as any).deletedAt, null);
  await assert.rejects(cmd("rehearsals.setExpenses", { id: rehearsalId, lines: [{ what: "x", amount: 1, payBack: true, userId: ctx.uid }] }, mctx), (e: AppError) => e.code === "forbidden");
  await assert.rejects(cmd("rehearsals.setExpenses", { id: "nope", lines: [] }, mctx), (e: AppError) => e.code === "not_found");
  // an admin sees and can add for anyone; dropping a line removes it
  const ar = await cmd("rehearsals.setExpenses", { id: rehearsalId, lines: [{ id: admins.id, what: "Food", amount: 2000, payBack: true }, { id: mine.id, what: "Gas (both ways)", amount: 1500, payBack: true }, { what: "Pizza", amount: 500, payBack: true, userId: memberUid }] });
  assert.deepEqual(ar.removed, [r.added[0]]); assert.equal(((await db.get("expenses", ar.added[0])) as any).userId, memberUid);
  // a paid-back line can be sent as it is, but not dropped
  await cmd("expenses.setPaidBack", { id: mine.id, paid: true });
  await cmd("rehearsals.setExpenses", { id: rehearsalId, lines: [{ id: mine.id, what: "Gas (both ways)", amount: 1500, payBack: true }] }, mctx);
  await assert.rejects(cmd("rehearsals.setExpenses", { id: rehearsalId, lines: [] }, mctx), (e: AppError) => e.code === "paid_back");
  assert.equal(((await db.get("showDeals", showId)) as any)?.totals?.expenses ?? 0, 0); // rehearsal lines never reach a show's totals
});

test("gas expenses: members can't set the rehearsal location; fixing the amount marks the estimate overridden and keeps it", async () => {
  const rehearsalId = (await db.create(ctx, "rehearsals", { date: "2026-10-29", personnel: [], songs: [] })).id;
  const gas = {
    fromKind: "home", fromText: "742 Evergreen Terrace, Denver, CO, USA", to: { name: "The Attic", address: "2363 Alder St, Denver, CO, USA" }, oneWayMiles: 18.4, roundTrip: true, miles: 36.8, mpg: 28,
    grade: "regular", priceMilli: 3790, priceArea: "Denver", priceWeek: "2026-10-19", seriesId: "Y05DE_EPMR", estimateCents: 498,
  };
  await assert.rejects(
    cmd("expenses.add", { amount: 498, what: "Gas", category: "travel", rehearsalId, gas, setAsRehearsalLocation: { address: "2363 Alder St, Denver, CO", lat: 39.75, lng: -104.99 } }, mctx),
    (e: AppError) => e.code === "forbidden",
  );
  const { id } = await cmd("expenses.add", { amount: 498, what: "Gas", category: "travel", rehearsalId, gas }, mctx);
  let x = (await db.get("expenses", id)) as any;
  assert.equal(x.rehearsalId, rehearsalId);
  assert.equal(x.gas.overridden, false);
  await cmd("expenses.update", { id, patch: { amount: 600 } }, mctx);
  x = (await db.get("expenses", id)) as any;
  assert.equal(x.amount, 600);
  assert.equal(x.gas.overridden, true);
  assert.equal(x.gas.estimateCents, 498);
});

test("receipts.search finds files in the fake Drive; members may call it", async () => {
  assert.ok(registry["receipts.search"].roles.includes("member"));
  const r = await cmd("receipts.search", { q: "Glass" }, mctx);
  assert.ok(r.files.length > 0 && r.files[0].url);
});

test("stats: daily pull is idempotent, CSV import writes snapshots, current + template fields", async () => {
  const p1 = await cmd("stats.pull", {});
  assert.deepEqual(p1.written, [`spotifyApi_${p1.date}`]);
  const snap = (await db.get("statSnapshots", `spotifyApi_${p1.date}`)) as any;
  assert.equal(snap.source, "spotifyApi"); assert.ok(snap.followers > 0);
  const p2 = await cmd("stats.pull", {});
  assert.deepEqual(p2.skipped, [`spotifyApi_${p1.date}`]);
  await assert.rejects(db.update(ctx, "statSnapshots", snap.id, { followers: 1 }), (e: AppError) => e.code === "immutable");

  const csv = fs.readFileSync(path.join(process.cwd(), "fixtures/spotify-for-artists-sample.csv"), "utf8");
  const i1 = await cmd("stats.importCsv", { csv });
  assert.equal(i1.written.length, 6);
  assert.ok(await db.get("statSnapshots", "spotifyForArtists_2026-09-30"));
  const i2 = await cmd("stats.importCsv", { csv });
  assert.equal(i2.skipped.length, 6);
  await assert.rejects(cmd("stats.importCsv", { csv: "date,listeners\nnope,1" }), (e: AppError) => e.code === "invalid_csv");
  assert.equal((await db.list("statSnapshots")).length, 7);

  const cur = await cmd("stats.current", {});
  assert.equal(cur.monthlyListeners.value, 2310);
  assert.equal(cur.monthlyListeners.date, "2026-10-31");
  assert.equal(cur.followers.value > 0, true);
  const fields = statsTemplateFields([{ source: "spotifyApi", date: "2026-10-22", followers: 1852 }, { source: "spotifyForArtists", date: "2026-10-31", monthlyListeners: 12345 }]);
  assert.deepEqual(fields, { "stats.monthlyListeners": "12,345", "stats.followers": "1,852" });
  assert.equal(fillTemplate("{{stats.monthlyListeners}} listeners, {{stats.followers}} followers", buildTemplateContext({ stats: fields })), "12,345 listeners, 1,852 followers");
  assert.equal(statsCurrent([]).followers, undefined);
});

test("members cannot run admin money or stats commands", async () => {
  for (const n of ["expenses.setPaidBack", "expenses.payPerson", "expenses.markPaid", "stats.pull", "stats.importCsv", "stats.current"]) {
    assert.equal(registry[n].roles.includes("member"), false, n);
  }
  for (const n of ["ledger.record", "ledger.correct", "shows.settle", "payouts.pay", "expenses.reimburse"]) assert.equal(registry[n], undefined, n);
});
