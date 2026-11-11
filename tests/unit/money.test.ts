// Money maths (totals, owed, charts, splits), Spotify CSV parsing (no emulator).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CATEGORY_LABEL, byCategory, byMonth, byPayer, byProject, byShow, incomeExpected, incomeSoFar, moneyRows, openBills, owedExpenses, owedToUs, parseDollars, projectTotals, showTotals, splitEvenly, totals, weOwe, type ExpenseLike, type IncomeLike, type PayoutLike } from "@/lib/money";
import { parseSpotifyCsv, parseStatDate } from "@/lib/stats";

const x = (o: Partial<ExpenseLike>): ExpenseLike => ({ id: "x", userId: "u", date: "2026-10-10", amount: 100, category: "other", what: "x", ...o });

const inc = (o: Partial<IncomeLike>): IncomeLike => ({ id: "i", date: "2026-10-10", amount: 1000, category: "guarantee", from: "Deep End", projectId: "band", ...o });
const pay = (o: Partial<PayoutLike>): PayoutLike => ({ id: "p", to: { name: "Sam" }, kind: "pay", amount: 500, projectId: "band", ...o });
const owe = (payouts: PayoutLike[], expenses: ExpenseLike[]) =>
  weOwe({ payouts, expenses, musicianUserId: (m) => (m === "m1" ? "u1" : undefined), personName: (u) => `User ${u}` });

test("pure: totals, owed, charts, split, dollars", () => {
  const rows = moneyRows({
    income: [inc({ id: "a", amount: 30000, showId: "s1", receivedAt: "2026-10-10" }), inc({ id: "b", amount: 4000, category: "tips", projectId: "tour" }), inc({ id: "c", amount: 1, receivedAt: "2026-10-10", deletedAt: new Date() })],
    expenses: [x({ id: "e1", amount: 2500, showId: "s1", date: "2026-11-02", category: "travel" }), x({ id: "e2", amount: 900, deletedAt: new Date() }), x({ id: "e3", amount: 50, owed: true, to: { name: "Woodshed" } })],
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
      pay({ id: "p1", to: { musicianId: "m1", name: "Maya" }, amount: 3000, dueDate: "2026-10-05", what: "Pine Hollow pay" }),
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
  const reimb = pay({ id: "r", to: { userId: "u1", name: "Rudy" }, kind: "reimbursement", amount: 700, expenseIds: ["e1"], paidAt: "2026-10-12" });
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
    expenses: [x({ id: "e1", amount: 2000 }), x({ id: "e2", amount: 500, payBack: false }), x({ id: "e3", amount: 300, paidBackAt: "2026-10-12" }), x({ id: "e4", amount: 40, projectId: "tour" }), x({ id: "e5", amount: 9, deletedAt: new Date() }), x({ id: "e6", amount: 150, owed: true, to: { name: "Woodshed" } })],
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
