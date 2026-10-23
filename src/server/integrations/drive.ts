/**
 * Google Drive integration. Real implementation later: Drive API v3 (files.list with q="name contains ...",
 * files.get, files.copy, permissions.create/list) with scope drive (see docs/FIREBASE-SETUP.md).
 */
import { jsonClient } from "./http";

export interface DrivePermission { email: string; role: "owner" | "writer" | "reader" }
export interface DriveFile { id: string; name: string; mimeType: string; ownerEmail: string; parents: string[]; permissions: DrivePermission[]; createdAt: string; webViewLink: string }

export interface DriveService {
  search(opts: { q?: string; parent?: string; mimeType?: string }): Promise<DriveFile[]>;
  get(id: string): Promise<DriveFile>;
  copy(id: string, opts: { parentId: string; name?: string }): Promise<DriveFile>;
  share(id: string, emails: string[], role?: "reader" | "writer"): Promise<DriveFile>;
  permissions(id: string): Promise<DrivePermission[]>;
}

export function driveClient(baseUrl = process.env.DRIVE_BASE_URL ?? "http://127.0.0.1:3202"): DriveService {
  const call = jsonClient("drive", baseUrl);
  const f = (id: string) => `/files/${encodeURIComponent(id)}`;
  return {
    search: (o) => call("GET", "/files", { query: { q: o.q, parent: o.parent, mimeType: o.mimeType } }),
    get: (id) => call("GET", f(id)),
    copy: (id, o) => call("POST", `${f(id)}/copy`, { body: o }),
    share: (id, emails, role = "reader") => call("POST", `${f(id)}/share`, { body: { emails, role } }),
    permissions: (id) => call("GET", `${f(id)}/permissions`),
  };
}
