/**
 * Firebase Hosting's REST API (v1beta1), the only way sites are released (docs/designs/sites, Decision 1). The real client runs
 * when SITES_HOSTING_PROJECT is set (production: roadie-prod-iab for now, roadie-sites later), with the server's application
 * default credentials and `x-goog-user-project` set to that project. Everywhere else (dev, the emulators, unit and e2e tests) an
 * in-memory fake with the same behaviour answers: versions, deduped uploads, releases and their history, and failures on demand.
 */
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import type { HostingConfig } from "../sites/render";

export interface HostingRelease { name: string; version: string; message?: string; releaseTime: string; type?: string }

export interface HostingApi {
  readonly real: boolean;
  /** The public host of a Hosting site: "<site>.web.app". */
  hostOf(site: string): string;
  createSite(project: string, site: string): Promise<void>;
  /** Keep this many releases on the live channel (1–100). */
  setRetention(site: string, count: number): Promise<void>;
  createVersion(site: string, config: HostingConfig): Promise<string>;
  /** Hosting path → sha256 of the gzipped bytes; returns the hashes Hosting lacks and where to upload them. */
  populateFiles(version: string, files: Record<string, string>): Promise<{ uploadRequiredHashes: string[]; uploadUrl: string }>;
  upload(uploadUrl: string, hash: string, gz: Buffer): Promise<void>;
  finalize(version: string): Promise<void>;
  release(site: string, version: string, message: string): Promise<HostingRelease>;
  /** Newest first. */
  listReleases(site: string): Promise<HostingRelease[]>;
  deleteVersion(version: string): Promise<void>;
  /** The files a version serves: path → hash (for a release Roadie didn't build). */
  listFiles(version: string): Promise<Record<string, string>>;
}

export const gz = (b: Buffer | string) => gzipSync(typeof b === "string" ? Buffer.from(b) : b, { level: 9, mtime: 0 } as never);
export const hashOf = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export class HostingError extends Error {
  constructor(public status: number, message: string) { super(`Firebase Hosting: ${message} (HTTP ${status})`); }
}

// ---------- real ----------

const BASE = "https://firebasehosting.googleapis.com/v1beta1";

async function token(): Promise<string> {
  const { applicationDefault } = await import("firebase-admin/app");
  const t = await applicationDefault().getAccessToken();
  return t.access_token;
}

function realHosting(project: string): HostingApi {
  const call = async <T>(method: string, url: string, body?: unknown, raw?: Buffer): Promise<T> => {
    const res = await fetch(url.startsWith("http") ? url : `${BASE}/${url}`, {
      method,
      headers: {
        authorization: `Bearer ${await token()}`, "x-goog-user-project": project,
        ...(raw ? { "content-type": "application/octet-stream" } : body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: raw ? new Uint8Array(raw) : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: { error?: { message?: string } } | undefined;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
    if (!res.ok) throw new HostingError(res.status, data?.error?.message ?? (text.slice(0, 200) || res.statusText));
    return data as T;
  };
  return {
    real: true,
    hostOf: (site) => `${site}.web.app`,
    async createSite(p, site) {
      try { await call("POST", `projects/${p}/sites?siteId=${encodeURIComponent(site)}`, {}); } catch (e) {
        if (!(e instanceof HostingError && e.status === 409)) throw e;
      }
    },
    async setRetention(site, count) {
      await call("PATCH", `sites/${site}/channels/live?updateMask=retainedReleaseCount`, { retainedReleaseCount: count });
    },
    async createVersion(site, config) {
      const v = await call<{ name: string }>("POST", `sites/${site}/versions`, { config });
      return v.name;
    },
    async populateFiles(version, files) {
      const r = await call<{ uploadRequiredHashes?: string[]; uploadUrl: string }>("POST", `${version}:populateFiles`, { files });
      return { uploadRequiredHashes: r.uploadRequiredHashes ?? [], uploadUrl: r.uploadUrl };
    },
    async upload(uploadUrl, hash, body) { await call("POST", `${uploadUrl}/${hash}`, undefined, body); },
    async finalize(version) { await call("PATCH", `${version}?updateMask=status`, { status: "FINALIZED" }); },
    async release(site, version, message) {
      const r = await call<{ name: string; version: { name: string }; message?: string; releaseTime: string; type?: string }>(
        "POST", `sites/${site}/releases?versionName=${encodeURIComponent(version)}`, { message });
      return { name: r.name, version: r.version.name, message: r.message, releaseTime: r.releaseTime, type: r.type };
    },
    async listReleases(site) {
      const r = await call<{ releases?: { name: string; version?: { name: string }; message?: string; releaseTime: string; type?: string }[] }>("GET", `sites/${site}/releases?pageSize=100`);
      return (r.releases ?? []).map((x) => ({ name: x.name, version: x.version?.name ?? "", message: x.message, releaseTime: x.releaseTime, type: x.type }));
    },
    async deleteVersion(version) { await call("DELETE", version).catch(() => {}); },
    async listFiles(version) {
      const out: Record<string, string> = {};
      let page: string | undefined;
      do {
        const r = await call<{ files?: { path: string; hash: string }[]; nextPageToken?: string }>("GET", `${version}/files?pageSize=1000${page ? `&pageToken=${page}` : ""}`);
        for (const f of r.files ?? []) out[f.path] = f.hash;
        page = r.nextPageToken;
      } while (page);
      return out;
    },
  };
}

// ---------- fake ----------

interface FakeVersion { name: string; site: string; config: HostingConfig; status: "CREATED" | "FINALIZED" | "DELETED"; files: Record<string, string> }
export interface FakeHostingState {
  sites: Record<string, { retained: number; releases: HostingRelease[] }>;
  versions: Record<string, FakeVersion>;
  /** hash → gzipped bytes */
  blobs: Record<string, Buffer>;
  /** Fail the next call to this method name (then clear). */
  failNext: Partial<Record<keyof HostingApi, string>>;
  seq: number;
  uploads: number;
}

const g = globalThis as unknown as { __fakeHosting?: FakeHostingState };
export function fakeHostingState(): FakeHostingState {
  return (g.__fakeHosting ??= { sites: {}, versions: {}, blobs: {}, failNext: {}, seq: 0, uploads: 0 });
}
export function resetFakeHosting() { delete g.__fakeHosting; }

/** What the fake serves at a path of a site (the newest release's version), gunzipped. For tests and the dev preview. */
export async function fakeServe(site: string, path: string): Promise<string | undefined> {
  const s = fakeHostingState();
  const rel = s.sites[site]?.releases[0];
  if (!rel) return undefined;
  const v = s.versions[rel.version];
  const p = path === "/" ? "/index.html" : v.files[path] ? path : `${path}.html`;
  const h = v.files[p];
  if (!h) return undefined;
  const { gunzipSync } = await import("node:zlib");
  return gunzipSync(s.blobs[h]).toString();
}

function fakeHosting(): HostingApi {
  const st = fakeHostingState;
  const maybeFail = (m: keyof HostingApi) => {
    const why = st().failNext[m];
    if (why) { delete st().failNext[m]; throw new HostingError(503, why); }
  };
  const site = (name: string) => (st().sites[name] ??= { retained: 10, releases: [] });
  return {
    real: false,
    hostOf: (s) => `${s}.web.app`,
    async createSite(_p, s) { maybeFail("createSite"); site(s); },
    async setRetention(s, count) { maybeFail("setRetention"); site(s).retained = count; },
    async createVersion(s, config) {
      maybeFail("createVersion");
      const name = `sites/${s}/versions/v${++st().seq}`;
      st().versions[name] = { name, site: s, config, status: "CREATED", files: {} };
      return name;
    },
    async populateFiles(version, files) {
      maybeFail("populateFiles");
      const v = st().versions[version];
      if (!v || v.status !== "CREATED") throw new HostingError(400, "version is not open");
      Object.assign(v.files, files);
      return { uploadRequiredHashes: [...new Set(Object.values(files))].filter((h) => !st().blobs[h]), uploadUrl: `fake://upload/${version}` };
    },
    async upload(_u, hash, body) {
      maybeFail("upload");
      if (hashOf(body) !== hash) throw new HostingError(400, "hash mismatch");
      st().blobs[hash] = body; st().uploads++;
    },
    async finalize(version) {
      maybeFail("finalize");
      const v = st().versions[version];
      for (const h of Object.values(v.files)) if (!st().blobs[h]) throw new HostingError(400, `missing file ${h}`);
      v.status = "FINALIZED";
    },
    async release(s, version, message) {
      maybeFail("release");
      const v = st().versions[version];
      if (!v || v.status !== "FINALIZED") throw new HostingError(400, "version is not finalized");
      const r: HostingRelease = { name: `sites/${s}/releases/r${++st().seq}`, version, message, releaseTime: new Date().toISOString(), type: "DEPLOY" };
      const x = site(s);
      x.releases.unshift(r);
      x.releases = x.releases.slice(0, Math.max(x.retained, 1));
      return r;
    },
    async listReleases(s) { maybeFail("listReleases"); return [...site(s).releases]; },
    async deleteVersion(version) { const v = st().versions[version]; if (v) v.status = "DELETED"; },
    async listFiles(version) { return { ...(st().versions[version]?.files ?? {}) }; },
  };
}

let override: HostingApi | undefined;
/** Tests can swap the client. */
export function setHostingClient(c: HostingApi | undefined) { override = c; }

/** The Hosting project sites live in, or undefined in dev and tests (the fake). */
export const sitesProject = () => process.env.SITES_HOSTING_PROJECT || undefined;

export function hostingClient(): HostingApi {
  if (override) return override;
  const p = sitesProject();
  return p ? realHosting(p) : fakeHosting();
}
