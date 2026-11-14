// The Money sheet's two tables (src/lib/moneySheet.ts; no emulator).
import { test } from "node:test";
import assert from "node:assert/strict";
import { moneySheetTables, sheetSerial, spreadsheetIdFrom, INCOME_COLUMNS, EXPENSE_COLUMNS, type MoneySheetInput } from "@/lib/moneySheet";
import type { PayoutLike } from "@/lib/money";

type In = MoneySheetInput["income"][number];
type Ex = MoneySheetInput["expenses"][number];
const inc = (o: Partial<In>): In => ({ id: "i", date: "2026-10-17", amount: 6400, category: "tips", method: "cash", from: "Trident", projectId: "band", showId: "s1", receivedAt: "2026-10-17", receivedBy: "ingrid", ...o });
const x = (o: Partial<Ex>): Ex => ({ id: "x", userId: "ingrid", date: "2026-10-16", amount: 2130, category: "gas", what: "Gas to Jamestown", projectId: "duo", ...o });
const pay = (o: Partial<PayoutLike>): PayoutLike => ({ id: "p", to: { name: "Fresh Fruit" }, kind: "split", amount: 6100, what: "Tip split", projectId: "band", showId: "s1", paidAt: "2026-10-17", paidBy: "ingrid", ...o });
const names: Record<string, string> = { ingrid: "Ingrid", jeff: "Jeff" };
const base = (o: Partial<MoneySheetInput>): MoneySheetInput => ({
  whose: "mine", uid: "ingrid", income: [], expenses: [], payouts: [],
  shows: [{ id: "s1", date: "2026-10-17", name: "Trident" }], projects: [{ id: "band", name: "Band" }, { id: "duo", name: "Duo" }], defaultProjectId: "band",
  personName: (u) => names[u] ?? "Someone", base: "https://app.example/artists/b", ...o,
});
const col = (cols: { name: string }[], row: unknown[], name: string) => row[cols.findIndex((c) => c.name === name)];

test("income: received only, dated when it arrived, cash TRUE/FALSE, blank when no method", () => {
  const t = moneySheetTables(base({ income: [
    inc({ id: "a" }),
    inc({ id: "b", amount: 5740, method: "venmo", receivedAt: "2026-10-20" }),
    inc({ id: "c", method: undefined, receivedAt: "2026-09-02", showId: undefined, from: "Bandcamp", category: "digitalSales" }),
    inc({ id: "d", receivedAt: undefined }), // owed: never sent
    inc({ id: "e", deletedAt: "x" }),
  ] }));
  const rows = t.income.rows;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => col(INCOME_COLUMNS, r, "Date")), ["2026-09-02", "2026-10-17", "2026-10-20"]);
  assert.deepEqual(rows.map((r) => col(INCOME_COLUMNS, r, "Cash")), [null, true, false]);
  assert.deepEqual(rows.map((r) => col(INCOME_COLUMNS, r, "Amount")), [64, 64, 57.4]);
  assert.deepEqual(rows[1].slice(1, 3), [2026, "Oct"]);
  assert.equal(col(INCOME_COLUMNS, rows[1], "Show"), "Trident · Oct 17");
  assert.equal(col(INCOME_COLUMNS, rows[0], "Project"), "Band");
  assert.equal(col(INCOME_COLUMNS, rows[0], "Category"), "Digital sales");
  assert.equal(col(INCOME_COLUMNS, rows[1], "Roadie"), "https://app.example/artists/b/shows/s1");
  assert.equal(col(INCOME_COLUMNS, rows[0], "Roadie"), "https://app.example/artists/b/money/projects/band");
  assert.deepEqual(t.blanks.map((b) => [b.id, b.why]), [["c", "no_method"]]);
});

test("Just mine: only income this admin received; unassigned income is listed, someone else's is not", () => {
  const income = [inc({ id: "a" }), inc({ id: "b", receivedBy: "jeff" }), inc({ id: "c", receivedBy: undefined })];
  const mine = moneySheetTables(base({ income }));
  assert.equal(mine.income.rows.length, 1);
  assert.deepEqual(mine.blanks.map((b) => [b.id, b.why]), [["c", "no_receiver"]]);
  const band = moneySheetTables(base({ whose: "band", income }));
  assert.equal(band.income.rows.length, 3);
  assert.deepEqual(band.blanks, []);
  assert.deepEqual(band.income.rows.map((r) => col(INCOME_COLUMNS, r, "Received by")), ["Ingrid", "Jeff", null]);
});

test("expenses: paid ones by whoever bore the cost, tax line, meals at 50%, miles; open bills never", () => {
  const t = moneySheetTables(base({ expenses: [
    x({ id: "gas", gas: { miles: 52 } }),
    x({ id: "food", category: "food", amount: 2894, what: "Dinner", date: "2026-10-17" }),
    x({ id: "bill", owed: true }),
    x({ id: "jeffs", userId: "jeff" }), // Jeff's, not paid back: not Ingrid's
    x({ id: "back", userId: "jeff", paidBackAt: "2026-10-20", paidBackBy: "ingrid", date: "2026-10-01" }), // Ingrid paid Jeff back: hers
  ] }));
  const r = t.expenses.rows;
  assert.deepEqual(r.map((row) => col(EXPENSE_COLUMNS, row, "What")), ["Gas to Jamestown", "Gas to Jamestown", "Dinner"]);
  assert.deepEqual(r.map((row) => col(EXPENSE_COLUMNS, row, "Date")), ["2026-10-01", "2026-10-16", "2026-10-17"]);
  const food = r[2];
  assert.equal(col(EXPENSE_COLUMNS, food, "Tax line"), "24b Deductible meals");
  assert.deepEqual([col(EXPENSE_COLUMNS, food, "Amount"), col(EXPENSE_COLUMNS, food, "Deductible")], [28.94, 14.47]);
  assert.equal(col(EXPENSE_COLUMNS, r[1], "Miles"), 52);
  assert.equal(col(EXPENSE_COLUMNS, r[1], "Tax line"), "9 Car and truck expenses");
  assert.equal(col(EXPENSE_COLUMNS, r[1], "Project"), "Duo");
  assert.equal(col(EXPENSE_COLUMNS, r[0], "Paid by"), "Ingrid");
});

test("payouts: paid ones as contract labor; never reimbursements, never to the payer, never unpaid", () => {
  const t = moneySheetTables(base({ whose: "band", payouts: [
    pay({ id: "split" }),
    pay({ id: "reimb", kind: "reimbursement" }),
    pay({ id: "self", to: { userId: "ingrid", name: "Ingrid" } }),
    pay({ id: "owed", paidAt: undefined }),
    pay({ id: "jeffpaid", paidBy: "jeff", to: { name: "Sam" }, what: undefined, kind: "pay" }),
  ] }));
  const r = t.expenses.rows;
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((row) => col(EXPENSE_COLUMNS, row, "Kind")), ["Payout", "Payout"]);
  assert.deepEqual(r.map((row) => col(EXPENSE_COLUMNS, row, "What")), ["Tip split", "Sam"]);
  assert.deepEqual(r.map((row) => col(EXPENSE_COLUMNS, row, "Category")), ["Another band's cut", "Pay for playing"]);
  assert.equal(col(EXPENSE_COLUMNS, r[0], "Tax line"), "11 Contract labor");
  const mine = moneySheetTables(base({ payouts: [pay({ id: "a" }), pay({ id: "b", paidBy: "jeff" })] }));
  assert.equal(mine.expenses.rows.length, 1);
});

test("every row has one cell per column", () => {
  const t = moneySheetTables(base({ whose: "band", income: [inc({})], expenses: [x({})], payouts: [pay({})] }));
  for (const r of t.income.rows) assert.equal(r.length, INCOME_COLUMNS.length);
  for (const r of t.expenses.rows) assert.equal(r.length, EXPENSE_COLUMNS.length);
});

test("spreadsheetIdFrom and sheetSerial", () => {
  assert.equal(spreadsheetIdFrom("https://docs.google.com/spreadsheets/d/1Gs-4KPV_abc/edit?gid=1#gid=1"), "1Gs-4KPV_abc");
  assert.equal(spreadsheetIdFrom("  1Gs-4KPVHDSejpYti  "), "1Gs-4KPVHDSejpYti");
  assert.equal(spreadsheetIdFrom("https://drive.google.com/drive/folders/abc"), null);
  assert.equal(sheetSerial("1899-12-31"), 1);
  assert.equal(sheetSerial("2026-01-01"), 46023);
});
