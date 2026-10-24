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
import { byCategory, byMonth, netOf, indexLedger, owedLines, splitEvenly, totals, type LedgerLike } from "@/lib/money";
import { parseSpotifyCsv, parseStatDate, statsCurrent, statsTemplateFields } from "@/lib/stats";
import { buildTemplateContext, fillTemplate } from "@/lib/booking";
import { resetEmulators, makeUser } from "./helpers";

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
const ledger = () => db.list("ledger") as Promise<Record<string, any>[]>;

beforeEach(async () => {
  await resetEmulators();
  const a = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  ctx = { uid: a.uid, role: "admin", via: "app", runId: newRunId() };
  ids = {};
  for (const k of ["ingrid", "jeff", "david"]) ids[k] = (await db.create(ctx, "musicians", { name: k, instruments: [], active: true })).id;
  const m = await makeUser("david@example.com", "member", { musicianId: ids.david, name: "David" });
  memberUid = m.uid;
  await db.update(ctx, "musicians", ids.david, { userId: m.uid });
  mctx = { uid: m.uid, role: "member", musicianId: ids.david, via: "app", runId: newRunId() };
  const venue = (await db.create(ctx, "venues", { name: "Hi-Dive", type: "bar", address: { city: "Denver", state: "CO" }, region: "denver" })).id;
  showId = (await db.create(ctx, "shows", {
    date: "2026-10-10", status: "played", venue: { id: venue, name: "Hi-Dive" }, times: {}, artistId: "a", personnel: [ids.ingrid, ids.jeff, ids.david],
    sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false }, checklist: [], gear: [], docs: [], public: false, listings: {},
  })).id;
  await db.create(ctx, "showDeals", { contactIds: [], deal: "guarantee", guarantee: 30000, settled: false }, { id: showId });
});

const entry = (o: Record<string, unknown> = {}) => ({ date: "2026-10-10", kind: "expense", amount: 5000, category: "photo", method: "card", ...o });

test("pure: ledger math, corrections, owed, split", () => {
  const l: LedgerLike[] = [
    { id: "a", date: "2026-09-01", kind: "income", amount: 10000, category: "door" },
    { id: "b", date: "2026-10-01", kind: "expense", amount: 3000, category: "gear" },
    { id: "c", date: "2026-10-02", kind: "correction", amount: 3000, category: "gear", reversesId: "b" },
    { id: "d", date: "2026-10-03", kind: "payout", amount: 1000, category: "other" },
  ];
  assert.deepEqual(totals(l), { in: 10000, out: 1000, left: 9000 }); // the reversed expense and its correction cancel
  assert.equal(netOf(l[2], indexLedger(l)), 3000);
  assert.deepEqual(byMonth(l).map((m) => m.key), ["2026-09", "2026-10"]);
  assert.equal(byCategory(l)[0].key, "door");
  assert.deepEqual(splitEvenly(10000, 3), [3334, 3333, 3333]);
  assert.deepEqual(splitEvenly(5, 0), []);
  const owed = owedLines({
    expenses: [{ id: "x1", userId: "u", date: "d", amount: 500, category: "gear", what: "w" }, { id: "x2", userId: "u", date: "d", amount: 700, category: "gear", what: "w" }],
    ledger: [{ id: "r", date: "d", kind: "reimbursement", amount: 700, category: "gear", expenseId: "x2" }],
    deals: [{ id: "s1", owedPayouts: [{ musicianId: "m1", amount: 2000 }] }],
  });
  assert.deepEqual(owed.map((o) => [o.key, o.amount]), [["e-x1", 500], ["p-s1-m1", 2000]]);
});

test("ledger entries are never edited or deleted", async () => {
  const { id } = await cmd("ledger.record", entry());
  await assert.rejects(db.update(ctx, "ledger", id, { amount: 1 }), (e: AppError) => e.code === "immutable");
  await assert.rejects(db.softDelete(ctx, "ledger", id), (e: AppError) => e.code === "immutable");
  await assert.rejects(db.merge(ctx, "ledger", id, { memo: "x" }), (e: AppError) => e.code === "immutable");
  assert.equal(((await db.get("ledger", id)) as any).amount, 5000);
  const names = Object.keys(registry).filter((n) => n.startsWith("ledger."));
  assert.deepEqual(names.sort(), ["ledger.correct", "ledger.record"]); // no update/remove command exists
});

test("corrections: need reversesId, same amount, one per entry, not on corrections", async () => {
  const a = (await cmd("ledger.record", entry())).id;
  // schema: kind correction needs reversesId
  assert.throws(() => registry["ledger.record"].input.parse(entry({ kind: "correction" })));
  // reversesId only with correction
  await assert.rejects(cmd("ledger.record", entry({ reversesId: a })), (e: AppError) => e.code === "invalid_input");
  // unknown target, wrong amount
  await assert.rejects(cmd("ledger.record", entry({ kind: "correction", reversesId: "nope" })), (e: AppError) => e.code === "not_found");
  await assert.rejects(cmd("ledger.record", entry({ kind: "correction", reversesId: a, amount: 1 })), (e: AppError) => e.code === "invalid_input");
  const c = (await cmd("ledger.correct", { reversesId: a })).id;
  const doc = (await db.get("ledger", c)) as any;
  assert.equal(doc.kind, "correction"); assert.equal(doc.reversesId, a); assert.equal(doc.amount, 5000); assert.equal(doc.category, "photo");
  await assert.rejects(cmd("ledger.correct", { reversesId: a }), (e: AppError) => e.code === "already_corrected");
  await assert.rejects(cmd("ledger.correct", { reversesId: c }), (e: AppError) => e.code === "invalid_state");
  assert.equal((await ledger()).length, 2); // original still there
  assert.deepEqual(totals((await ledger()) as LedgerLike[]), { in: 0, out: 0, left: 0 });
});

test("settle show: income, paid and owed payouts, settled flag, all in one transaction", async () => {
  const r = await cmd("shows.settle", {
    id: showId,
    income: [{ category: "guarantee", amount: 30000 }, { category: "merch", amount: 14500 }, { category: "tips", amount: 3800 }, { category: "venmo", amount: 6200 }],
    payouts: [{ musicianId: ids.ingrid, amount: 18000 }, { musicianId: ids.david, amount: 18000 }, { musicianId: ids.jeff, amount: 18500, paid: false }],
  });
  assert.equal(r.in, 54500);
  const rows = await ledger();
  assert.equal(rows.filter((x) => x.kind === "income").length, 4);
  const pays = rows.filter((x) => x.kind === "payout");
  assert.equal(pays.length, 2);
  const dpay = pays.find((p) => p.payeeMusicianId === ids.david)!;
  assert.equal(dpay.payeeUserId, memberUid); // lets David read it
  assert.equal(dpay.showId, showId);
  const deal = (await db.get("showDeals", showId)) as any;
  assert.equal(deal.settled, true);
  assert.deepEqual(deal.owedPayouts, [{ musicianId: ids.jeff, amount: 18500 }]);
  assert.equal(rows.every((x) => x.date === "2026-10-10" || x.kind === "payout"), true);
  await assert.rejects(cmd("shows.settle", { id: showId, income: [{ category: "door", amount: 100 }] }), (e: AppError) => e.code === "already_settled");
  // pay the owed one later
  await cmd("payouts.pay", { showId, musicianId: ids.jeff });
  const owed = owedLines({ expenses: [], ledger: (await ledger()) as LedgerLike[], deals: [deal] });
  assert.equal(owed.length, 0);
  await assert.rejects(cmd("payouts.pay", { showId, musicianId: ids.jeff }), (e: AppError) => e.code === "nothing_owed");
});

test("settle show is atomic: a bad payout leaves no ledger entries and the show unsettled", async () => {
  await assert.rejects(cmd("shows.settle", {
    id: showId, income: [{ category: "door", amount: 10000 }, { category: "tips", amount: 500 }],
    payouts: [{ musicianId: ids.ingrid, amount: 5000 }, { musicianId: "ghost", amount: 1000 }],
  }), (e: AppError) => e.code === "not_found");
  assert.equal((await ledger()).length, 0);
  assert.equal(((await db.get("showDeals", showId)) as any).settled, false);
  await assert.rejects(cmd("shows.settle", { id: showId, income: [{ category: "door", amount: 100 }], payouts: [{ musicianId: ids.ingrid, amount: 200 }] }), (e: AppError) => e.code === "over_allocated");
  assert.equal((await ledger()).length, 0);
  await assert.rejects(cmd("shows.settle", { id: "missing", income: [{ category: "door", amount: 100 }] }), (e: AppError) => e.code === "not_found");
});

test("expenses: member adds their own; admin reimburses once; correction reopens it", async () => {
  await assert.rejects(registry["expenses.add"].run(mctx, registry["expenses.add"].input.parse({ amount: 100, what: "x", category: "gear", userId: "someone-else" })), (e: AppError) => e.code === "forbidden");
  const { id } = await cmd("expenses.add", { amount: 6400, what: "Drum heads", category: "gear", showId, receipt: { driveFileId: "f1", url: "https://drive.google.com/file/d/f1/view" } }, mctx);
  const x = (await db.get("expenses", id)) as any;
  assert.equal(x.userId, memberUid);
  assert.equal(registry["expenses.reimburse"].roles.includes("member"), false);
  const r = await cmd("expenses.reimburse", { id });
  const led = (await db.get("ledger", r.id)) as any;
  assert.equal(led.kind, "reimbursement"); assert.equal(led.expenseId, id); assert.equal(led.payeeUserId, memberUid); assert.equal(led.amount, 6400);
  await assert.rejects(cmd("expenses.reimburse", { id }), (e: AppError) => e.code === "already_reimbursed");
  await cmd("ledger.correct", { reversesId: r.id });
  const again = await cmd("expenses.reimburse", { id }); // reversed, so it is owed again
  assert.ok(again.id);
});

test("receipts.search finds files in the fake Drive; members may call it", async () => {
  assert.ok(registry["receipts.search"].roles.includes("member"));
  const r = await cmd("receipts.search", { q: "Glass" }, mctx);
  assert.ok(r.files.length > 0 && r.files[0].url);
});

test("csv parsing: monthly rows, quotes, thousands separators, bad lines", () => {
  const ok = parseSpotifyCsv('﻿Date,Listeners,Streams,Followers\r\n2026-09,"2,460","11,220",1821\r\n2026-10,2310,10870,\r\n"Aug 2026",2105,9380,1779\r\n');
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.rows, [
    { date: "2026-08-31", monthlyListeners: 2105, streams: 9380, followers: 1779 },
    { date: "2026-09-30", monthlyListeners: 2460, streams: 11220, followers: 1821 },
    { date: "2026-10-31", monthlyListeners: 2310, streams: 10870 },
  ]);
  assert.equal(parseStatDate("2028-02"), "2028-02-29");
  assert.equal(parseStatDate("3/15/2026"), "2026-03-15");
  assert.equal(parseStatDate("2026-13-01"), null);
  const bad = parseSpotifyCsv("date,listeners\nsoon,5\n2026-09,abc\n");
  assert.equal(bad.rows.length, 0);
  assert.equal(bad.errors.length, 2);
  assert.match(parseSpotifyCsv("a,b\n1,2").errors[0], /date column/);
  assert.match(parseSpotifyCsv("date,color\n2026-01,red").errors[0], /No numbers/);
  const fixture = parseSpotifyCsv(fs.readFileSync(path.join(process.cwd(), "fixtures/spotify-for-artists-sample.csv"), "utf8"));
  assert.deepEqual(fixture.errors, []);
  assert.equal(fixture.rows.length, 6);
});

test("stats: daily pull is idempotent, CSV import writes snapshots, current + template fields", async () => {
  const p1 = await cmd("stats.pull", {});
  assert.deepEqual(p1.written, [`spotifyApi_${p1.date}`]);
  const snap = (await db.get("statSnapshots", `spotifyApi_${p1.date}`)) as any;
  assert.equal(snap.source, "spotifyApi"); assert.ok(snap.followers > 0); assert.ok(snap.topTracks.length > 0);
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
  for (const n of ["ledger.record", "ledger.correct", "shows.settle", "payouts.pay", "expenses.reimburse", "stats.pull", "stats.importCsv", "stats.current"]) {
    assert.equal(registry[n].roles.includes("member"), false, n);
  }
});
