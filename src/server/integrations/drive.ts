/**
 * Google Drive. Two implementations of DriveService: the fake's HTTP client (fakes/fake-drive; dev and tests) and the
 * Drive API v3 (files.list/get/create/copy, uploads, permissions.list/create), chosen by driveClient(). The real one runs as the band's
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
  /**
   * Real Drive only: Drive left the permissions out, so `permissions`, `anyoneWithLink` and `domains` say nothing. files.get and
   * files.list never carry them for shared-drive items, nor for a file the band account can't share; get() asks permissions.list
   * instead, and clears this when it answers.
   */
  permissionsUnknown?: boolean;
}

export interface DriveService {
  search(opts: { q?: string; parent?: string; mimeType?: string }): Promise<DriveFile[]>;
  get(id: string): Promise<DriveFile>;
  copy(id: string, opts: { parentId: string; name?: string }): Promise<DriveFile>;
  createFolder(name: string, parentId: string): Promise<DriveFile>;
  /** A new file in `parentId` with these bytes. */
  upload(opts: { name: string; mimeType: string; parentId: string; data: Blob }): Promise<DriveFile>;
  share(id: string, emails: string[], role?: "reader" | "writer"): Promise<DriveFile>;
  /** Give the file a new name (its id and place stay). */
  rename(id: string, name: string): Promise<DriveFile>;
  permissions(id: string): Promise<DrivePermission[]>;
  /** The file's bytes as Drive sends them (streamed). `range` is passed on as the Range header. */
  download(id: string, range?: string | null): Promise<Response>;
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

export const FOLDER_MIME = "application/vnd.google-apps.folder";
/** Who owns what the app makes in the fake Drive (it has no band account). */
const FAKE_OWNER = "jeff@example.com";

export function fakeDriveClient(baseUrl: string): DriveService {
  const call = jsonClient("drive", baseUrl);
  const f = (id: string) => `/files/${encodeURIComponent(id)}`;
  return {
    search: (o) => call("GET", "/files", { query: { q: o.q, parent: o.parent, mimeType: o.mimeType } }),
    get: (id) => call("GET", f(id)),
    copy: (id, o) => call("POST", `${f(id)}/copy`, { body: o }),
    createFolder: (name, parentId) => call("POST", "/files", { body: { name, mimeType: FOLDER_MIME, parents: [parentId], ownerEmail: FAKE_OWNER } }),
    // The fake keeps no bytes: it records the file, like any other it holds.
    upload: (o) => call("POST", "/files", { body: { name: o.name, mimeType: o.mimeType, parents: [o.parentId], ownerEmail: FAKE_OWNER } }),
    share: (id, emails, role = "reader") => call("POST", `${f(id)}/share`, { body: { emails, role } }),
    rename: (id, name) => call("PATCH", f(id), { body: { name } }),
    permissions: (id) => call("GET", `${f(id)}/permissions`),
    download: (id, range) => fetch(`${baseUrl}${f(id)}/content`, { headers: range ? { range } : {} }),
  };
}

// ---------- the Drive API ----------

interface GPermission { type: "user" | "group" | "domain" | "anyone"; role: string; emailAddress?: string; domain?: string }
interface GFile { id: string; name: string; mimeType: string; owners?: { emailAddress?: string }[]; parents?: string[]; permissions?: GPermission[]; createdTime?: string; webViewLink?: string }
type Sharing = Pick<DriveFile, "permissions" | "anyoneWithLink" | "domains">;

const PERM_FIELDS = "emailAddress,role,type,domain";
const FILE_FIELDS = `id,name,mimeType,owners(emailAddress),parents,permissions(${PERM_FIELDS}),createdTime,webViewLink`;
const ALL_DRIVES = { supportsAllDrives: "true" };
/** Drive query string literal. */
const lit = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

const roleOf = (r: string): DrivePermission["role"] => (r === "owner" ? "owner" : r === "writer" || r === "organizer" || r === "fileOrganizer" ? "writer" : "reader");
/** People and groups by address. */
const people = (ps: GPermission[] = []): DrivePermission[] =>
  ps.filter((p) => (p.type === "user" || p.type === "group") && p.emailAddress).map((p) => ({ email: p.emailAddress!.toLowerCase(), role: roleOf(p.role) }));

/** Who can open a file, from its permission list: people and groups, anyone with the link, whole domains. */
function sharing(ps: GPermission[]): Sharing {
  const domains = ps.filter((p) => p.type === "domain" && p.domain).map((p) => p.domain!.toLowerCase());
  return { permissions: people(ps), ...(ps.some((p) => p.type === "anyone") ? { anyoneWithLink: true } : {}), ...(domains.length ? { domains } : {}) };
}

/**
 * Drive sends `permissions` only when the caller can share the file, and never for an item in a shared drive (the band folder
 * is one): then the file says permissionsUnknown rather than "shared with nobody". Shared-drive items have no owners either.
 */
function toFile(f: GFile): DriveFile {
  return {
    id: f.id, name: f.name, mimeType: f.mimeType, ownerEmail: f.owners?.[0]?.emailAddress?.toLowerCase() ?? "", parents: f.parents ?? [],
    createdAt: f.createdTime ?? "", webViewLink: f.webViewLink ?? `https://drive.google.com/open?id=${f.id}`,
    ...sharing(f.permissions ?? []), ...(f.permissions ? {} : { permissionsUnknown: true }),
  };
}

const RANK = { reader: 1, writer: 2, owner: 3 } as const;

export function googleDrive(token: TokenSource, baseUrl = "https://www.googleapis.com/drive/v3", uploadUrl = "https://www.googleapis.com/upload/drive/v3"): DriveService {
  const call = googleJson("drive", baseUrl, token);
  const f = (id: string) => `/files/${encodeURIComponent(id)}`;
  const listPermissions = (id: string) => call<{ permissions?: GPermission[] }>("GET", `${f(id)}/permissions`, { query: { fields: `permissions(${PERM_FIELDS})`, ...ALL_DRIVES } });
  // A file without permissions (see toFile) gets them from permissions.list, which answers for shared-drive items too, inherited
  // folder permissions included. If that is refused as well, the file stays permissionsUnknown.
  const get = async (id: string) => {
    const file = toFile(await call<GFile>("GET", f(id), { query: { fields: FILE_FIELDS, ...ALL_DRIVES } }));
    if (!file.permissionsUnknown) return file;
    let ps: GPermission[] | undefined;
    try { ps = (await listPermissions(id)).permissions; } catch (e) { if (!(e instanceof IntegrationError)) throw e; }
    if (!ps?.length) return file;
    const { permissionsUnknown: _, ...known } = file;
    return { ...known, ...sharing(ps) };
  };
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
    async createFolder(name, parentId) {
      return toFile(await call<GFile>("POST", "/files", { query: { fields: FILE_FIELDS, ...ALL_DRIVES }, body: { name, mimeType: FOLDER_MIME, parents: [parentId] } }));
    },
    async upload(o) {
      // Resumable, in one go: open a session with the metadata, then PUT the bytes to the URL it returns. Multipart is for 5 MB or less.
      const qs = new URLSearchParams({ uploadType: "resumable", fields: FILE_FIELDS, ...ALL_DRIVES });
      const start = async (force: boolean) => fetch(`${uploadUrl}/files?${qs}`, {
        method: "POST",
        headers: { authorization: `Bearer ${await token(force)}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-type": o.mimeType },
        body: JSON.stringify({ name: o.name, mimeType: o.mimeType, parents: [o.parentId] }),
      });
      let res = await start(false);
      if (res.status === 401) res = await start(true);
      const session = res.headers.get("location");
      if (!res.ok || !session) {
        const err = await res.json().catch(() => undefined);
        throw new IntegrationError("drive", res.status, err?.error?.message ?? res.statusText);
      }
      const put = await fetch(session, { method: "PUT", headers: { "content-type": o.mimeType }, body: o.data });
      const data = await put.json().catch(() => undefined);
      if (!put.ok) throw new IntegrationError("drive", put.status, data?.error?.message ?? put.statusText);
      return toFile(data as GFile);
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
    async rename(id, name) {
      return toFile(await call<GFile>("PATCH", f(id), { query: { fields: FILE_FIELDS, ...ALL_DRIVES }, body: { name } }));
    },
    async permissions(id) {
      return people((await listPermissions(id)).permissions);
    },
    async download(id, range) {
      const qs = new URLSearchParams({ alt: "media", ...ALL_DRIVES });
      const get = async (force: boolean) => fetch(`${baseUrl}${f(id)}?${qs}`, { headers: { authorization: `Bearer ${await token(force)}`, ...(range ? { range } : {}) } });
      let res = await get(false);
      if (res.status === 401) res = await get(true);
      if (!res.ok) {
        const err = await res.json().catch(() => undefined);
        throw new IntegrationError("drive", res.status, err?.error?.message ?? res.statusText);
      }
      return res;
    },
  };
}
