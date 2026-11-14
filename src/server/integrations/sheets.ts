/**
 * Google Sheets, for the Money sheet (src/server/moneySheet.ts). Runs as the CALLER's own Google account (their Drive grant:
 * the Sheets API accepts the full Drive scope, so no new scope), never the band account: the sheet is someone's own books.
 * Two implementations: the Sheets API v4 (+ Drive files.get for "can I edit it"), and the fake in fakes/fake-drive (the same
 * spreadsheets.get / batchUpdate shapes, so the request building in moneySheet.ts runs against both).
 */
import { IntegrationError, jsonClient } from "./http";
import { googleJson, useRealGoogle } from "./google";
import { accessTokenFor } from "../google/grants";

export interface GridRange { sheetId: number; startRowIndex?: number; endRowIndex?: number; startColumnIndex?: number; endColumnIndex?: number }
export interface SheetsTable { tableId: string; name: string; range: GridRange }
export interface SheetsTab {
  properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } };
  tables?: SheetsTable[];
  protectedRanges?: { protectedRangeId?: number; description?: string }[];
}
export interface SheetsMeta { spreadsheetId?: string; properties?: { title?: string }; sheets?: SheetsTab[] }
/** One batchUpdate request (the API's Request union, loosely typed). */
export type SheetsRequest = Record<string, unknown>;
export interface SheetsInfo { id: string; title: string; url: string; canEdit: boolean }

export interface SheetsService {
  /** The file as the caller's Drive sees it. IntegrationError 404 when they can't open it; `canEdit` false when they can only view. */
  info(spreadsheetId: string): Promise<SheetsInfo>;
  /** spreadsheets.get: tabs, their tables and protected ranges (no cell data). */
  get(spreadsheetId: string): Promise<SheetsMeta>;
  /** spreadsheets.batchUpdate: applied in order, all or nothing. */
  batchUpdate(spreadsheetId: string, requests: SheetsRequest[]): Promise<{ replies?: Record<string, unknown>[] }>;
}

const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const META_FIELDS = "spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),tables(tableId,name,range),protectedRanges(protectedRangeId,description))";
const notASheet = () => new IntegrationError("sheets", 400, "That link isn't a Google Sheet");

/** The real API as `uid`'s own Google account when Google is configured and DRIVE_BASE_URL isn't set; otherwise the fake (a string is its base URL). */
export function sheetsClient(opts: string | { uid: string }): SheetsService {
  const baseUrl = typeof opts === "string" ? opts : undefined;
  if (useRealGoogle(process.env.DRIVE_BASE_URL, baseUrl)) {
    const uid = (opts as { uid: string }).uid;
    return googleSheets((force) => accessTokenFor(uid, "drive", force));
  }
  return fakeSheetsClient(baseUrl ?? process.env.DRIVE_BASE_URL ?? "http://127.0.0.1:3202");
}

export function fakeSheetsClient(baseUrl: string): SheetsService {
  const call = jsonClient("sheets", baseUrl);
  const s = (id: string) => `/sheets/v4/spreadsheets/${encodeURIComponent(id)}`;
  return {
    info: async (id) => {
      const f = await call<{ id: string; name: string; mimeType: string; webViewLink: string; readOnly?: boolean; noAccess?: boolean }>("GET", `/files/${encodeURIComponent(id)}`);
      if (f.noAccess) throw new IntegrationError("sheets", 404, "File not found");
      if (f.mimeType !== SHEET_MIME) throw notASheet();
      return { id: f.id, title: f.name, url: f.webViewLink, canEdit: !f.readOnly };
    },
    get: (id) => call("GET", s(id)),
    batchUpdate: (id, requests) => call("POST", `${s(id)}:batchUpdate`, { body: { requests } }),
  };
}

export function googleSheets(token: (force?: boolean) => Promise<string>, baseUrl = "https://sheets.googleapis.com/v4", driveUrl = "https://www.googleapis.com/drive/v3"): SheetsService {
  const call = googleJson("sheets", baseUrl, token);
  const drive = googleJson("sheets", driveUrl, token);
  const s = (id: string) => `/spreadsheets/${encodeURIComponent(id)}`;
  return {
    info: async (id) => {
      const f = await drive<{ id: string; name: string; mimeType: string; webViewLink?: string; capabilities?: { canEdit?: boolean } }>("GET", `/files/${encodeURIComponent(id)}`,
        { query: { fields: "id,name,mimeType,webViewLink,capabilities(canEdit)", supportsAllDrives: "true" } });
      if (f.mimeType !== SHEET_MIME) throw notASheet();
      return { id: f.id, title: f.name, url: f.webViewLink ?? `https://docs.google.com/spreadsheets/d/${f.id}/edit`, canEdit: !!f.capabilities?.canEdit };
    },
    get: (id) => call("GET", s(id), { query: { fields: META_FIELDS } }),
    batchUpdate: (id, requests) => call("POST", `${s(id)}:batchUpdate`, { body: { requests } }),
  };
}
