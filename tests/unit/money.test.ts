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
import { CATEGORY_LABEL, byCategory, byMonth, byPayer, byProject, byShow, incomeExpected, incomeSoFar, moneyRows, openBills, owedExpenses, owedToUs, parseDollars, projectTotals, showTotals, splitEvenly, totals, weOwe, type ExpenseLike, type IncomeLike, type PayoutLike } from "@/lib/money";
import { undoRun } from "@/server/undo";
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
    sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false }, checklists: [], docs: [], listings: {},
  })).id;
  await db.create(ctx, "showDeals", { contactIds: [], deal: "guarantee" }, { id: showId });
});

const totalsNow = async () => { const t = ((await db.get("showDeals", showId)) as any).totals; return t && { income: t.income, expenses: t.expenses }; };
const x = (o: Partial<ExpenseLike>): ExpenseLike => ({ id: "x", userId: "u", date: "2026-10-10", amount: 100, category: "other", what: "x", ...o });

const inc = (o: Partial<IncomeLike>): IncomeLike => ({ id: "i", date: "2026-10-10", amount: 1000, category: "guarantee", from: "Hi-Dive", projectId: "band", ...o });
const pay = (o: Partial<PayoutLike>): PayoutLike => ({ id: "p", to: { name: "Sam" }, kind: "pay", amount: 500, projectId: "band", ...o });
const owe = (payouts: PayoutLike[], expenses: ExpenseLike[]) =>
  weOwe({ payouts, expenses, musicianUserId: (m) => (m === "m1" ? "u1" : undefined), personName: (u) => `User ${u}` });

test("pure: totals, owed, charts, split, dollars", () => {
  const rows = moneyRows({
    income: [inc({ id: "a", amount: 30000, showId: "s1", receivedAt: "2026-10-10" }), inc({ id: "b", amount: 4000, category: "tips", projectId: "tour" }), inc({ id: "c", amount: 1, receivedAt: "2026-10-10", deletedAt: new Date() })],
    expenses: [x({ id: "e1", amount: 2500, showId: "s1", date: "2026-11-02", category: "travel" }), x({ id: "e2", amount: 900, deletedAt: new Date() }), x({ id: "e3", amount: 50, owed: true, to: { name: "Doghouse" } })],
    payouts: [pay({ id: "p1", amount: 8000, showId: "s1", paidAt: "2026-10-11", paidBy: "u1" }), pay({ id: "p2", amount: 700, dueDate: "2026-12-01" }), pay({ id: "p3", amount: 1 }), pay({ id: "r", kind: "reimbursement", amount: 2500, paidAt: "2026-11-03", paidBy: "u1" })],
  });
  // only money that moved: owed income, an open bill, unpaid payouts and a reimbursement (a transfer) have no row
  assert.deepEqual(totals(rows), { in: 30000, out: 10500, left: 19500 });
  assert.deepEqual(rows.map((r) => r.kind), ["income", "expense", "payout"]);
  assert.deepEqual(byMonth(rows).map((r) => [r.key, r.net]), [["2026-10", 22000], ["2026-11", -2500]]);
  assert.equal(byCategory(rows)[0].key, "guarantee");
  assert.equal(byCategory(rows).find((r) => r.key === "payout")?.out, 8000); assert.equal(CATEGORY_LABEL.payout, "Paid out");
  assert.deepEqual(byShow(rows).map((r) => [r.key, r.net]), [["s1", 19500]]);
  assert.deepEqual(byProject(rows).map((r) => [r.key, r.net]), [["band", 22000]]); // the expense has no projectId, so it is not grouped
  assert.deepEqual(byPayer(rows).map((r) => [r.key, r.out]), [["u1", 8000], ["u", 2500]]); // whose pocket: the payout's paidBy, the expense's userId
  assert.deepEqual(owedExpenses([x({ id: "o" }), x({ id: "p", paidBackAt: "2026-10-11" }), x({ id: "q", payBack: false }), x({ id: "r", deletedAt: new Date() }), x({ id: "s", owed: true })]).map((e) => e.id), ["o"]);
  assert.deepEqual(openBills([x({ id: "o" }), x({ id: "s", owed: true }), x({ id: "t", owed: true, deletedAt: new Date() })]).map((e) => e.id), ["s"]);
  assert.deepEqual(showTotals({ income: [{ amount: 30000 }, { amount: 500 }], payouts: [{ amount: 8000 }], expenses: [{ amount: 6400 }, { amount: 100, deletedAt: new Date() }] }), { income: 30500, paidOut: 8000, expenses: 6400, net: 16100 });
  assert.deepEqual(splitEvenly(1000, 3), [334, 333, 333]);
  assert.equal(parseDollars("$1,234.50"), 123450); assert.equal(parseDollars("12"), 1200); assert.equal(parseDollars("1.2.3"), null); assert.equal(parseDollars("-4"), null);
});

test("pure: weOwe groups by person, bills included; paid payouts, payBack false and paid-back expenses owe nothing", () => {
  const g = owe(
    [
      pay({ id: "p1", to: { musicianId: "m1", name: "Maya" }, amount: 3000, dueDate: "2026-10-05", what: "Lost Lake pay" }),
      pay({ id: "p2", to: { musicianId: "m1", name: "Maya" }, amount: 999, paidAt: "2026-10-06" }),
      pay({ id: "p3", to: { musicianId: "m2", name: "Noel" }, amount: 1000 }),
      pay({ id: "p4", to: { contactId: "c1", name: "Venue Guy" }, amount: 200, kind: "split" }),
      pay({ id: "p5", to: { name: "Other Band" }, amount: 300, kind: "split", deletedAt: new Date() }),
      pay({ id: "p6", to: { name: "Other Band" }, amount: 400, kind: "split" }),
    ],
    [
      x({ id: "e1", userId: "u1", amount: 2000, date: "2026-10-01" }), x({ id: "e2", userId: "u1", amount: 50, payBack: false }), x({ id: "e3", userId: "u1", amount: 60, paidBackAt: "2026-10-02" }), x({ id: "e4", userId: "u3", amount: 100 }),
      // bills: one owed to Maya (grouped with her user through the musician), one with nobody named (its own group)
      x({ id: "b1", userId: "u9", amount: 450, owed: true, to: { musicianId: "m1", name: "Maya" } }), x({ id: "b2", userId: "u9", amount: 75, owed: true, what: "Parking" }),
    ],
  );
  assert.deepEqual(g.map((r) => [r.key, r.total]), [["user:u1", 5450], ["musician:m2", 1000], ["name:Other Band", 400], ["contact:c1", 200], ["user:u3", 100], ["name:Parking", 75]]);
  assert.deepEqual(g[0].items.map((i) => [i.kind, i.id]), [["expense", "e1"], ["payout", "p1"], ["bill", "b1"]]); // oldest first
  assert.equal(g[0].items[0].date, "2026-10-01");
  assert.equal(g[0].name, "Maya"); assert.equal(g[0].userId, "u1"); assert.equal(g[4].name, "User u3");
  assert.equal(g[1].items[0].what, "Pay for playing"); assert.equal(g[3].items[0].payoutKind, "split");
});

test("pure: a paid reimbursement clears exactly the expenses it lists", () => {
  const es = [x({ id: "e1", userId: "u1", amount: 700 }), x({ id: "e2", userId: "u1", amount: 300 })];
  const reimb = pay({ id: "r", to: { userId: "u1", name: "Jeff" }, kind: "reimbursement", amount: 700, expenseIds: ["e1"], paidAt: "2026-10-12" });
  // what the command does when the reimbursement is paid: each listed expense gets paidBackAt + reimbursedBy
  const after = es.map((e) => (reimb.expenseIds!.includes(e.id) ? { ...e, paidBackAt: reimb.paidAt, reimbursedBy: reimb.id } : e));
  assert.deepEqual(owe([reimb], after).map((r) => [r.key, r.total, r.items.map((i) => i.id)]), [["user:u1", 300, ["e2"]]]);
  // the same reimbursement still unpaid: the expenses it hasn't cleared are what's owed; the reimbursement itself repays them, so it adds nothing
  const open = owe([{ ...reimb, paidAt: undefined }], es);
  assert.equal(open[0].total, 700 + 300);
});

test("pure: incomeSoFar drops unreceived income dated after today (an upcoming show's guarantee)", () => {
  const rows = [inc({ id: "future", date: "2026-12-01" }), inc({ id: "future-paid", date: "2026-12-01", receivedAt: "2026-10-01" }), inc({ id: "today", date: "2026-10-29" }), inc({ id: "past", date: "2026-09-01" })];
  assert.deepEqual(incomeSoFar(rows, "2026-10-29").map((x) => x.id), ["future-paid", "today", "past"]);
  // and incomeExpected is exactly what it dropped
  const exp = incomeExpected([...rows, inc({ id: "gone", date: "2026-12-02", deletedAt: new Date() })], "2026-10-29");
  assert.deepEqual([exp.items.map((x) => x.id), exp.total], [["future"], 1000]);
});

test("pure: owedToUs lists unreceived live income, oldest first", () => {
  const r = owedToUs({ income: [inc({ id: "a", date: "2026-10-20", amount: 500 }), inc({ id: "b", date: "2026-09-01", amount: 700 }), inc({ id: "c", receivedAt: "2026-10-11" }), inc({ id: "d", deletedAt: new Date() })] });
  assert.deepEqual(r.items.map((i) => i.id), ["b", "a"]); assert.equal(r.total, 1200);
});

test("pure: projectTotals keeps paid and owed apart, counts a payBack:false expense once, and takes the default project's unmarked records", () => {
  const i = {
    income: [inc({ id: "a", amount: 30000, showId: "s1", receivedAt: "2026-10-10" }), inc({ id: "b", amount: 4000 }), inc({ id: "c", amount: 999, projectId: "tour" }), inc({ id: "d", amount: 5, deletedAt: new Date() })],
    payouts: [pay({ id: "p1", amount: 8000, paidAt: "2026-10-11" }), pay({ id: "p2", amount: 1000 }), pay({ id: "p3", amount: 77, projectId: "tour" }), pay({ id: "r", kind: "reimbursement", amount: 300, paidAt: "2026-10-12" })],
    expenses: [x({ id: "e1", amount: 2000 }), x({ id: "e2", amount: 500, payBack: false }), x({ id: "e3", amount: 300, paidBackAt: "2026-10-12" }), x({ id: "e4", amount: 40, projectId: "tour" }), x({ id: "e5", amount: 9, deletedAt: new Date() }), x({ id: "e6", amount: 150, owed: true, to: { name: "Doghouse" } })],
  };
  // in: 30000 received, 4000 owed. out paid: expenses 2800 (whoever paid; the reimbursement is a transfer) + 8000 paid payout. out owed: the 150 bill + the 1000 payout.
  // weOwe adds the 2000 pay-back still owed to its member (already spent, so not in outOwed).
  assert.deepEqual(projectTotals({ projectId: "band", defaultProjectId: "band", ...i }), {
    inReceived: 30000, inOwed: 4000, outPaid: 10800, outOwed: 1150, net: 30000 - 10800, netIfSettled: 34000 - 10800 - 1150, weOwe: 1150 + 2000,
  });
  // records with no projectId belong to the default project
  const loose = { income: [{ ...inc({ amount: 100 }), projectId: undefined } as unknown as IncomeLike], payouts: [], expenses: [x({ amount: 40 })] };
  assert.deepEqual([projectTotals({ projectId: "band", defaultProjectId: "band", ...loose }).net, projectTotals({ projectId: "band", defaultProjectId: "band", ...loose }).netIfSettled], [-40, 60]);
  assert.equal(projectTotals({ projectId: "tour", defaultProjectId: "band", ...loose }).net, 0);
  // a show's records, through showTotals
  const onShow = { income: i.income.filter((r) => r.showId === "s1"), payouts: [], expenses: [] };
  assert.deepEqual(showTotals(onShow), { income: 30000, paidOut: 0, expenses: 0, net: 30000 });
});

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
    fromKind: "home", to: { name: "The Loft" }, oneWayMiles: 18.4, roundTrip: true, miles: 36.8, mpg: 28,
    grade: "regular", priceMilli: 3790, priceArea: "Denver", priceWeek: "2026-10-19", seriesId: "Y05DE_EPMR", estimateCents: 498,
  };
  await assert.rejects(
    cmd("expenses.add", { amount: 498, what: "Gas", category: "travel", rehearsalId, gas, setAsRehearsalLocation: { address: "2363 Champa St, Denver, CO", lat: 39.75, lng: -104.99 } }, mctx),
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
  for (const n of ["expenses.setPaidBack", "expenses.payPerson", "expenses.markPaid", "stats.pull", "stats.importCsv", "stats.current"]) {
    assert.equal(registry[n].roles.includes("member"), false, n);
  }
  for (const n of ["ledger.record", "ledger.correct", "shows.settle", "payouts.pay", "expenses.reimburse"]) assert.equal(registry[n], undefined, n);
});
