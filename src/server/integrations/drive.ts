/**
 * Google Drive. Two implementations of DriveService: the fake's HTTP client (fakes/fake-drive; dev and tests) and the
 * Drive API v3 (files.list/get/copy, permissions.list/create), chosen by driveClient(). The real one runs as the band's
 * Google account (the admin named on the artist, see src/server/google/band.ts), so search sees that person's Drive.
 */
import { IntegrationError, jsonClient } from "./http";
import { googleJson, useRealGoogle, type TokenSource } from "./google";
import { bandToken } from "../google/band";

export interface DrivePermission { email: string; role: "owner" | "writer" | "reader" }
export interface DriveFile {
  id: string; name: string; mimeType: string; ownerEmail: string; parents: string[]; permissions: DrivePermission[]; createdAt: string; webViewLink: string;
  /** Real Drive only: anyone with the link can open it. */
  anyoneWithLink?: boolean;
  /** Real Drive only: everyone at these domains can open it (Workspace domain sharing). */
  domains?: string[];
}

export interface DriveService {
  search(opts: { q?: string; parent?: string; mimeType?: string }): Promise<DriveFile[]>;
  get(id: string): Promise<DriveFile>;
  copy(id: string, opts: { parentId: string; name?: string }): Promise<DriveFile>;
  share(id: string, emails: string[], role?: "reader" | "writer"): Promise<DriveFile>;
  permissions(id: string): Promise<DrivePermission[]>;
}

/**
 * The real Drive API when Google is configured and DRIVE_BASE_URL isn't set (as the band account of `artistId`, or of the
 * one artist there is); otherwise the fake. A string is the fake's base URL (tests).
 */
export function driveClient(opts: string | { artistId?: string } = {}): DriveService {
  const baseUrl = typeof opts === "string" ? opts : undefined;
  if (useRealGoogle(process.env.DRIVE_BASE_URL, baseUrl)) return googleDrive((force) => bandToken((opts as { artistId?: string }).artistId, "drive", force));
  return fakeDriveClient(baseUrl ?? process.env.DRIVE_BASE_URL ?? "http://127.0.0.1:3202");
}

export function fakeDriveClient(baseUrl: string): DriveService {
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

// ---------- the Drive API ----------

interface GPermission { type: "user" | "group" | "domain" | "anyone"; role: string; emailAddress?: string; domain?: string }
interface GFile { id: string; name: string; mimeType: string; owners?: { emailAddress?: string }[]; parents?: string[]; permissions?: GPermission[]; createdTime?: string; webViewLink?: string }

const PERM_FIELDS = "emailAddress,role,type,domain";
const FILE_FIELDS = `id,name,mimeType,owners(emailAddress),parents,permissions(${PERM_FIELDS}),createdTime,webViewLink`;
const ALL_DRIVES = { supportsAllDrives: "true" };
/** Drive query string literal. */
const lit = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

const roleOf = (r: string): DrivePermission["role"] => (r === "owner" ? "owner" : r === "writer" || r === "organizer" || r === "fileOrganizer" ? "writer" : "reader");
/** People and groups by address. A file the band account can only read comes back without permissions; then only the owner is known. */
const people = (ps: GPermission[] = []): DrivePermission[] =>
  ps.filter((p) => (p.type === "user" || p.type === "group") && p.emailAddress).map((p) => ({ email: p.emailAddress!.toLowerCase(), role: roleOf(p.role) }));

function toFile(f: GFile): DriveFile {
  const ps = f.permissions ?? [];
  const domains = ps.filter((p) => p.type === "domain" && p.domain).map((p) => p.domain!.toLowerCase());
  return {
    id: f.id, name: f.name, mimeType: f.mimeType, ownerEmail: f.owners?.[0]?.emailAddress?.toLowerCase() ?? "", parents: f.parents ?? [],
    permissions: people(ps), createdAt: f.createdTime ?? "", webViewLink: f.webViewLink ?? `https://drive.google.com/open?id=${f.id}`,
    ...(ps.some((p) => p.type === "anyone") ? { anyoneWithLink: true } : {}), ...(domains.length ? { domains } : {}),
  };
}

const RANK = { reader: 1, writer: 2, owner: 3 } as const;

export function googleDrive(token: TokenSource, baseUrl = "https://www.googleapis.com/drive/v3"): DriveService {
  const call = googleJson("drive", baseUrl, token);
  const f = (id: string) => `/files/${encodeURIComponent(id)}`;
  const get = async (id: string) => toFile(await call<GFile>("GET", f(id), { query: { fields: FILE_FIELDS, ...ALL_DRIVES } }));
  return {
    async search(o) {
      const q = ["trashed = false", o.q && `name contains ${lit(o.q)}`, o.parent && `${lit(o.parent)} in parents`, o.mimeType && `mimeType = ${lit(o.mimeType)}`].filter(Boolean).join(" and ");
      const r = await call<{ files?: GFile[] }>("GET", "/files", { query: { q, fields: `files(${FILE_FIELDS})`, pageSize: "100", includeItemsFromAllDrives: "true", ...ALL_DRIVES } });
      return (r.files ?? []).map(toFile);
    },
    get,
    async copy(id, o) {
      return toFile(await call<GFile>("POST", `${f(id)}/copy`, { query: { fields: FILE_FIELDS, ...ALL_DRIVES }, body: { ...(o.name ? { name: o.name } : {}), parents: [o.parentId] } }));
    },
    async share(id, emails, role = "reader") {
      const cur = await get(id);
      const has = new Map([[cur.ownerEmail, "owner" as const], ...cur.permissions.map((p) => [p.email, p.role] as const)]);
      for (const email of emails.map((e) => e.toLowerCase())) {
        const now = has.get(email);
        if (now && RANK[now] >= RANK[role]) continue;
        const add = (notify: boolean) => call("POST", `${f(id)}/permissions`, {
          query: { sendNotificationEmail: String(notify), fields: "id", ...ALL_DRIVES }, body: { type: "user", role, emailAddress: email },
        });
        // Quietly, like the fake. Drive insists on an invite email for addresses without a Google account; then send one.
        try { await add(false); } catch (e) { if (e instanceof IntegrationError && e.status === 400) await add(true); else throw e; }
      }
      return get(id);
    },
    async permissions(id) {
      const r = await call<{ permissions?: GPermission[] }>("GET", `${f(id)}/permissions`, { query: { fields: `permissions(${PERM_FIELDS})`, ...ALL_DRIVES } });
      return people(r.permissions);
    },
  };
}
