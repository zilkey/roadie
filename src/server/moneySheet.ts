/**
 * The Money sheet (Settings › Google): each admin may point Roadie at a Google Sheet of their own, and Send to sheet rewrites
 * two tables in it (Roadie_income, Roadie_expenses; the rows are src/lib/moneySheet.ts). The choice lives in
 * userPrefs/{uid}.moneySheet[artistId], written with firebase-admin like the other personal prefs (no history, no undo).
 *
 * Writing a table is one batchUpdate, all or nothing: grow the grid, point the table at the new size, write every cell, then
 * shrink the grid to fit (rows below the table go). A table Roadie made before is found by its tableId (else by name), so a
 * renamed tab still works and formulas that read Roadie_income[Amount] keep working across sends. A deleted tab is made again.
 */
import { firestore } from "./admin";
import { IntegrationError } from "./integrations/http";
import type { SheetsMeta, SheetsRequest, SheetsService, SheetsTab } from "./integrations/sheets";
import { sheetSerial, type MoneySheetWhose, type SheetColumnKind, type SheetTable, type SheetValue } from "@/lib/moneySheet";

export interface TableRef { sheetId: number; tableId: string }
export interface MoneySheetPref {
  spreadsheetId: string; title: string; url: string; whose: MoneySheetWhose;
  income?: TableRef; expenses?: TableRef;
  /** The last send (ISO) and how many rows each table got. */
  sentAt?: string; sentIncome?: number; sentExpenses?: number;
}

const ref = (uid: string) => firestore().collection("userPrefs").doc(uid);

export async function moneySheetPref(uid: string, artistId: string): Promise<MoneySheetPref | null> {
  return ((await ref(uid).get()).data()?.moneySheet?.[artistId] as MoneySheetPref | undefined) ?? null;
}
/** Replaces this artist's entry whole (null removes it): a merge would keep an old sheet's table ids. */
export async function setMoneySheetPref(uid: string, artistId: string, pref: MoneySheetPref | null): Promise<void> {
  const cur = ((await ref(uid).get()).data()?.moneySheet ?? {}) as Record<string, MoneySheetPref>;
  const next = { ...cur };
  if (pref) next[artistId] = pref; else delete next[artistId];
  await ref(uid).set({ uid, moneySheet: next }, { merge: true });
}

// ---------- writing one table ----------

const COLUMN_TYPE: Record<SheetColumnKind, string> = { date: "DATE", number: "DOUBLE", currency: "CURRENCY", text: "TEXT", boolean: "BOOLEAN", link: "TEXT" };
const FORMAT: Partial<Record<SheetColumnKind, { type: string; pattern: string }>> = {
  date: { type: "DATE", pattern: "M/d/yyyy" }, number: { type: "NUMBER", pattern: "0" }, currency: { type: "CURRENCY", pattern: "$#,##0.00" },
};
export const PROTECTION_NOTE = "Roadie rewrites this tab on every Send to sheet. Fix rows in Roadie.";

/** One cell as the API's CellData. Strings are never parsed (no formula injection): only the link column is a formula, built here. */
export function cellData(kind: SheetColumnKind, v: SheetValue): Record<string, unknown> {
  const fmt = FORMAT[kind] ? { userEnteredFormat: { numberFormat: FORMAT[kind] } } : {};
  if (v === null || v === "") return { ...fmt };
  if (kind === "date" && typeof v === "string") return { userEnteredValue: { numberValue: sheetSerial(v) }, ...fmt };
  if (kind === "link" && typeof v === "string") return { userEnteredValue: { formulaValue: `=HYPERLINK("${v.replace(/"/g, '""')}","open")` } };
  if (typeof v === "boolean") return { userEnteredValue: { boolValue: v } };
  if (typeof v === "number") return { userEnteredValue: { numberValue: v }, ...fmt };
  return { userEnteredValue: { stringValue: String(v) }, ...fmt };
}

/** Where the table is now: by id, else by name, across every tab. */
function findTable(meta: SheetsMeta, table: SheetTable, known?: TableRef): { tab?: SheetsTab; tableId?: string } {
  const tabs = meta.sheets ?? [];
  for (const t of tabs) for (const x of t.tables ?? []) if (known && x.tableId === known.tableId) return { tab: t, tableId: x.tableId };
  for (const t of tabs) for (const x of t.tables ?? []) if (x.name === table.name) return { tab: t, tableId: x.tableId };
  return { tab: tabs.find((t) => (known && t.properties.sheetId === known.sheetId) || t.properties.title === table.tab) };
}

/** The batchUpdate requests that make `table` exactly what the tab holds. Exported for tests. */
export function tableRequests(table: SheetTable, tab: SheetsTab, tableId: string | undefined): SheetsRequest[] {
  const sheetId = tab.properties.sheetId;
  const cols = table.columns.length;
  const total = Math.max(table.rows.length, 1) + 1; // a table keeps one (blank) row when there's nothing to send
  const grid = tab.properties.gridProperties ?? {};
  const range = { sheetId, startRowIndex: 0, endRowIndex: total, startColumnIndex: 0, endColumnIndex: cols };
  const header = { values: table.columns.map((c) => ({ userEnteredValue: { stringValue: c.name } })) };
  const body = (table.rows.length ? table.rows : [table.columns.map(() => null)]).map((r) => ({ values: table.columns.map((c, i) => cellData(c.kind, r[i] ?? null)) }));
  const columnProperties = table.columns.map((c, i) => ({ columnIndex: i, columnName: c.name, columnType: COLUMN_TYPE[c.kind] }));
  const out: SheetsRequest[] = [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount: Math.max(grid.rowCount ?? 0, total), columnCount: Math.max(grid.columnCount ?? 0, cols), frozenRowCount: 1 } }, fields: "gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount" } },
  ];
  if (tableId) out.push({ updateTable: { table: { tableId, range }, fields: "range" } });
  out.push({ updateCells: { range, rows: [header, ...body], fields: "userEnteredValue,userEnteredFormat.numberFormat" } });
  if (!tableId) out.push({ addTable: { table: { name: table.name, range, columnProperties } } });
  out.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount: total } }, fields: "gridProperties.rowCount" } });
  if (!(tab.protectedRanges ?? []).some((p) => p.description === PROTECTION_NOTE)) {
    out.push({ addProtectedRange: { protectedRange: { range: { sheetId }, description: PROTECTION_NOTE, warningOnly: true } } });
  }
  return out;
}

/** Make the sheet's copy of `table` exactly its rows (adding the tab and the table the first time). */
export async function writeTable(svc: SheetsService, spreadsheetId: string, table: SheetTable, known?: TableRef): Promise<TableRef> {
  const meta = await svc.get(spreadsheetId);
  let { tab, tableId } = findTable(meta, table, known);
  if (!tab) {
    const r = await svc.batchUpdate(spreadsheetId, [{ addSheet: { properties: { title: table.tab, gridProperties: { rowCount: 2, columnCount: table.columns.length, frozenRowCount: 1 } } } }]);
    const props = (r.replies?.[0]?.addSheet as { properties?: SheetsTab["properties"] } | undefined)?.properties;
    if (!props) throw new IntegrationError("sheets", 502, `Couldn't add the ${table.tab} tab`);
    tab = { properties: props };
    tableId = undefined;
  }
  const requests = tableRequests(table, tab, tableId);
  const r = await svc.batchUpdate(spreadsheetId, requests);
  if (!tableId) {
    const i = requests.findIndex((q) => "addTable" in q);
    tableId = (r.replies?.[i]?.addTable as { table?: { tableId?: string } } | undefined)?.table?.tableId;
    if (!tableId) throw new IntegrationError("sheets", 502, `Couldn't make the ${table.name} table`);
  }
  return { sheetId: tab.properties.sheetId, tableId };
}
