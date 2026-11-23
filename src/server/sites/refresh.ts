/**
 * The data refresh (docs/designs/sites, Decision 5), run every 10 minutes by .github/workflows/site-refresh.yml through
 * /api/cron/site-refresh. For every site: reconcile first; then, when auto-refresh is on, re-render each Hosting site's current
 * version from its own frozen sources with today's data, but only when what the blocks would show has changed.
 */
import { importCtx } from "../ctx";
import { hostingClient, type HostingApi } from "../integrations/hosting";
import { blockData } from "./blocks";
import { blockInputsOf } from "./render";
import { buildVersion, reconcile, releaseVersion } from "./publish";
import { getVersion, listAllSiteArtists, loadSources, pointerOf, readSite } from "./store";

export interface RefreshResult { artistId: string; reconciled: string[]; refreshed: string[]; skipped: string[]; error?: string }

export async function refreshSite(artistId: string, api: HostingApi = hostingClient()): Promise<RefreshResult> {
  const out: RefreshResult = { artistId, reconciled: [], refreshed: [], skipped: [] };
  try {
    out.reconciled = (await reconcile(artistId, { api })).changed;
    const site = await readSite(artistId);
    if (!site?.autoRefresh) return out;
    if (site.lease && site.lease.until > Date.now()) { out.skipped.push("lease held"); return out; }
    const ctx = importCtx(artistId, "system");
    const data = await blockData(ctx);
    const now = blockInputsOf(data);
    for (const target of ["live", "staging"] as const) {
      const n = pointerOf(site, target);
      if (!n) continue;
      if (site.refreshPaused?.[target]) { out.skipped.push(`${target}: paused after a rollback`); continue; }
      const v = await getVersion(artistId, n);
      if (!v?.sources) { out.skipped.push(`${target}: no sources`); continue; }
      if (v.blockInputs === now) continue;
      const files = await loadSources(artistId, v.sources);
      const build = await buildVersion({ site, target, files, data, api });
      try {
        const r = await releaseVersion({ artistId, target, kind: "refresh", sources: v.sources, build, by: "system", baseVersion: n, note: "Data refresh (shows changed)", api });
        out.refreshed.push(`${target}:${r.n}`);
      } catch (e) { out.skipped.push(`${target}: ${(e as Error).message}`); }
    }
  } catch (e) { out.error = (e as Error).message; }
  return out;
}

export async function refreshAll(api: HostingApi = hostingClient()): Promise<RefreshResult[]> {
  const out: RefreshResult[] = [];
  for (const a of await listAllSiteArtists()) out.push(await refreshSite(a, api));
  return out;
}
