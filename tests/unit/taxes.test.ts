// The yearly tax worksheet (src/lib/taxes.ts) and the by-year / by-receiver breakdowns (no emulator).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerOf, defaultTaxYear, moneyYears, necThreshold, taxLineOf, taxReport, unassignedIncome, type TaxExpense, type TaxIncome } from "@/lib/taxes";
import { byReceiver, byYear, moneyRows, type PayoutLike } from "@/lib/money";

const inc = (o: Partial<TaxIncome>): TaxIncome => ({ id: "i", date: "2025-03-01", amount: 1000, category: "guarantee", from: "Deep End", projectId: "band", receivedAt: "2025-03-01", receivedBy: "rudy", ...o });
const x = (o: Partial<TaxExpense>): TaxExpense => ({ id: "x", userId: "rudy", date: "2025-04-01", amount: 100, category: "other", what: "x", ...o });
const pay = (o: Partial<PayoutLike>): PayoutLike => ({ id: "p", to: { name: "Sam" }, kind: "pay", amount: 500, projectId: "band", paidAt: "2025-05-01", paidBy: "rudy", ...o });

test("income: received in the year, by whoever received it, cash vs everything else", () => {
  const r = taxReport({ year: 2025, uid: "rudy", payouts: [], expenses: [], income: [
    inc({ id: "a", amount: 30000, method: "cash" }),
    inc({ id: "b", amount: 20000, method: "check" }),
    inc({ id: "c", amount: 5000, method: "venmo", category: "merch" }),
    inc({ id: "d", amount: 700 }), // no method
    inc({ id: "e", amount: 9999, receivedBy: "ingrid" }), // someone else's
    inc({ id: "f", amount: 9999, receivedAt: undefined }), // still owed
    inc({ id: "g", amount: 9999, date: "2024-12-30", receivedAt: "2026-01-02" }), // received next year
    inc({ id: "h", amount: 9999, deletedAt: new Date() }),
  ] });
  assert.equal(r.income.cash, 30000);
  assert.equal(r.income.nonCash, 25700);
  assert.equal(r.income.gross, 55700);
  assert.deepEqual(r.income.byMethod, [{ method: "check", amount: 20000 }, { method: "venmo", amount: 5000 }, { method: "unknown", amount: 700 }]);
  assert.deepEqual(r.income.byCategory.map((c) => c.category), ["guarantee", "merch"]);
  assert.deepEqual(r.income.entries.map((e) => e.id).sort(), ["a", "b", "c", "d"]);
});

test("expenses: Schedule C lines, meals at 50%, whoever's money it finally was, open bills never", () => {
  const payouts = [pay({ id: "reimb", kind: "reimbursement", amount: 4000, paidBy: "rudy", expenseIds: ["m1"] })];
  const r = taxReport({ year: 2025, uid: "rudy", income: [], payouts, expenses: [
    x({ id: "g1", category: "gas", amount: 3000, gas: { miles: 120 } }),
    x({ id: "f1", category: "food", amount: 2001 }),
    x({ id: "ad", category: "marketing", amount: 500 }),
    x({ id: "gear", category: "gear", amount: 25000 }),
    x({ id: "lodge", category: "lodging", amount: 9000 }),
    x({ id: "tr", category: "travel", amount: 1000 }),
    x({ id: "mix", category: "mixing", amount: 15000 }),
    x({ id: "rec", category: "recording", amount: 5000 }),
    x({ id: "bill", category: "space", amount: 7777, owed: true }), // open bill: nobody paid it
    // a member's expense: Rudy paid it back (via the reimbursement payout) so it is his; Ingrid paid back m2 so it's hers; m3 still the member's
    x({ id: "m1", userId: "iris", category: "space", amount: 4000, paidBackAt: "2025-06-01", reimbursedBy: "reimb" }),
    x({ id: "m2", userId: "iris", category: "space", amount: 1111, paidBackAt: "2025-06-01", paidBackBy: "ingrid" }),
    x({ id: "m3", userId: "iris", category: "space", amount: 2222 }),
    x({ id: "old", category: "gear", amount: 1, date: "2024-12-31" }),
  ] });
  const line = (n: string) => r.lines.find((l) => l.line === n)!;
  assert.equal(line("9").amount, 3000);
  assert.equal(line("8").amount, 500);
  assert.equal(line("22").amount, 25000);
  assert.equal(line("24a").amount, 10000);
  assert.equal(line("24b").spent, 2001);
  assert.equal(line("24b").amount, 1001); // 50%, rounded
  assert.equal(line("20b").amount, 4000); // m1 only
  assert.equal(line("27a").amount, 20000);
  assert.equal(line("11").amount, 0); // the reimbursement is a transfer, never labor
  assert.deepEqual(r.partV, [{ category: "mixing", amount: 15000 }, { category: "recording", amount: 5000 }]);
  assert.equal(r.miles, 120);
  assert.equal(r.totalExpenses, 3000 + 500 + 25000 + 10000 + 1001 + 4000 + 20000);
  assert.equal(r.net, -r.totalExpenses);
});

test("contract labor: payouts they paid, never to themselves; 1099-NEC at the year's threshold", () => {
  const r = taxReport({ year: 2026, uid: "rudy", income: [], expenses: [], musicianUserId: (m) => (m === "mRudy" ? "rudy" : undefined), payouts: [
    pay({ id: "a", to: { musicianId: "mSam", name: "Sam" }, amount: 150000, paidAt: "2026-02-01" }),
    pay({ id: "b", to: { musicianId: "mSam", name: "Sam" }, amount: 60000, paidAt: "2026-03-01" }),
    pay({ id: "c", to: { name: "Lou" }, amount: 70000, paidAt: "2026-03-01" }),
    pay({ id: "self", to: { musicianId: "mRudy", name: "Rudy" }, amount: 99999, paidAt: "2026-03-01" }),
    pay({ id: "other", to: { name: "Lou" }, amount: 99999, paidAt: "2026-03-01", paidBy: "ingrid" }),
    pay({ id: "unpaid", to: { name: "Lou" }, amount: 99999, paidAt: undefined }),
  ] });
  assert.equal(r.lines.find((l) => l.key === "labor")!.amount, 280000);
  assert.deepEqual(r.payees.map((p) => [p.name, p.total, p.count, p.over]), [["Sam", 210000, 2, true], ["Lou", 70000, 1, false]]);
  assert.equal(necThreshold(2025), 60000);
  assert.equal(necThreshold(2026), 200000);
});

test("helpers: tax line, bearer, unassigned income, years, default year", () => {
  assert.equal(taxLineOf("gas"), "car"); assert.equal(taxLineOf("pressing"), "other"); assert.equal(taxLineOf("nope"), "other");
  assert.equal(bearerOf(x({ owed: true }), () => undefined), undefined);
  assert.equal(bearerOf(x({ userId: "iris", paidBackAt: "2025-01-01", reimbursedBy: "p" }), () => "ingrid"), "ingrid");
  assert.deepEqual(unassignedIncome([inc({ id: "a", receivedBy: undefined }), inc({ id: "b" }), inc({ id: "c", receivedBy: undefined, receivedAt: undefined })], 2025).map((i) => i.id), ["a"]);
  assert.deepEqual(moneyYears({ income: [inc({})], expenses: [x({ date: "2023-01-01" }), x({ date: "2022-01-01", owed: true })], payouts: [pay({ paidAt: "2024-01-01" })] }, 2026), [2026, 2025, 2024, 2023]);
  assert.equal(defaultTaxYear("2026-03-10"), 2025);
  assert.equal(defaultTaxYear("2026-11-13"), 2026);
});

test("byYear and byReceiver", () => {
  const rows = moneyRows({ income: [inc({ id: "a", amount: 500 }), inc({ id: "b", amount: 300, receivedBy: undefined, date: "2026-01-01", receivedAt: "2026-01-01" })], expenses: [x({ amount: 100, date: "2026-02-01" })], payouts: [] });
  assert.deepEqual(byYear(rows).map((r) => [r.key, r.in, r.out, r.net]), [["2026", 300, 100, 200], ["2025", 500, 0, 500]]);
  assert.deepEqual(byReceiver(rows).map((r) => [r.key, r.in]), [["rudy", 500]]);
});
