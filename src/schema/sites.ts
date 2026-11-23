/**
 * Artists' websites (docs/designs/sites/README.md, Decision 2). One site per artist: `sites/{artistId}` with its draft files
 * (`sitePages`), the frozen sources of every published file (`siteSources`), the images (`siteAssets`) and the numbered versions
 * (`siteVersions`). Only `sitePages` goes through the Writer (autosave, history, undo); the rest is written raw by
 * src/server/sites/store.ts, so undoing an edit run can never move a public site.
 */
import { z } from "zod";

/** What a draft file is: an HTML page fragment, a partial (header/footer), the stylesheet, site.json, or an image. */
export const SITE_FILE_KINDS = ["page", "partial", "css", "config", "image"] as const;
export const siteFileKind = z.enum(SITE_FILE_KINDS);
export type SiteFileKind = z.infer<typeof siteFileKind>;

/** Which Hosting site a version went to. */
export const siteTarget = z.enum(["live", "staging"]);
export type SiteTarget = z.infer<typeof siteTarget>;

/**
 * A draft path: `index.html`, `about.html`, `partials/header.html`, `partials/footer.html`, `style.css`, `site.json` or
 * `img/<name>.<ext>`. Lowercase letters, digits, dashes; no `..`.
 */
export const SITE_PATH_RE = /^(?:[a-z0-9][a-z0-9-]{0,60}\.html|partials\/(?:header|footer)\.html|style\.css|site\.json|img\/[a-z0-9][a-z0-9._-]{0,80}\.(?:jpg|jpeg|png|webp|gif|svg))$/;
export const sitePath = z.string().regex(SITE_PATH_RE, "Use a path like about.html, partials/header.html, style.css, site.json or img/photo.jpg");

/** The kind a path implies. */
export function kindOfPath(path: string): SiteFileKind {
  if (path === "site.json") return "config";
  if (path === "style.css") return "css";
  if (path.startsWith("partials/")) return "partial";
  if (path.startsWith("img/")) return "image";
  return "page";
}

/** The clean URL a page is served at: index.html → "/", about.html → "/about". */
export const urlOfPage = (path: string) => (path === "index.html" ? "/" : `/${path.replace(/\.html$/, "")}`);

/** site.json (Decision 2): versioned with the pages, so a rollback restores it and a refresh never ships an unpublished one. */
export const SiteConfig = z.object({
  title: z.string().max(120).default(""),
  description: z.string().max(400).optional(),
  /** The production host canonical tags and the sitemap use. Missing = the live site's web.app host. */
  canonicalHost: z.string().regex(/^[a-z0-9.-]+$/).optional(),
  /** Google Fonts families the site loads ("Lato", "Playfair Display"). */
  fonts: z.array(z.string().regex(/^[A-Za-z0-9 ]{1,40}$/)).max(4).optional(),
  /** Where <roadie-signup> sends people (the list provider's hosted signup page). */
  signupUrl: z.string().url().optional(),
  signupLabel: z.string().max(60).optional(),
  /** 301s from old URLs (Bandzoogle's) to the new ones. */
  redirects: z.array(z.object({ from: z.string().regex(/^\/[^\s]*$/), to: z.string().min(1) })).max(200).optional(),
  /** The image social cards use (a draft image path, img/…). */
  image: z.string().optional(),
}).passthrough();
export type SiteConfig = z.infer<typeof SiteConfig>;

/** sites/{artistId}: the site itself, server-written. */
export const SiteInput = z.object({
  artistId: z.string().min(1),
  name: z.string().min(1),
  /** The Firebase Hosting project and its two sites. */
  hosting: z.object({ project: z.string().min(1), liveSite: z.string().min(1), stagingSite: z.string().min(1) }),
  liveVersion: z.number().int().optional(),
  stagingVersion: z.number().int().optional(),
  nextN: z.number().int().min(1),
  autoRefresh: z.boolean(),
  refreshPaused: z.object({ live: z.boolean().optional(), staging: z.boolean().optional() }).optional(),
  lease: z.object({ token: z.string(), by: z.string(), until: z.number() }).nullable().optional(),
  /** When the last reconcile or refresh ran, and what it found (shown on the Website page). */
  checkedAt: z.number().optional(),
  lastError: z.string().optional(),
});

/** sites/{a}/sitePages/{pageId}: one draft file. pageId = first 40 hex of sha256(path). Images keep their asset's sha256 as body. */
export const SitePageInput = z.object({
  artistId: z.string().min(1),
  path: sitePath,
  kind: siteFileKind,
  body: z.string().max(900_000),
});

/** sites/{a}/siteSources/{sha256}: a file's source as published, immutable. */
export const SiteSourceInput = z.object({ artistId: z.string().min(1), path: sitePath, kind: siteFileKind, body: z.string() });

/** sites/{a}/siteAssets/{sha256}: an image's bytes (at most ~900 KB, so it fits one doc), immutable. */
export const SiteAssetInput = z.object({
  artistId: z.string().min(1), type: z.string().min(1), size: z.number().int(), data: z.custom<Uint8Array>((v) => v instanceof Uint8Array, "bytes"),
  name: z.string().optional(),
});

export const SITE_VERSION_KINDS = ["publish", "promote", "rollback", "refresh", "reconcile"] as const;
/** sites/{a}/siteVersions/{n}: one release to one Hosting site. */
export const SiteVersionInput = z.object({
  artistId: z.string().min(1),
  n: z.number().int().min(1),
  site: siteTarget,
  state: z.enum(["pending", "done", "failed"]),
  kind: z.enum(SITE_VERSION_KINDS),
  /** path → source hash (images: their asset hash). null = a release Roadie didn't build (reconcile), which can't be rebuilt. */
  sources: z.record(z.string(), z.string()).nullable(),
  blockInputs: z.string(),
  /** Hosting's path → hash of each gzipped file served. */
  outputs: z.record(z.string(), z.string()),
  hostingVersion: z.string(),
  baseVersion: z.number().int().optional(),
  fromVersion: z.number().int().optional(),
  releaseName: z.string().optional(),
  leaseToken: z.string(),
  by: z.string(),
  at: z.number(),
  note: z.string().max(500).optional(),
  error: z.string().optional(),
});
export type SiteVersion = z.infer<typeof SiteVersionInput> & { id: string };
