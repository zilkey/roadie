/**
 * Building and releasing (docs/designs/sites, Decision 3). `buildVersion` does the slow part before any lease: render, create a
 * Hosting version, upload only the files Hosting lacks, finalize. `releaseVersion` is the only code that changes what a Hosting
 * site serves: lease and check, guard, release, record, let go. `reconcile` makes the version docs match what Hosting serves.
 *
 * Not built yet (follow-ups in the design): the mirror bucket and the standby load balancer, image resizing at render.
 */
import { randomUUID } from "node:crypto";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { hostingClient, gz, hashOf, type HostingApi } from "../integrations/hosting";
import { renderSite, type BlockData, type SiteFile } from "./render";
import {
  deleteField, getVersion, hostingSiteOf, loadAssets, loadSources, pointerOf, readSite, saveSources, siteTx, sourceHash, stampSystem,
  type SiteDoc,
} from "./store";
import type { SiteTarget, SiteVersion } from "@/schema/sites";

const LEASE_MS = 120_000;
const GUARD_MS = 60_000;

export interface Build { hostingVersion: string; outputs: Record<string, string>; blockInputs: string; fresh: boolean; uploaded: number; removed: Record<string, string[]> }

/** Render, then create and finalize a Hosting version on that site. Uploads only what Hosting doesn't have. */
export async function buildVersion(a: { site: SiteDoc; target: SiteTarget; files: SiteFile[]; data: BlockData & { today?: string }; api?: HostingApi }): Promise<Build> {
  const api = a.api ?? hostingClient();
  const r = renderSite({ files: a.files, data: a.data }, { mode: "public", target: a.target, defaultHost: api.hostOf(a.site.hosting.liveSite), today: a.data.today });
  const assets = await loadAssets(a.site.artistId, Object.values(r.files).flatMap((f) => ("asset" in f ? [f.asset] : [])));
  const blobs = new Map<string, Buffer>();
  const outputs: Record<string, string> = {};
  for (const [p, f] of Object.entries(r.files)) {
    const z = gz("asset" in f ? assets.get(f.asset)!.bytes : f.text);
    const h = hashOf(z);
    blobs.set(h, z); outputs[p] = h;
  }
  const version = await api.createVersion(hostingSiteOf(a.site, a.target), r.config);
  try {
    let uploaded = 0;
    const paths = Object.keys(outputs);
    for (let i = 0; i < paths.length; i += 1000) {
      const chunk = Object.fromEntries(paths.slice(i, i + 1000).map((p) => [p, outputs[p]]));
      const need = await api.populateFiles(version, chunk);
      for (const h of need.uploadRequiredHashes) { await api.upload(need.uploadUrl, h, blobs.get(h)!); uploaded++; }
    }
    await api.finalize(version);
    return { hostingVersion: version, outputs, blockInputs: r.blockInputs, fresh: true, uploaded, removed: r.removed };
  } catch (e) {
    await api.deleteVersion(version);
    throw e;
  }
}

export interface ReleaseArgs {
  artistId: string; target: SiteTarget; kind: SiteVersion["kind"]; sources: Record<string, string> | null; build: Build; by: string;
  baseVersion?: number; fromVersion?: number; note?: string; api?: HostingApi;
}

/** The only code that changes what a Hosting site serves. Returns the new version number. */
export async function releaseVersion(a: ReleaseArgs): Promise<{ n: number; state: "done" | "pending" }> {
  const api = a.api ?? hostingClient();
  const token = randomUUID();
  let n: number;
  // 1. Lease and check, and write the version as pending.
  try {
    n = await siteTx(a.artistId, async (tx, site, r) => {
      if (site.lease && site.lease.until > Date.now()) throw new AppError("busy", "Someone is publishing. Try again in a minute.", 409);
      if (a.baseVersion !== undefined && pointerOf(site, a.target) !== a.baseVersion) throw new AppError("conflict", "The site changed while this was being prepared. Try again.", 409);
      const num = site.nextN;
      tx.update(r.site, { lease: { token, by: a.by, until: Date.now() + LEASE_MS }, nextN: num + 1 });
      const v: Omit<SiteVersion, "id"> = {
        artistId: a.artistId, n: num, site: a.target, state: "pending", kind: a.kind, sources: a.sources, blockInputs: a.build.blockInputs,
        outputs: a.build.outputs, hostingVersion: a.build.hostingVersion, leaseToken: token, by: a.by, at: Date.now(),
        ...(a.baseVersion !== undefined ? { baseVersion: a.baseVersion } : {}), ...(a.fromVersion !== undefined ? { fromVersion: a.fromVersion } : {}),
        ...(a.note ? { note: a.note } : {}),
      };
      tx.set(r.versions.doc(String(num)), stampSystem(v, { id: String(num), by: a.by, runId: token }));
      return num;
    });
  } catch (e) {
    if (a.build.fresh) await api.deleteVersion(a.build.hostingVersion);
    throw e;
  }
  const clearLease = () => siteTx(a.artistId, async (tx, site, r) => { if (site.lease?.token === token) tx.update(r.site, { lease: deleteField() }); }).catch(() => {});
  const fail = (e: unknown) => siteTx(a.artistId, async (tx, _s, r) => { tx.update(r.versions.doc(String(n)), { state: "failed", error: String((e as Error).message ?? e).slice(0, 400) }); }).catch(() => {});
  try {
    // 2. Guard: the lease is still ours with time to spare.
    await siteTx(a.artistId, async (_tx, site) => {
      if (site.lease?.token !== token || site.lease.until - Date.now() < GUARD_MS) throw new AppError("lease_lost", "The publish took too long. Try again.", 409);
    });
  } catch (e) { await fail(e); await clearLease(); throw e; }
  // 3. Release.
  const site0 = (await readSite(a.artistId))!;
  let releaseName: string;
  try {
    const rel = await api.release(hostingSiteOf(site0, a.target), a.build.hostingVersion, `roadie:${n}:${token}`);
    releaseName = rel.name;
  } catch (e) {
    await clearLease();
    await reconcile(a.artistId, { api }).catch(() => {});
    throw e;
  }
  // 4. Record, if the lease is still ours.
  const recorded = await siteTx(a.artistId, async (tx, site, r) => {
    if (site.lease?.token !== token) return false;
    tx.update(r.versions.doc(String(n)), { state: "done", releaseName });
    const pointer = a.target === "live" ? "liveVersion" : "stagingVersion";
    const paused = a.kind === "rollback" ? true : a.kind === "publish" || a.kind === "promote" ? false : site.refreshPaused?.[a.target];
    tx.update(r.site, { [pointer]: n, [`refreshPaused.${a.target}`]: !!paused, lease: deleteField() });
    return true;
  }).catch(() => false);
  if (!recorded) { await reconcile(a.artistId, { api }).catch(() => {}); return { n, state: "pending" }; }
  return { n, state: "done" };
}

const MESSAGE_RE = /^roadie:(\d+):([\w-]+)$/;

/**
 * Make the version docs match what Hosting serves: settle pending and failed versions by their release message, move each
 * pointer to its site's newest release, and record a release Roadie didn't make (a console rollback) as a `reconcile` version
 * that pauses refresh there.
 */
export async function reconcile(artistId: string, opts: { api?: HostingApi } = {}): Promise<{ changed: string[] }> {
  const api = opts.api ?? hostingClient();
  const token = `reconcile-${randomUUID()}`;
  const got = await siteTx(artistId, async (tx, site, r) => {
    if (site.lease && site.lease.until > Date.now()) return null;
    tx.update(r.site, { lease: { token, by: "system", until: Date.now() + LEASE_MS } });
    return site;
  });
  if (!got) return { changed: [] };
  const changed: string[] = [];
  try {
    for (const target of ["live", "staging"] as const) {
      const releases = await api.listReleases(hostingSiteOf(got, target));
      const mine = new Map<number, { token: string; name: string }>();
      for (const rel of releases) { const m = MESSAGE_RE.exec(rel.message ?? ""); if (m) mine.set(Number(m[1]), { token: m[2], name: rel.name }); }
      const newest = releases[0];
      await siteTx(artistId, async (tx, site, r) => {
        if (site.lease?.token !== token) return;
        const open = await tx.get(r.versions.where("state", "in", ["pending", "failed"]).limit(100));
        const settle: { n: number; state: "done" | "failed"; name?: string }[] = [];
        for (const d of open.docs) {
          const v = d.data() as SiteVersion;
          if (v.site !== target) continue;
          const hit = mine.get(v.n);
          const st = hit && hit.token === v.leaseToken ? "done" : "failed";
          if (st === "failed" && v.state === "failed") continue;
          settle.push({ n: v.n, state: st, name: hit?.name });
        }
        const nm = newest ? MESSAGE_RE.exec(newest.message ?? "") : null;
        let pointer: number | undefined;
        let pausedNow: boolean | undefined;
        let created: Record<string, unknown> | undefined;
        if (newest && nm) {
          pointer = Number(nm[1]);
          const doc = (await tx.get(r.versions.doc(String(pointer)))).data() as SiteVersion | undefined;
          if (doc) pausedNow = doc.kind === "rollback" || doc.kind === "reconcile" ? true : doc.kind === "refresh" ? site.refreshPaused?.[target] : false;
        } else if (newest) {
          // A release Roadie didn't make. Record it once (its release name), copying sources from a version with that hostingVersion.
          const seen = await tx.get(r.versions.where("releaseName", "==", newest.name).limit(1));
          if (!seen.empty) pointer = (seen.docs[0].data() as SiteVersion).n;
          else {
            const same = await tx.get(r.versions.where("hostingVersion", "==", newest.version).limit(1));
            const src = same.empty ? undefined : (same.docs[0].data() as SiteVersion);
            pointer = site.nextN;
            created = {
              artistId, n: pointer, site: target, state: "done", kind: "reconcile", sources: src?.sources ?? null, blockInputs: src?.blockInputs ?? "",
              outputs: src?.outputs ?? (await api.listFiles(newest.version)), hostingVersion: newest.version, releaseName: newest.name, leaseToken: token,
              by: "system", at: Date.parse(newest.releaseTime) || Date.now(), note: "Released outside Roadie (the Firebase console)",
            };
            pausedNow = true;
          }
        }
        for (const s of settle) { tx.update(r.versions.doc(String(s.n)), { state: s.state, ...(s.name ? { releaseName: s.name } : {}) }); changed.push(`${target}:${s.n}:${s.state}`); }
        if (created) { tx.set(r.versions.doc(String(pointer)), stampSystem(created, { id: String(pointer), by: "system", runId: token })); tx.update(r.site, { nextN: pointer! + 1 }); changed.push(`${target}:${pointer}:recorded`); }
        const key = target === "live" ? "liveVersion" : "stagingVersion";
        if (pointer !== undefined && pointerOf(site, target) !== pointer) { tx.update(r.site, { [key]: pointer }); changed.push(`${target}:pointer:${pointer}`); }
        if (pausedNow !== undefined && !!site.refreshPaused?.[target] !== pausedNow) tx.update(r.site, { [`refreshPaused.${target}`]: pausedNow });
      });
    }
    await siteTx(artistId, async (tx, site, r) => { if (site.lease?.token === token) tx.update(r.site, { lease: deleteField(), checkedAt: Date.now(), lastError: deleteField() }); });
  } catch (e) {
    await siteTx(artistId, async (tx, site, r) => { if (site.lease?.token === token) tx.update(r.site, { lease: deleteField(), checkedAt: Date.now(), lastError: String((e as Error).message).slice(0, 300) }); }).catch(() => {});
    throw e;
  }
  return { changed };
}

/** The draft's files, frozen: sources saved, path → hash. */
export async function freezeDraft(artistId: string, files: SiteFile[], by: string, runId: string): Promise<Record<string, string>> {
  await saveSources(artistId, files, by, runId);
  return Object.fromEntries(files.map((f) => [f.path, sourceHash(f)]));
}

// ---------- the three releasing commands' work ----------

export async function publishDraft(ctx: Ctx, a: { target: SiteTarget; files: SiteFile[]; data: BlockData & { today?: string }; site: SiteDoc; note?: string; api?: HostingApi }) {
  if (!a.files.some((f) => f.path === "index.html")) throw new AppError("invalid_input", "The site needs a home page (index.html) before it can be published.", 400);
  const sources = await freezeDraft(ctx.artistId, a.files, ctx.uid, ctx.runId);
  const build = await buildVersion({ site: a.site, target: a.target, files: a.files, data: a.data, api: a.api });
  const r = await releaseVersion({ artistId: ctx.artistId, target: a.target, kind: "publish", sources, build, by: ctx.uid, note: a.note, api: a.api, baseVersion: pointerOf(a.site, a.target) });
  return { ...r, uploaded: build.uploaded, files: Object.keys(build.outputs).length, removed: build.removed };
}

export async function promoteStaging(ctx: Ctx, a: { site: SiteDoc; data: BlockData & { today?: string }; note?: string; api?: HostingApi }) {
  const from = a.site.stagingVersion;
  if (!from) throw new AppError("invalid_input", "Publish to staging first.", 400);
  const v = await getVersion(ctx.artistId, from);
  if (!v?.sources) throw new AppError("invalid_input", "Publish to staging first.", 400);
  const files = await loadSources(ctx.artistId, v.sources);
  const build = await buildVersion({ site: a.site, target: "live", files, data: a.data, api: a.api });
  const r = await releaseVersion({ artistId: ctx.artistId, target: "live", kind: "promote", sources: v.sources, build, by: ctx.uid, baseVersion: a.site.liveVersion, fromVersion: from, note: a.note, api: a.api });
  return { ...r, uploaded: build.uploaded, showsChanged: build.blockInputs !== v.blockInputs };
}

export async function rollbackTo(ctx: Ctx, a: { site: SiteDoc; target: SiteTarget; n: number; data: BlockData & { today?: string }; api?: HostingApi }) {
  const api = a.api ?? hostingClient();
  const v = await getVersion(ctx.artistId, a.n);
  if (!v || v.state !== "done" || v.site !== a.target) throw new AppError("not_found", `Version ${a.n} isn't a published ${a.target} version`, 404);
  const held = (await api.listReleases(hostingSiteOf(a.site, a.target))).some((r) => r.version === v.hostingVersion);
  let build: Build;
  if (held) build = { hostingVersion: v.hostingVersion, outputs: v.outputs, blockInputs: v.blockInputs, fresh: false, uploaded: 0, removed: {} };
  else {
    if (!v.sources) throw new AppError("invalid_input", "That version can't be rebuilt: it was released outside Roadie and Hosting no longer holds it.", 400);
    build = await buildVersion({ site: a.site, target: a.target, files: await loadSources(ctx.artistId, v.sources), data: a.data, api });
  }
  return releaseVersion({ artistId: ctx.artistId, target: a.target, kind: "rollback", sources: v.sources, build, by: ctx.uid, baseVersion: pointerOf(a.site, a.target), fromVersion: a.n, api });
}
