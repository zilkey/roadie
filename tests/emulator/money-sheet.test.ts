/** The Money sheet (#85): choosing an admin's own Google Sheet, and Send to sheet rewriting its two tables in the fake Sheets. */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { MONEY_SHEET_ID } from "../../fakes/fake-drive/server";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { isEligible } from "@/server/assistant/policy";
import { PROTECTION_NOTE } from "@/server/moneySheet";
import { resetEmulators, makeUser, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx, jeff: Ctx;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  if (s.running["fake-drive"]) process.env.DRIVE_BASE_URL = s.running["fake-drive"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const fails = async (p: Promise<unknown>, code: string) => assert.rejects(p, (e: { code?: string }) => { assert.equal(e.code, code); return true; });
interface Tab { properties: { sheetId: number; title: string; gridProperties: { rowCount: number } }; tables: { tableId: string; name: string; range: { endRowIndex: number } }[]; protectedRanges: { description: string; warningOnly: boolean }[]; values: unknown[][] }
const book = async (): Promise<Tab[]> => (await (await fetch(`${process.env.DRIVE_BASE_URL}/sheets/v4/spreadsheets/${MONEY_SHEET_ID}?includeGridData=true`)).json()).sheets;
const tab = async (title: string) => (await book()).find((t) => t.properties.title === title)!;

beforeEach(async () => {
  await resetEmulators();
  await fetch(process.env.DRIVE_BASE_URL + "/__reset", { method: "POST" });
  const a = await makeUser("nora@example.com", "admin", { name: "Nora Quill" });
  const b = await makeUser("jeff@example.com", "admin", { name: "Jeff Dean" });
  const at = { role: "admin" as const, via: "app" as const, artistId: TEST_ARTIST, now: new Date("2026-11-14T18:00:00Z") };
  ctx = { uid: a.uid, runId: newRunId(), ...at };
  jeff = { uid: b.uid, runId: newRunId(), ...at };
  await db.create(ctx, "artists", { slug: "band", name: "Band", driveFolderId: "fake-band-folder", links: {}, configurations: [] }, { id: TEST_ARTIST });
  await cmd("projects.create", { kind: "band", name: "Band", isDefault: true });
});

test("choosing the sheet: a link you can edit; never a view-only one, and nothing is written until Send", async () => {
  assert.equal((await cmd("google.moneySheet", {})).sheet, null);
  await fails(cmd("google.sendMoneySheet", {}), "no_money_sheet");
  await fails(cmd("google.setMoneySheet", { sheet: "https://drive.google.com/drive/folders/abc" }), "invalid_input");
  await fails(cmd("google.setMoneySheet", { sheet: "https://docs.google.com/spreadsheets/d/fake-sheet-readonly/edit" }), "forbidden");
  await fails(cmd("google.setMoneySheet", { sheet: "https://docs.google.com/spreadsheets/d/fake-sheet-nope/edit" }), "not_found");
  const s = await cmd("google.setMoneySheet", { sheet: `https://docs.google.com/spreadsheets/d/${MONEY_SHEET_ID}/edit#gid=0` });
  assert.deepEqual([s.ready, s.sheet.title, s.sheet.whose, s.sheet.sentAt], [true, "Nora's books", "mine", null]);
  assert.deepEqual((await book()).map((t) => t.properties.title), ["Sheet1"], "nothing written yet");
  assert.equal((await cmd("google.moneySheet", {}, jeff)).sheet, null, "it is Nora's alone");
  assert.equal((await cmd("google.setMoneySheet", { whose: "band" })).sheet.whose, "band");
  assert.equal((await cmd("google.clearMoneySheet", {})).sheet, null);
});

test("Send to sheet writes both tables, then rewrites the same ones as Money changes", async () => {
  await cmd("google.setMoneySheet", { sheet: MONEY_SHEET_ID });
  const tips = (await cmd("income.add", { amount: 6400, category: "tips", from: "Trident", method: "cash", date: "2026-10-17", receivedAt: "2026-10-17" })).id;
  await cmd("income.add", { amount: 5740, category: "tips", from: "Trident", method: "venmo", date: "2026-10-17", receivedAt: "2026-10-18" });
  await cmd("income.add", { amount: 10000, category: "guarantee", from: "Benefit", date: "2026-10-11", receivedAt: "2026-10-11" }); // no method
  await cmd("income.add", { amount: 50000, category: "guarantee", from: "Clyfford Still", date: "2026-10-11" }); // owed: never sent
  await cmd("income.add", { amount: 9900, category: "merch", from: "Jeff's table", method: "venmo", date: "2026-10-12", receivedAt: "2026-10-12" }, jeff); // Jeff's
  await cmd("expenses.add", { amount: 2894, what: "Dinner", category: "food", date: "2026-10-17" });
  await cmd("payouts.add", { to: { name: "Fresh Fruit" }, kind: "split", amount: 6100, what: "Tip split", paidAt: "2026-10-17", method: "venmo", paidBy: ctx.uid });

  const r = await cmd("google.sendMoneySheet", {});
  assert.deepEqual([r.income, r.expenses], [3, 2]);
  assert.deepEqual(r.blanks.map((b: { what: string; why: string }) => [b.what, b.why]), [["Benefit", "no_method"]]);
  assert.equal(r.sheet.sentAt, "2026-11-14T18:00:00.000Z");
  assert.deepEqual([r.sheet.sentIncome, r.sheet.sentExpenses], [3, 2]);

  const inc = await tab("Roadie income");
  assert.equal(inc.tables[0].name, "Roadie_income");
  assert.equal(inc.tables[0].range.endRowIndex, 4);
  assert.equal(inc.properties.gridProperties.rowCount, 4);
  assert.deepEqual(inc.values[0].slice(0, 6), ["Date", "Year", "Month", "Amount", "Cash", "Method"]);
  assert.deepEqual(inc.values.slice(1).map((row) => [row[1], row[2], row[3], row[4], row[7]]), [
    [2026, "Oct", 100, null, "Benefit"], [2026, "Oct", 64, true, "Trident"], [2026, "Oct", 57.4, false, "Trident"],
  ]);
  assert.equal(inc.values[2][0], 46312, "a date is its serial number (2026-10-17)");
  assert.equal(inc.values[2][10], "Nora Quill");
  assert.match(String(inc.values[2][12]), /^=HYPERLINK\("http.*\/artists\/band\/money\/projects\/.+","open"\)$/);
  assert.deepEqual(inc.protectedRanges.map((p) => [p.description, p.warningOnly]), [[PROTECTION_NOTE, true]]);
  const exp = await tab("Roadie expenses");
  assert.equal(exp.tables[0].name, "Roadie_expenses");
  assert.deepEqual(exp.values.slice(1).map((row) => [row[4], row[6], row[7], row[8]]), [
    ["Expense", "24b Deductible meals", 14.47, "Dinner"], ["Payout", "11 Contract labor", 61, "Tip split"],
  ]);

  // More rows, then fewer: the same tables, resized; nothing is left below them.
  const tableId = inc.tables[0].tableId;
  for (let i = 0; i < 4; i++) await cmd("income.add", { amount: 1000 + i, category: "merch", from: `Night ${i}`, method: "cash", date: "2026-11-01", receivedAt: "2026-11-01" });
  assert.equal((await cmd("google.sendMoneySheet", {})).income, 7);
  let again = await tab("Roadie income");
  assert.equal(again.tables[0].tableId, tableId);
  assert.deepEqual([again.tables[0].range.endRowIndex, again.values.length], [8, 8]);
  await cmd("income.remove", { id: tips });
  await cmd("google.setMoneySheet", { whose: "band" });
  const r3 = await cmd("google.sendMoneySheet", {});
  assert.equal(r3.income, 7, "whole band: Jeff's merch is in, the removed tips are not");
  again = await tab("Roadie income");
  assert.deepEqual([again.tables[0].tableId, again.tables.length], [tableId, 1]);
  assert.ok(again.values.some((row) => row[7] === "Jeff's table"));
  assert.ok(!again.values.some((row) => row[3] === 64));
  assert.equal((await book()).filter((t) => t.properties.title.startsWith("Roadie")).length, 2, "never a second tab");
  assert.equal((await tab("Roadie income")).protectedRanges.length, 1, "protected once");
});

test("Just mine lists received income nobody is down as receiving; with nothing to send a table keeps one blank row", async () => {
  await cmd("google.setMoneySheet", { sheet: MONEY_SHEET_ID });
  const id = (await cmd("income.add", { amount: 2000, category: "streaming", from: "Bandcamp", method: "bank", date: "2026-03-02", receivedAt: "2026-03-02" })).id;
  await db.update(ctx, "income", id, { receivedBy: null });
  const r = await cmd("google.sendMoneySheet", {});
  assert.deepEqual([r.income, r.expenses], [0, 0]);
  assert.deepEqual(r.blanks.map((b: { why: string }) => b.why), ["no_receiver"]);
  const t = await tab("Roadie income");
  assert.equal(t.tables[0].range.endRowIndex, 2);
  assert.deepEqual(t.values[1].slice(0, 4), [null, null, null, null]);
});

test("a deleted Roadie tab is made again; the commands are admin-only and Roadie never gets them", async () => {
  await cmd("google.setMoneySheet", { sheet: MONEY_SHEET_ID });
  await cmd("google.sendMoneySheet", {});
  // Someone deletes the tabs in Google Sheets: the fake's state is reset, so the stored table ids point nowhere.
  await fetch(process.env.DRIVE_BASE_URL + "/__reset", { method: "POST" });
  await cmd("google.sendMoneySheet", {});
  assert.deepEqual((await book()).map((t) => t.properties.title), ["Sheet1", "Roadie income", "Roadie expenses"]);
  for (const name of ["google.moneySheet", "google.setMoneySheet", "google.clearMoneySheet", "google.sendMoneySheet"]) {
    assert.deepEqual(registry[name].roles, ["admin"]);
    assert.equal(isEligible(name, "admin"), false);
  }
});
