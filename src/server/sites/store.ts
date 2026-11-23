/**
 * SiteStore (docs/designs/sites, Decision 2): the only module that reads or writes a site's doc, draft, sources, images and
 * versions. The draft (`sitePages`) goes through the scoped Writer, so edits autosave, join the run and can be undone. Everything
 * else is written raw with the Admin SDK through `stampSystem`, so undoing an edit run can never move a public site. Every path
 * is built with pathOf, under the caller's own artist.
 */
import { createHash } from "node:crypto";
import { FieldValue, Timestamp, type DocumentData, type Transaction } from "firebase-admin/firestore";
import { firestore } from "../admin";
import { db, run, type Doc } from "../db";
import { layout } from "../layout";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { pathOf } from "@/schema/owners";
import { SCHEMA_VERSION } from "@/schema/common";
import type { SiteFile } from "./render";
import type { SiteTarget, SiteVersion } from "@/schema/sites";

export const pageIdOf = (path: string) => createHash("sha256").update(path).digest("hex").slice(0, 40);
export const sourceHash = (f: { path: string; kind: string; body: string }) => (f.kind === "image" ? f.body : createHash("sha256").update(`${f.kind}\n${f.path}\n${f.body}`).digest("hex"));

/** The site doc, as stored. */
export interface SiteDoc extends DocumentData {
  id: string; artistId: string; name: string;
  hosting: { project: string; liveSite: string; stagingSite: string };
  liveVersion?: number; stagingVersion?: number; nextN: number; autoRefresh: boolean;
  refreshPaused?: { live?: boolean; staging?: boolean };
  lease?: { token: string; by: string; until: number } | null;
  checkedAt?: number; lastError?: string;
}

/** The common fields every raw site write carries (commonShape), so a restore validates them like any record. */
export function stampSystem(doc: Record<string, unknown>, o: { id: string; by: string; runId: string; prev?: DocumentData }): DocumentData {
  const now = Timestamp.now();
  return {
    ...doc, id: o.id, schemaVersion: o.prev?.schemaVersion ?? SCHEMA_VERSION, createdAt: o.prev?.createdAt ?? now, updatedAt: now,
    createdBy: o.prev?.createdBy ?? o.by, updatedBy: o.by, via: "app", runId: o.runId, deletedAt: null, rev: ((o.prev?.rev as number | undefined) ?? 0) + 1,
  };
}

/** Physical refs, for one artist. */
export async function refs(artistId: string) {
  await layout();
  const fs = firestore();
  const parent = { kind: "sites", id: artistId };
  return {
    site: fs.collection(pathOf("sites", { artistId })).doc(artistId),
    versions: fs.collection(pathOf("siteVersions", { artistId, parent })),
    sources: fs.collection(pathOf("siteSources", { artistId, parent })),
    assets: fs.collection(pathOf("siteAssets", { artistId, parent })),
  };
}

/** The artist's site, or a 403 when the artist has none (the Website feature is off). */
export async function requireSite(ctx: Ctx): Promise<SiteDoc> {
  const r = await refs(ctx.artistId);
  const s = await r.site.get();
  if (!s.exists) throw new AppError("forbidden", "This artist has no website in Roadie yet.", 403);
  return { ...(s.data() as SiteDoc), id: s.id };
}

export async function readSite(artistId: string): Promise<SiteDoc | null> {
  const s = await (await refs(artistId)).site.get();
  return s.exists ? ({ ...(s.data() as SiteDoc), id: s.id }) : null;
}

/** Create the site doc (scripts/sites-create.ts). */
export async function createSiteDoc(artistId: string, name: string, hosting: SiteDoc["hosting"], by: string) {
  const r = await refs(artistId);
  const there = await r.site.get();
  if (there.exists) return { ...(there.data() as SiteDoc), id: artistId };
  const doc = stampSystem({ artistId, name, hosting, nextN: 1, autoRefresh: true }, { id: artistId, by, runId: `site-create-${artistId}` });
  await r.site.set(doc);
  return doc as SiteDoc;
}

// ---------- the draft ----------

const pagesPath = (artistId: string) => `sites/${artistId}/sitePages`;

export async function draftFiles(ctx: Ctx, opts: { includeDeleted?: boolean } = {}): Promise<(Doc & SiteFile)[]> {
  const rows = await db.list(ctx, pagesPath(ctx.artistId), undefined, opts);
  return (rows as (Doc & SiteFile)[]).sort((a, b) => a.path.localeCompare(b.path));
}

export async function draftFile(ctx: Ctx, path: string): Promise<(Doc & SiteFile) | null> {
  const d = await db.get(ctx, pagesPath(ctx.artistId), pageIdOf(path));
  return d && !d.deletedAt ? (d as Doc & SiteFile) : null;
}

/** Create or replace one draft file (a removed one is brought back). Through the Writer: autosaved, in the run, undoable. */
export async function writeDraft(ctx: Ctx, f: SiteFile): Promise<{ id: string; created: boolean; changed: boolean }> {
  const id = pageIdOf(f.path);
  const p = pagesPath(ctx.artistId);
  return run(ctx, async (w) => {
    const there = await w.get(p, id);
    if (!there) { await w.create(p, { path: f.path, kind: f.kind, body: f.body }, { id }); return { id, created: true, changed: true }; }
    if (there.deletedAt) await w.restore(p, id);
    const r = await w.update(p, id, { body: f.body, kind: f.kind });
    return { id, created: false, changed: r.changed || !!there.deletedAt };
  });
}

export async function removeDraft(ctx: Ctx, path: string) {
  const id = pageIdOf(path);
  const there = await draftFile(ctx, path);
  if (!there) throw new AppError("not_found", `No draft file ${path}`, 404);
  await run(ctx, (w) => w.softDelete(pagesPath(ctx.artistId), id));
  return { path, removed: true };
}

// ---------- sources and images ----------

/** Save each file's source once, under its hash (images are saved as assets on upload). */
export async function saveSources(artistId: string, files: SiteFile[], by: string, runId: string) {
  const r = await refs(artistId);
  const todo = files.filter((f) => f.kind !== "image");
  const snaps = todo.length ? await firestore().getAll(...todo.map((f) => r.sources.doc(sourceHash(f)))) : [];
  const batch = firestore().batch();
  let n = 0;
  snaps.forEach((s, i) => {
    if (s.exists) return;
    const f = todo[i];
    batch.set(s.ref, stampSystem({ artistId, path: f.path, kind: f.kind, body: f.body }, { id: s.id, by, runId }));
    n++;
  });
  if (n) await batch.commit();
}

/** A version's files, from its frozen sources. */
export async function loadSources(artistId: string, sources: Record<string, string>): Promise<SiteFile[]> {
  const r = await refs(artistId);
  const entries = Object.entries(sources);
  const text = entries.filter(([p]) => !p.startsWith("img/"));
  const snaps = text.length ? await firestore().getAll(...text.map(([, h]) => r.sources.doc(h))) : [];
  const out: SiteFile[] = snaps.map((s, i) => {
    if (!s.exists) throw new AppError("missing_source", `The source of ${text[i][0]} is missing`, 500);
    const d = s.data()!;
    return { path: d.path, kind: d.kind, body: d.body };
  });
  for (const [p, h] of entries) if (p.startsWith("img/")) out.push({ path: p, kind: "image", body: h });
  return out;
}

export async function saveAsset(artistId: string, bytes: Buffer, type: string, name: string, by: string, runId: string): Promise<string> {
  if (bytes.length > 950_000) throw new AppError("too_large", "That image is over 950 KB even after resizing", 400);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const r = await refs(artistId);
  const ref = r.assets.doc(sha);
  if (!(await ref.get()).exists) await ref.set(stampSystem({ artistId, type, size: bytes.length, data: bytes, name }, { id: sha, by, runId }));
  return sha;
}

export async function loadAssets(artistId: string, shas: string[]): Promise<Map<string, { bytes: Buffer; type: string }>> {
  const r = await refs(artistId);
  const uniq = [...new Set(shas)];
  const out = new Map<string, { bytes: Buffer; type: string }>();
  if (!uniq.length) return out;
  const snaps = await firestore().getAll(...uniq.map((h) => r.assets.doc(h)));
  for (const s of snaps) {
    if (!s.exists) throw new AppError("missing_image", `Image ${s.id.slice(0, 8)} is missing`, 500);
    const d = s.data()!;
    out.set(s.id, { bytes: Buffer.from(d.data as Uint8Array), type: d.type });
  }
  return out;
}

// ---------- versions ----------

export async function listVersions(artistId: string, limit = 50): Promise<SiteVersion[]> {
  const r = await refs(artistId);
  const s = await r.versions.orderBy("n", "desc").limit(limit).get();
  return s.docs.map((d) => ({ ...(d.data() as SiteVersion), id: d.id }));
}

export async function getVersion(artistId: string, n: number): Promise<SiteVersion | null> {
  const s = await (await refs(artistId)).versions.doc(String(n)).get();
  return s.exists ? ({ ...(s.data() as SiteVersion), id: s.id }) : null;
}

export const pointerOf = (site: SiteDoc, target: SiteTarget) => (target === "live" ? site.liveVersion : site.stagingVersion);
export const hostingSiteOf = (site: SiteDoc, target: SiteTarget) => (target === "live" ? site.hosting.liveSite : site.hosting.stagingSite);

/** Run a transaction on the site doc. */
export async function siteTx<T>(artistId: string, fn: (tx: Transaction, site: SiteDoc, r: Awaited<ReturnType<typeof refs>>) => Promise<T>): Promise<T> {
  const r = await refs(artistId);
  return firestore().runTransaction(async (tx) => {
    const s = await tx.get(r.site);
    if (!s.exists) throw new AppError("not_found", "No site", 404);
    return fn(tx, { ...(s.data() as SiteDoc), id: s.id }, r);
  });
}

export const deleteField = () => FieldValue.delete();

/** Every artist's site (the refresh job). Nested and flat layouts both hold them under a collection named `sites`. */
export async function listAllSiteArtists(): Promise<string[]> {
  await layout();
  const s = await firestore().collectionGroup("sites").get();
  return [...new Set(s.docs.map((d) => d.data().artistId).filter((a): a is string => typeof a === "string"))];
}
