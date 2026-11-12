/**
 * Google Drive. Two implementations of DriveService: the fake's HTTP client (fakes/fake-drive; dev and tests) and the
 * Drive API v3 (files.list/get/create/copy/update, uploads, thumbnails, permissions.list/create), chosen by driveClient(). The real one runs as the band's
 * Google account (the admin named on the artist, see src/server/google/band.ts), so search sees that person's Drive.
 */
import { IntegrationError, jsonClient } from "./http";
import { googleJson, useRealGoogle, type TokenSource } from "./google";
import { bandToken } from "../google/band";
import type { GDocument } from "../docText";

export interface DrivePermission { email: string; role: "owner" | "writer" | "reader" }
export interface DriveFile {
  id: string; name: string; mimeType: string; ownerEmail: string; parents: string[]; permissions: DrivePermission[]; createdAt: string; webViewLink: string;
  /** When the file's content last changed (ISO), so a cached export can tell it is still current. */
  modifiedTime?: string;
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
  /** Bytes, when Drive knows (not for folders or Google Docs). */
  size?: number;
  /** imageMediaMetadata. width/height as Drive reports them (before rotation). time is "YYYY:MM:DD HH:MM:SS", camera-local. */
  image?: { width: number; height: number; time?: string; rotation?: number };
  /** A short-lived link to Drive's preview image; thumbnail() fetches it at a size. */
  thumbnailLink?: string;
  trashed?: boolean;
}

/** What list() returns: one page. */
export interface DriveList { files: DriveFile[]; nextPageToken?: string }
export interface DriveListOpts {
  /** Files whose parent is any of these. */
  parents: string[];
  /** images: mimeType contains "image/", or a photo extension (HEIC often comes as octet-stream). */
  kind: "folders" | "images" | "all";
  orderBy?: "createdTime desc";
  /** Default 1000. */
  pageSize?: number;
  pageToken?: string;
}

export interface DriveService {
  search(opts: { q?: string; parent?: string; mimeType?: string }): Promise<DriveFile[]>;
  get(id: string): Promise<DriveFile>;
  copy(id: string, opts: { parentId: string; name?: string }): Promise<DriveFile>;
  createFolder(name: string, parentId: string): Promise<DriveFile>;
  /** A new file in `parentId` with these bytes. `as` converts on the way in (text/csv as a Google Sheet). */
  upload(opts: { name: string; mimeType: string; parentId: string; data: Blob; as?: string }): Promise<DriveFile>;
  /** New bytes for a file that exists (its id, name and place stay); a Google Sheet takes CSV and is rewritten from it. */
  replace(id: string, opts: { mimeType: string; data: Blob }): Promise<DriveFile>;
  share(id: string, emails: string[], role?: "reader" | "writer"): Promise<DriveFile>;
  /** Give the file a new name (its id and place stay). */
  rename(id: string, name: string): Promise<DriveFile>;
  permissions(id: string): Promise<DrivePermission[]>;
  /** The file's bytes as Drive sends them (streamed). `range` is passed on as the Range header. */
  download(id: string, range?: string | null): Promise<Response>;
  /** A Google Doc (Sheet, Slides) converted to `mimeType`, as text. Only "text/plain" is used, for a Doc's lyrics. */
  export(id: string, mimeType: "text/plain"): Promise<string>;
  /** A Google Doc from the Docs API (documents.get, every tab's content): tabs, tables, text runs with bold and italic. */
  document(id: string): Promise<GDocument>;
  /** One page of non-trashed files whose parent is any of `parents`. */
  list(opts: DriveListOpts): Promise<DriveList>;
  /** files.update: a new name and/or parents (a move). */
  update(id: string, opts: { name?: string; addParents?: string[]; removeParents?: string[] }): Promise<DriveFile>;
  /** files.update trashed=true. Only for a post folder Roadie made, once it's empty (src/server/postFolder.ts). */
  trash(id: string): Promise<void>;
  /** Drive's preview of the file, its long edge `size` px, fetched as the band account. IntegrationError 404 when Drive has no preview yet. */
  thumbnail(id: string, size: number): Promise<Response>;
  /** Can the band account move files into and out of this folder (capabilities.canMoveChildrenWithinDrive)? */
  canMoveIn(folderId: string): Promise<boolean>;
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
const FAKE_OWNER = "rudy@example.com";

export function fakeDriveClient(baseUrl: string): DriveService {
  const call = jsonClient("drive", baseUrl);
  const f = (id: string) => `/files/${encodeURIComponent(id)}`;
  return {
    search: (o) => call("GET", "/files", { query: { q: o.q, parent: o.parent, mimeType: o.mimeType } }),
    get: (id) => call("GET", f(id)),
    copy: (id, o) => call("POST", `${f(id)}/copy`, { body: o }),
    createFolder: (name, parentId) => call("POST", "/files", { body: { name, mimeType: FOLDER_MIME, parents: [parentId], ownerEmail: FAKE_OWNER } }),
    // The fake keeps no bytes, except text (a CSV for a sheet), so tests can read back what was written.
    upload: async (o) => call("POST", "/files", { body: { name: o.name, mimeType: o.as ?? o.mimeType, parents: [o.parentId], ownerEmail: FAKE_OWNER, ...(o.mimeType.startsWith("text/") ? { text: await o.data.text() } : {}) } }),
    replace: async (id, o) => call("PUT", `${f(id)}/content`, { body: { mimeType: o.mimeType, ...(o.mimeType.startsWith("text/") ? { text: await o.data.text() } : {}) } }),
    share: (id, emails, role = "reader") => call("POST", `${f(id)}/share`, { body: { emails, role } }),
    rename: (id, name) => call("PATCH", f(id), { body: { name } }),
    list: (o) => call("GET", "/files/list", { query: { parents: o.parents.join(","), kind: o.kind, orderBy: o.orderBy, pageSize: o.pageSize?.toString(), pageToken: o.pageToken } }),
    update: (id, o) => call("PATCH", f(id), { body: o }),
    trash: async (id) => { await call("PATCH", f(id), { body: { trashed: true } }); },
    thumbnail: async (id, size) => {
      const res = await fetch(`${baseUrl}/thumbnails/${encodeURIComponent(id)}?s=${size}`);
      if (!res.ok) throw new IntegrationError("drive", res.status, (await res.json().catch(() => undefined))?.error?.message ?? res.statusText);
      return res;
    },
    canMoveIn: async (id) => !!(await call<{ capabilities?: { canMoveChildrenWithinDrive?: boolean } }>("GET", f(id))).capabilities?.canMoveChildrenWithinDrive,
    permissions: (id) => call("GET", `${f(id)}/permissions`),
    download: (id, range) => fetch(`${baseUrl}${f(id)}/content`, { headers: range ? { range } : {} }),
    export: async (id, mimeType) => exportText(await fetch(`${baseUrl}${f(id)}/export?${new URLSearchParams({ mimeType })}`)),
    document: (id) => call("GET", `/docs/v1/documents/${encodeURIComponent(id)}`, { query: { includeTabsContent: "true" } }),
  };
}

// ---------- the Drive API ----------

interface GPermission { type: "user" | "group" | "domain" | "anyone"; role: string; emailAddress?: string; domain?: string }
interface GFile {
  id: string; name: string; mimeType: string; owners?: { emailAddress?: string }[]; parents?: string[]; permissions?: GPermission[]; createdTime?: string; modifiedTime?: string; webViewLink?: string;
  size?: string; imageMediaMetadata?: { width?: number; height?: number; time?: string; rotation?: number }; thumbnailLink?: string; trashed?: boolean;
}
type Sharing = Pick<DriveFile, "permissions" | "anyoneWithLink" | "domains">;

const PERM_FIELDS = "emailAddress,role,type,domain";
const FILE_FIELDS = `id,name,mimeType,owners(emailAddress),parents,permissions(${PERM_FIELDS}),createdTime,modifiedTime,webViewLink,size,imageMediaMetadata(width,height,time,rotation),thumbnailLink,trashed`;
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
    createdAt: f.createdTime ?? "", ...(f.modifiedTime ? { modifiedTime: f.modifiedTime } : {}), webViewLink: f.webViewLink ?? `https://drive.google.com/open?id=${f.id}`,
    ...sharing(f.permissions ?? []), ...(f.permissions ? {} : { permissionsUnknown: true }),
    ...(f.size !== undefined ? { size: Number(f.size) } : {}),
    ...(f.imageMediaMetadata?.width && f.imageMediaMetadata.height ? { image: {
      width: f.imageMediaMetadata.width, height: f.imageMediaMetadata.height,
      ...(f.imageMediaMetadata.time ? { time: f.imageMediaMetadata.time } : {}), ...(f.imageMediaMetadata.rotation !== undefined ? { rotation: f.imageMediaMetadata.rotation } : {}),
    } } : {}),
    ...(f.thumbnailLink ? { thumbnailLink: f.thumbnailLink } : {}), ...(f.trashed !== undefined ? { trashed: f.trashed } : {}),
  };
}

/** Drive's query for list(): any of the parents, not trashed, and the kind. */
export function listQuery(parents: string[], kind: DriveListOpts["kind"]): string {
  const q = `(${parents.map((p) => `${lit(p)} in parents`).join(" or ")}) and trashed = false`;
  if (kind === "images") return `${q} and (mimeType contains 'image/' or name contains '.heic' or name contains '.HEIC' or name contains '.heif')`;
  if (kind === "folders") return `${q} and mimeType = '${FOLDER_MIME}'`;
  return q;
}

/** An export's body as text, or an IntegrationError carrying Drive's status (403/404: the band account can't read it). */
async function exportText(res: Response): Promise<string> {
  if (!res.ok) {
    const err = await res.json().catch(() => undefined);
    throw new IntegrationError("drive", res.status, err?.error?.message ?? res.statusText);
  }
  return res.text();
}

const RANK = { reader: 1, writer: 2, owner: 3 } as const;

export function googleDrive(token: TokenSource, baseUrl = "https://www.googleapis.com/drive/v3", uploadUrl = "https://www.googleapis.com/upload/drive/v3", docsUrl = "https://docs.googleapis.com/v1"): DriveService {
  const call = googleJson("drive", baseUrl, token);
  const docs = googleJson("docs", docsUrl, token);
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
  const update = async (id: string, o: { name?: string; addParents?: string[]; removeParents?: string[] }) => toFile(await call<GFile>("PATCH", f(id), {
    query: { fields: FILE_FIELDS, ...ALL_DRIVES, ...(o.addParents?.length ? { addParents: o.addParents.join(",") } : {}), ...(o.removeParents?.length ? { removeParents: o.removeParents.join(",") } : {}) },
    body: o.name ? { name: o.name } : {},
  }));
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
        body: JSON.stringify({ name: o.name, mimeType: o.as ?? o.mimeType, parents: [o.parentId] }),
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
    async replace(id, o) {
      // files.update with uploadType=media: a Google Sheet given CSV is imported again from it, keeping its id and link.
      const qs = new URLSearchParams({ uploadType: "media", fields: FILE_FIELDS, ...ALL_DRIVES });
      const put = async (force: boolean) => fetch(`${uploadUrl}${f(id)}?${qs}`, { method: "PATCH", headers: { authorization: `Bearer ${await token(force)}`, "content-type": o.mimeType }, body: o.data });
      let res = await put(false);
      if (res.status === 401) res = await put(true);
      const data = await res.json().catch(() => undefined);
      if (!res.ok) throw new IntegrationError("drive", res.status, data?.error?.message ?? res.statusText);
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
    rename: (id, name) => update(id, { name }),
    async list(o) {
      const r = await call<{ files?: GFile[]; nextPageToken?: string }>("GET", "/files", { query: {
        q: listQuery(o.parents, o.kind), fields: `nextPageToken,files(${FILE_FIELDS})`, pageSize: String(o.pageSize ?? 1000),
        ...(o.orderBy ? { orderBy: o.orderBy } : {}), ...(o.pageToken ? { pageToken: o.pageToken } : {}), includeItemsFromAllDrives: "true", ...ALL_DRIVES,
      } });
      return { files: (r.files ?? []).map(toFile), ...(r.nextPageToken ? { nextPageToken: r.nextPageToken } : {}) };
    },
    update,
    async trash(id) {
      await call("PATCH", f(id), { query: { fields: "id", ...ALL_DRIVES }, body: { trashed: true } });
    },
    async thumbnail(id, size) {
      const link = (await call<GFile>("GET", f(id), { query: { fields: "thumbnailLink", ...ALL_DRIVES } })).thumbnailLink;
      if (!link) throw new IntegrationError("drive", 404, "Drive has no preview of this file yet");
      // The link ends "=s220"; ask for the size we want. It needs the band account's token, like the API.
      const sized = /=s\d+$/.test(link) ? link.replace(/=s\d+$/, `=s${size}`) : `${link}=s${size}`;
      const get = async (force: boolean) => fetch(sized, { headers: { authorization: `Bearer ${await token(force)}` } });
      let res = await get(false);
      if (res.status === 401) res = await get(true);
      if (!res.ok) throw new IntegrationError("drive", res.status === 403 ? 404 : res.status, res.statusText || "Drive has no preview of this file");
      return res;
    },
    async canMoveIn(id) {
      const r = await call<{ capabilities?: { canMoveChildrenWithinDrive?: boolean } }>("GET", f(id), { query: { fields: "capabilities(canMoveChildrenWithinDrive)", ...ALL_DRIVES } });
      return !!r.capabilities?.canMoveChildrenWithinDrive;
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
    async export(id, mimeType) {
      // files.export: Docs Editors files only, up to 10 MB. No supportsAllDrives here: the API takes none for export.
      const qs = new URLSearchParams({ mimeType });
      const get = async (force: boolean) => fetch(`${baseUrl}${f(id)}/export?${qs}`, { headers: { authorization: `Bearer ${await token(force)}` } });
      let res = await get(false);
      if (res.status === 401) res = await get(true);
      return exportText(res);
    },
    // documents.get reads with the drive scope the band account already granted. includeTabsContent: every tab, not just the first.
    document: (id) => docs("GET", `/documents/${encodeURIComponent(id)}`, { query: { includeTabsContent: "true" } }),
  };
}
