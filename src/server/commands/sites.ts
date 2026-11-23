/**
 * The site.* commands (docs/designs/sites, Decision 9). The server works out the site from ctx.artistId, and every command
 * refuses with 403 when the artist has no site. Publish, promote, rollback, reconcile and the settings are person only: they're
 * in EXCLUDED (src/server/assistant/policy.ts) and their roles leave out "mcp". site.json is person only too: the assistant and
 * MCP can read it but never write it.
 */
import { z } from "zod";
import { defineCommand } from "./types";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { hostingClient } from "../integrations/hosting";
import { sitePath, siteTarget, urlOfPage } from "@/schema/sites";
import { blockData } from "../sites/blocks";
import { blockInputsOf, prepareSource, renderPage } from "../sites/render";
import { promoteStaging, publishDraft, reconcile, rollbackTo } from "../sites/publish";
import {
  draftFile, draftFiles, getVersion, listVersions, loadSources, removeDraft, requireSite, siteTx, sourceHash, writeDraft,
  type SiteDoc,
} from "../sites/store";
import { signUrl } from "../signedUrl";

const ALL = ["admin", "member", "mcp"] as const;
const EDIT = ["admin", "mcp"] as const;
const PERSON = ["admin"] as const;
const strict = <T extends z.ZodRawShape>(s: T) => z.strictObject(s);

function requireAdmin(ctx: Ctx) {
  if (ctx.role !== "admin" && ctx.role !== "mcp") throw new AppError("forbidden", "Only this band's admins can change the website.", 403);
}
function refuseConfigFromAi(ctx: Ctx, path: string) {
  if (path === "site.json" && (ctx.via === "assistant" || ctx.via === "mcp" || ctx.role === "mcp")) {
    throw new AppError("forbidden", "site.json (the signup link, redirects and domain) is changed by a person, in Settings › Website.", 403);
  }
}

const hosts = (site: SiteDoc) => {
  const api = hostingClient();
  return { live: `https://${api.hostOf(site.hosting.liveSite)}`, staging: `https://${api.hostOf(site.hosting.stagingSite)}` };
};

const presentVersion = (v: Awaited<ReturnType<typeof listVersions>>[number], site: SiteDoc) => ({
  n: v.n, site: v.site, kind: v.kind, state: v.state, by: v.by, at: new Date(v.at).toISOString(), note: v.note ?? null,
  current: (v.site === "live" ? site.liveVersion : site.stagingVersion) === v.n, fromVersion: v.fromVersion ?? null,
  rebuildable: !!v.sources, error: v.error ?? null, files: v.sources ? Object.keys(v.sources).length : Object.keys(v.outputs).length,
});

/** Draft paths that differ from a version's sources (added, changed or removed). */
function changedSince(draft: { path: string; kind: string; body: string }[], sources: Record<string, string> | null | undefined) {
  const now = new Map(draft.map((f) => [f.path, sourceHash(f)]));
  const was = new Map(Object.entries(sources ?? {}));
  const out: { path: string; change: "added" | "changed" | "removed" }[] = [];
  for (const [p, h] of now) if (!was.has(p)) out.push({ path: p, change: "added" }); else if (was.get(p) !== h) out.push({ path: p, change: "changed" });
  for (const p of was.keys()) if (!now.has(p)) out.push({ path: p, change: "removed" });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export const siteStatus = defineCommand({
  name: "site.status", roles: [...ALL], input: strict({}),
  description:
    "The band's website: its live and staging addresses, which version each serves, the draft files changed since the live version, whether the show list has changed since it was published, " +
    "auto-refresh, and the 10 most recent versions. Read only.",
  async run(ctx) {
    const site = await requireSite(ctx);
    const draft = await draftFiles(ctx);
    const live = site.liveVersion ? await getVersion(ctx.artistId, site.liveVersion) : null;
    const staging = site.stagingVersion ? await getVersion(ctx.artistId, site.stagingVersion) : null;
    const data = await blockData(ctx);
    const now = blockInputsOf(data);
    return {
      name: site.name, urls: hosts(site), liveVersion: site.liveVersion ?? null, stagingVersion: site.stagingVersion ?? null,
      changes: changedSince(draft, live?.sources ?? {}), stagingChanges: changedSince(draft, staging?.sources ?? {}),
      showsChanged: { live: !!live && live.blockInputs !== now, staging: !!staging && staging.blockInputs !== now },
      autoRefresh: site.autoRefresh, refreshPaused: { live: !!site.refreshPaused?.live, staging: !!site.refreshPaused?.staging },
      publishing: !!site.lease && site.lease.until > Date.now(), checkedAt: site.checkedAt ? new Date(site.checkedAt).toISOString() : null, lastError: site.lastError ?? null,
      pages: draft.filter((f) => f.kind === "page").map((f) => ({ path: f.path, url: urlOfPage(f.path) })),
      versions: (await listVersions(ctx.artistId, 10)).map((v) => presentVersion(v, site)),
    };
  },
});

export const sitePages = defineCommand({
  name: "site.pages", roles: [...ALL], input: strict({}),
  description: "List the website's draft files: pages (index.html is the home page, about.html is /about), partials/header.html and partials/footer.html (around every page), style.css, site.json and images (img/…). Read only.",
  async run(ctx) {
    await requireSite(ctx);
    return { files: (await draftFiles(ctx)).map((f) => ({ path: f.path, kind: f.kind, size: f.kind === "image" ? null : f.body.length, ...(f.kind === "page" ? { url: urlOfPage(f.path) } : {}) })) };
  },
});

export const siteRead = defineCommand({
  name: "site.read", roles: [...ALL], input: strict({ path: sitePath }),
  description: "One draft file of the website, its whole source. Images return their path only. Read only.",
  async run(ctx, { path }) {
    await requireSite(ctx);
    const f = await draftFile(ctx, path);
    if (!f) throw new AppError("not_found", `No draft file ${path}`, 404);
    return { path: f.path, kind: f.kind, body: f.kind === "image" ? null : f.body };
  },
});

const BODY_HELP =
  "Pages are HTML fragments (no <html>/<head>/<body>); a page may start with <title> and <meta name=\"description\">. Data blocks: <roadie-shows limit=\"10\"></roadie-shows> (upcoming public shows), " +
  "<roadie-links></roadie-links> (the band's links), <roadie-signup></roadie-signup> (the mailing-list button). No scripts, forms, on* attributes or @import: they're removed. " +
  "Embeds: <iframe> from Spotify, YouTube, Bandcamp or SoundCloud only. Images: <img src=\"/img/name.jpg\">. Changes go to the draft only; a person publishes.";

export const siteWrite = defineCommand({
  name: "site.write", roles: [...EDIT],
  description: `Create or replace one draft file of the website (admins). ${BODY_HELP} site.json is changed by a person only.`,
  input: strict({ path: sitePath, body: z.string().max(400_000) }),
  async run(ctx, { path, body }) {
    requireAdmin(ctx); refuseConfigFromAi(ctx, path);
    await requireSite(ctx);
    let p;
    try { p = prepareSource(path, body); } catch (e) { throw new AppError("invalid_input", (e as Error).message, 400); }
    const r = await writeDraft(ctx, { path, kind: p.kind, body: p.body });
    return { path, ...r, removed: p.removed };
  },
});

export const siteEdit = defineCommand({
  name: "site.edit", roles: [...EDIT],
  description: `A small change to one draft file (admins): replace \`find\` with \`replace\`. Fails unless \`find\` appears exactly once; read the file first. ${BODY_HELP}`,
  input: strict({ path: sitePath, find: z.string().min(1).max(100_000), replace: z.string().max(200_000) }),
  async run(ctx, { path, find, replace }) {
    requireAdmin(ctx); refuseConfigFromAi(ctx, path);
    await requireSite(ctx);
    const f = await draftFile(ctx, path);
    if (!f || f.kind === "image") throw new AppError("not_found", `No draft file ${path}`, 404);
    const count = f.body.split(find).length - 1;
    if (count !== 1) throw new AppError("invalid_input", count ? `That text appears ${count} times in ${path}; include more of it so it's unique.` : `That text isn't in ${path}. Read the file and copy it exactly.`, 400);
    let p;
    try { p = prepareSource(path, f.body.replace(find, () => replace)); } catch (e) { throw new AppError("invalid_input", (e as Error).message, 400); }
    const r = await writeDraft(ctx, { path, kind: p.kind, body: p.body });
    return { path, ...r, removed: p.removed };
  },
});

export const siteRemove = defineCommand({
  name: "site.remove", roles: [...EDIT], input: strict({ path: sitePath }),
  description: "Remove one draft file of the website (admins). site.write on the same path brings it back. The live site changes only when a person publishes.",
  async run(ctx, { path }) {
    requireAdmin(ctx); refuseConfigFromAi(ctx, path);
    await requireSite(ctx);
    if (path === "index.html") throw new AppError("invalid_input", "The home page can't be removed; change it instead.", 400);
    return removeDraft(ctx, path);
  },
});

export const sitePreview = defineCommand({
  name: "site.preview", roles: ["admin", "member"],
  description: "A page rendered for the Website page's preview frame: the draft, or a published version n. App only.",
  input: strict({ path: sitePath, n: z.number().int().min(1).optional() }),
  async run(ctx, { path, n }) {
    const site = await requireSite(ctx);
    let files;
    if (n) {
      const v = await getVersion(ctx.artistId, n);
      if (!v?.sources) throw new AppError("not_found", "That version can't be shown: Roadie has no copy of its pages.", 404);
      files = await loadSources(ctx.artistId, v.sources);
    } else files = await draftFiles(ctx);
    if (!files.some((f) => f.path === path && f.kind === "page")) throw new AppError("not_found", `No page ${path}`, 404);
    const data = await blockData(ctx);
    const imageUrl = (p: string, sha: string) => {
      const q = new URLSearchParams(signUrl("siteImg", ctx.artistId, sha, "0"));
      return `/api/sites/img/${encodeURIComponent(ctx.artistId)}/${sha}?${q}`;
    };
    const r = renderPage({ files, data }, path, { mode: "preview", target: "live", defaultHost: hostingClient().hostOf(site.hosting.liveSite), imageUrl });
    return { path, html: r.html, removed: r.removed };
  },
});

export const siteVersions = defineCommand({
  name: "site.versions", roles: [...ALL], input: strict({ limit: z.number().int().min(1).max(100).default(50) }),
  description: "The website's published versions, newest first: number, live or staging, publish/promote/rollback/refresh, who and when, and which are current. Read only.",
  async run(ctx, { limit }) {
    const site = await requireSite(ctx);
    return { versions: (await listVersions(ctx.artistId, limit)).map((v) => presentVersion(v, site)) };
  },
});

export const sitePublish = defineCommand({
  name: "site.publish", roles: [...PERSON],
  description: "Publish the draft to the staging or the live site (admins, person only). Every published version can be rolled back.",
  input: strict({ site: siteTarget, note: z.string().max(500).optional() }),
  async run(ctx, { site: target, note }) {
    requireAdmin(ctx);
    const site = await requireSite(ctx);
    const files = await draftFiles(ctx);
    return publishDraft(ctx, { target, files, data: await blockData(ctx), site, note });
  },
});

export const sitePromote = defineCommand({
  name: "site.promote", roles: [...PERSON], input: strict({ note: z.string().max(500).optional() }),
  description: "Publish what staging serves to the live site (admins, person only), with today's show list.",
  async run(ctx, { note }) {
    requireAdmin(ctx);
    const site = await requireSite(ctx);
    return promoteStaging(ctx, { site, data: await blockData(ctx), note });
  },
});

export const siteRollback = defineCommand({
  name: "site.rollback", roles: [...PERSON], input: strict({ site: siteTarget, n: z.number().int().min(1) }),
  description: "Serve an earlier version again on the live or staging site (admins, person only). Pauses the automatic show refresh there until the next publish.",
  async run(ctx, { site: target, n }) {
    requireAdmin(ctx);
    const site = await requireSite(ctx);
    return rollbackTo(ctx, { site, target, n, data: await blockData(ctx) });
  },
});

export const siteReconcile = defineCommand({
  name: "site.reconcile", roles: [...PERSON], input: strict({}),
  description: "Check the version list against what Firebase Hosting serves and repair it (admins, person only).",
  async run(ctx) {
    requireAdmin(ctx);
    await requireSite(ctx);
    return reconcile(ctx.artistId);
  },
});

export const siteSettings = defineCommand({
  name: "site.settings.update", roles: [...PERSON], input: strict({ autoRefresh: z.boolean() }),
  description: "Turn the automatic show-list refresh on or off (admins, person only).",
  async run(ctx, { autoRefresh }) {
    requireAdmin(ctx);
    await requireSite(ctx);
    await siteTx(ctx.artistId, async (tx, _s, r) => { tx.update(r.site, { autoRefresh }); });
    return { autoRefresh };
  },
});

export const siteCommands = [siteStatus, sitePages, siteRead, siteWrite, siteEdit, siteRemove, sitePreview, siteVersions, sitePublish, sitePromote, siteRollback, siteReconcile, siteSettings];
