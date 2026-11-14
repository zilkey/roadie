/**
 * The Sheets API v4 the Money sheet uses (src/server/integrations/sheets.ts), on fake-drive's port: spreadsheets.get and
 * spreadsheets.batchUpdate with addSheet, updateSheetProperties, addTable, updateTable, updateCells and addProtectedRange.
 * A spreadsheet is any fake Drive file with the Sheets mime type; it starts with one empty tab, "Sheet1". Like Google,
 * a table must sit inside its tab's grid and a batch is all or nothing. GET …?includeGridData=true adds each tab's cells as
 * plain values (dates as their serial number, a link as its formula) so tests can read back what was written.
 */
import { HttpError, type Route } from "../lib";

interface Grid { rowCount: number; columnCount: number; frozenRowCount?: number }
interface Range { sheetId: number; startRowIndex?: number; endRowIndex?: number; startColumnIndex?: number; endColumnIndex?: number }
interface Table { tableId: string; name: string; range: Range; columnProperties?: unknown[] }
interface Tab { properties: { sheetId: number; title: string; gridProperties: Grid }; tables: Table[]; protectedRanges: { protectedRangeId: number; description?: string; warningOnly?: boolean }[]; cells: unknown[][] }
export interface FakeSpreadsheet { title: string; tabs: Tab[]; seq: number }
export interface SheetsState { files: { id: string; name: string; mimeType: string; noAccess?: boolean; readOnly?: boolean }[]; sheets?: Record<string, FakeSpreadsheet> }

const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

function book(s: SheetsState, id: string): FakeSpreadsheet {
  const f = s.files.find((x) => x.id === id);
  if (!f || f.noAccess) throw new HttpError(404, `Requested entity was not found.`);
  if (f.mimeType !== SHEET_MIME) throw new HttpError(400, "This operation is not supported for this document");
  const all = (s.sheets ??= {});
  return (all[id] ??= { title: f.name, seq: 1, tabs: [{ properties: { sheetId: 0, title: "Sheet1", gridProperties: { rowCount: 1000, columnCount: 26 } }, tables: [], protectedRanges: [], cells: [] }] });
}
const tabOf = (b: FakeSpreadsheet, sheetId: number) => {
  const t = b.tabs.find((x) => x.properties.sheetId === sheetId);
  if (!t) throw new HttpError(400, `No grid with id: ${sheetId}`);
  return t;
};
const inGrid = (t: Tab, r: Range) => {
  const g = t.properties.gridProperties;
  if ((r.endRowIndex ?? g.rowCount) > g.rowCount || (r.endColumnIndex ?? g.columnCount) > g.columnCount) {
    throw new HttpError(400, `Range ${JSON.stringify(r)} exceeds grid limits. Max rows: ${g.rowCount}, max columns: ${g.columnCount}`);
  }
};
const plain = (c: { userEnteredValue?: Record<string, unknown> } | undefined) => {
  const v = c?.userEnteredValue;
  if (!v) return null;
  return v.numberValue ?? v.stringValue ?? v.boolValue ?? v.formulaValue ?? null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function apply(b: FakeSpreadsheet, req: Record<string, any>): Record<string, unknown> {
  const [kind] = Object.keys(req);
  const r = req[kind];
  switch (kind) {
    case "addSheet": {
      const title = r.properties?.title as string;
      if (b.tabs.some((t) => t.properties.title === title)) throw new HttpError(400, `A sheet with the name "${title}" already exists.`);
      const g = r.properties?.gridProperties ?? {};
      const props = { sheetId: 1000 + b.seq++, title, gridProperties: { rowCount: g.rowCount ?? 1000, columnCount: g.columnCount ?? 26, frozenRowCount: g.frozenRowCount } };
      b.tabs.push({ properties: props, tables: [], protectedRanges: [], cells: [] });
      return { addSheet: { properties: props } };
    }
    case "updateSheetProperties": {
      const t = tabOf(b, r.properties.sheetId);
      const g = r.properties.gridProperties ?? {};
      const next = { ...t.properties.gridProperties, ...g };
      for (const x of t.tables) if ((x.range.endRowIndex ?? 0) > next.rowCount || (x.range.endColumnIndex ?? 0) > next.columnCount) throw new HttpError(400, "You can't remove rows or columns a table is on");
      t.properties.gridProperties = next;
      t.cells = t.cells.slice(0, next.rowCount);
      return {};
    }
    case "addTable": {
      const t = tabOf(b, r.table.range.sheetId);
      inGrid(t, r.table.range);
      if (b.tabs.some((x) => x.tables.some((y) => y.name === r.table.name))) throw new HttpError(400, `A table with the name "${r.table.name}" already exists`);
      const table: Table = { tableId: String(5000 + b.seq++), name: r.table.name, range: r.table.range, columnProperties: r.table.columnProperties };
      t.tables.push(table);
      return { addTable: { table } };
    }
    case "updateTable": {
      const tab = b.tabs.find((x) => x.tables.some((y) => y.tableId === r.table.tableId));
      if (!tab) throw new HttpError(400, `No table with id ${r.table.tableId}`);
      if (r.fields !== "range") throw new HttpError(400, "The fake only updates a table's range");
      inGrid(tab, r.table.range);
      tab.tables.find((y) => y.tableId === r.table.tableId)!.range = r.table.range;
      return {};
    }
    case "updateCells": {
      const t = tabOf(b, r.range.sheetId);
      inGrid(t, r.range);
      const r0 = r.range.startRowIndex ?? 0, c0 = r.range.startColumnIndex ?? 0;
      const rows = (r.rows ?? []) as { values?: unknown[] }[];
      const end = r.range.endRowIndex ?? r0 + rows.length;
      for (let i = r0; i < end; i++) {
        const row = (t.cells[i] ??= []);
        const vals = rows[i - r0]?.values ?? [];
        const cEnd = r.range.endColumnIndex ?? c0 + vals.length;
        for (let j = c0; j < cEnd; j++) row[j] = plain(vals[j - c0] as never);
      }
      return {};
    }
    case "addProtectedRange": {
      const t = tabOf(b, r.protectedRange.range.sheetId);
      const p = { protectedRangeId: b.seq++, description: r.protectedRange.description, warningOnly: !!r.protectedRange.warningOnly };
      t.protectedRanges.push(p);
      return { addProtectedRange: { protectedRange: p } };
    }
    default: throw new HttpError(400, `The fake doesn't do ${kind}`);
  }
}

const meta = (id: string, b: FakeSpreadsheet, grid: boolean) => ({
  spreadsheetId: id, properties: { title: b.title },
  sheets: b.tabs.map((t) => ({ properties: t.properties, tables: t.tables, protectedRanges: t.protectedRanges, ...(grid ? { values: t.cells } : {}) })),
});

export function sheetsRoutes<S extends SheetsState>(): Route<S>[] {
  return [
    ["GET", "/sheets/v4/spreadsheets/:id", ({ params, query }, s) => meta(params.id, book(s, params.id), query.get("includeGridData") === "true")],
    ["POST", "/sheets/v4/spreadsheets/:id", ({ params, body }, s) => {
      const [id, op] = params.id.split(":");
      if (op !== "batchUpdate") throw new HttpError(404, "Not found");
      const f = s.files.find((x) => x.id === id);
      if (f?.readOnly) throw new HttpError(403, "The caller does not have permission");
      const b = book(s, id);
      // All or nothing: work on a copy, keep it only if every request applies.
      const draft = structuredClone(b);
      const replies = ((body.requests ?? []) as Record<string, unknown>[]).map((q) => apply(draft, q));
      s.sheets![id] = draft;
      return { spreadsheetId: id, replies };
    }],
  ];
}
