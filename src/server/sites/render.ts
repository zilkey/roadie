/**
 * render() (docs/designs/sites, Decision 3): the one function behind the preview and every published version. Pure: the files,
 * the block data and the options in; pages, the Hosting files, the Hosting config and `blockInputs` out.
 *
 * Steps: sanitize the author's source, wrap each page in the header and footer partials, then insert the generated, trusted
 * nodes (blocks, canonical, Open Graph, JSON-LD), then write sitemap.xml and robots.txt, then build the Hosting config.
 */
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { sanitizeCss, sanitizeHtml, EMBED_HOSTS } from "./sanitize";
import { SiteConfig, kindOfPath, urlOfPage, type SiteFileKind, type SiteTarget } from "@/schema/sites";

export interface SiteFile { path: string; kind: SiteFileKind; body: string }
export interface PublicShow { date: string; name: string; place?: string; ticketUrl?: string; time?: string }
export interface PublicLink { key: string; label: string; url: string }
export interface BlockData { artistName: string; shows: PublicShow[]; links: PublicLink[] }

export interface RenderOpts {
  mode: "public" | "preview";
  target: SiteTarget;
  /** The host canonical tags use when site.json names none: the live site's web.app host. */
  defaultHost: string;
  /** Preview: the URL an image is shown from (a signed app link). */
  imageUrl?: (path: string, sha: string) => string;
  /** Today in the artist's zone (YYYY-MM-DD), for the sitemap's lastmod. */
  today?: string;
}

export interface HostingHeader { glob: string; headers: Record<string, string> }
export interface HostingConfig {
  cleanUrls: boolean;
  trailingSlashBehavior: "REMOVE";
  redirects: { glob: string; statusCode: number; location: string }[];
  headers: HostingHeader[];
}

export interface Rendered {
  /** Hosting path ("/about.html", "/img/a.jpg") → the file: text, or an image's asset hash (the caller supplies its bytes). */
  files: Record<string, { text: string; type: string } | { asset: string; type: string }>;
  config: HostingConfig;
  blockInputs: string;
  /** What the sanitizer took out, by draft path. */
  removed: Record<string, string[]>;
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** JSON for a <script type="application/ld+json">: every < written as <, so nothing can close the tag. */
const jsonLd = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

export function parseConfig(body: string | undefined): SiteConfig {
  if (!body) return SiteConfig.parse({});
  try { return SiteConfig.parse(JSON.parse(body)); } catch { return SiteConfig.parse({}); }
}

/** The hash of exactly the data the blocks use: a refresh rebuilds only when it changes (Decision 5). */
export const blockInputsOf = (d: BlockData) => sha256(JSON.stringify({ shows: d.shows, links: d.links, name: d.artistName }));

const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };
export const mimeOf = (path: string) => MIME[path.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";

function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function showsBlock(d: BlockData, limit: number, preview: boolean) {
  const list = d.shows.slice(0, Math.max(1, Math.min(limit || 20, 100)));
  if (!list.length) return `<p class="roadie-shows-empty">No shows announced yet.</p>`;
  const li = list.map((s) => `<li class="roadie-show"><span class="roadie-show-date">${esc(fmtDate(s.date))}</span> <span class="roadie-show-name">${esc(s.name)}</span>${s.place ? ` <span class="roadie-show-place">${esc(s.place)}</span>` : ""}${s.ticketUrl ? ` <a class="roadie-show-tickets" href="${preview ? "#" : esc(s.ticketUrl)}" rel="noopener">Tickets</a>` : ""}</li>`);
  return `<ul class="roadie-shows">${li.join("")}</ul>`;
}

function linksBlock(d: BlockData, preview: boolean) {
  if (!d.links.length) return "";
  return `<ul class="roadie-links">${d.links.map((l) => `<li><a class="roadie-link roadie-link-${esc(l.key.toLowerCase())}" href="${preview ? "#" : esc(l.url)}" rel="noopener">${esc(l.label)}</a></li>`).join("")}</ul>`;
}

function signupBlock(cfg: SiteConfig, preview: boolean) {
  if (!cfg.signupUrl) return "";
  return `<div class="roadie-signup"><a class="roadie-signup-button" href="${preview ? "#" : esc(cfg.signupUrl)}" rel="noopener">${esc(cfg.signupLabel || "Join the mailing list")}</a></div>`;
}

/** The fixed security headers (Security: Site headers), plus staging's noindex. */
export function securityHeaders(target: SiteTarget): Record<string, string> {
  const csp = [
    "default-src 'none'", "script-src 'none'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:", `frame-src ${EMBED_HOSTS.map((h) => `https://${h}`).join(" ")}`, "form-action 'none'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'",
  ].join("; ");
  return {
    "Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin",
    ...(target === "staging" ? { "X-Robots-Tag": "noindex" } : {}),
  };
}

function hostingConfig(cfg: SiteConfig, target: SiteTarget): HostingConfig {
  return {
    cleanUrls: true, trailingSlashBehavior: "REMOVE",
    redirects: (cfg.redirects ?? []).map((r) => ({ glob: r.from, statusCode: 301, location: r.to })),
    headers: [
      { glob: "**", headers: securityHeaders(target) },
      { glob: "**/*.@(jpg|jpeg|png|webp|gif|svg)", headers: { "Cache-Control": "public, max-age=86400" } },
    ],
  };
}

interface PageParts { title?: string; description?: string; body: string }

/** Sanitize a page fragment and lift its <title> and <meta name="description"> out of the body. */
function pageParts(src: string): PageParts & { removed: string[] } {
  const s = sanitizeHtml(src);
  const $ = cheerio.load(s.html, null, false);
  const title = $("title").first().text().trim() || undefined;
  const description = $('meta[name="description"]').first().attr("content")?.trim() || undefined;
  $("title").remove(); $("meta").remove();
  return { title, description, body: $.html(), removed: [...s.removed, ...s.unknownBlocks.map((b) => `<${b}> (unknown block)`)] };
}

export interface RenderInput { files: SiteFile[]; data: BlockData }

/** One page, assembled (header + page + footer) with the generated nodes. */
export function renderPage(input: RenderInput, path: string, opts: RenderOpts): { html: string; removed: string[] } {
  const by = new Map(input.files.map((f) => [f.path, f]));
  const page = by.get(path);
  if (!page || page.kind !== "page") throw new Error(`No page ${path}`);
  const cfg = parseConfig(by.get("site.json")?.body);
  const host = cfg.canonicalHost || opts.defaultHost;
  const preview = opts.mode === "preview";
  const parts = pageParts(page.body);
  const header = by.get("partials/header.html") ? pageParts(by.get("partials/header.html")!.body) : undefined;
  const footer = by.get("partials/footer.html") ? pageParts(by.get("partials/footer.html")!.body) : undefined;
  const removed = [...parts.removed, ...(header?.removed ?? []), ...(footer?.removed ?? [])];

  const $ = cheerio.load(`<div id="__roadie">${header?.body ?? ""}<main>${parts.body}</main>${footer?.body ?? ""}</div>`, null, false);
  const root = $("#__roadie");
  // A page that already has its own <main> keeps it; don't nest two.
  const mains = root.find("main");
  if (mains.length > 1) mains.first().replaceWith(mains.first().contents());

  // Step 3: generated, trusted nodes.
  let usedShows = false, usedLinks = false;
  root.find("roadie-shows").each((_, el) => { usedShows = true; $(el).replaceWith(showsBlock(input.data, Number($(el).attr("limit") ?? 20), preview)); });
  root.find("roadie-links").each((_, el) => { usedLinks = true; $(el).replaceWith(linksBlock(input.data, preview)); });
  root.find("roadie-signup").each((_, el) => { $(el).replaceWith(signupBlock(cfg, preview)); });

  // Images: public files are served at /img/…; the preview shows them through signed app links.
  root.find("img[src], source[src], video[poster]").each((_, el) => {
    const attr = el.tagName === "video" ? "poster" : "src";
    const src = $(el).attr(attr) ?? "";
    const p = src.replace(/^\//, "");
    const f = by.get(p);
    if (preview && f?.kind === "image" && opts.imageUrl) $(el).attr(attr, opts.imageUrl(p, f.body));
  });
  if (preview) root.find("a[href]").each((_, el) => { $(el).attr("href", "#"); $(el).removeAttr("target"); });

  const url = urlOfPage(path);
  const title = parts.title || cfg.title || input.data.artistName;
  const description = parts.description || cfg.description || "";
  const canonical = `https://${host}${url}`;
  const ogImage = cfg.image && by.get(cfg.image)?.kind === "image" ? `https://${host}/${cfg.image}` : undefined;
  const fonts = (cfg.fonts ?? []).length
    ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${cfg.fonts!.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:ital,wght@0,400;0,600;0,700;1,400`).join("&")}&display=swap">`
    : "";
  let css = sanitizeCss(by.get("style.css")?.body ?? "");
  // The preview frame has no site origin: CSS images (/img/…) go through the same signed links as <img>.
  if (preview && opts.imageUrl) css = css.replace(/url\(\s*(['"]?)\/?(img\/[^'")\s]+)\1\s*\)/g, (m, _q, p: string) => { const f = by.get(p); return f?.kind === "image" ? `url("${opts.imageUrl!(p, f.body)}")` : m; });
  const style = preview ? `<style>${css}</style>` : css ? `<link rel="stylesheet" href="/style.css?v=${sha256(css).slice(0, 10)}">` : "";

  const ld: unknown[] = [];
  if (usedLinks || url === "/") ld.push({ "@context": "https://schema.org", "@type": "MusicGroup", name: input.data.artistName, url: `https://${host}/`, sameAs: input.data.links.map((l) => l.url) });
  if (usedShows) for (const s of input.data.shows.slice(0, 20)) {
    ld.push({
      "@context": "https://schema.org", "@type": "MusicEvent", name: `${input.data.artistName} at ${s.name}`, startDate: s.time ? `${s.date}T${s.time}` : s.date,
      eventStatus: "https://schema.org/EventScheduled", location: { "@type": "Place", name: s.name, ...(s.place ? { address: s.place } : {}) },
      performer: { "@type": "MusicGroup", name: input.data.artistName }, ...(s.ticketUrl ? { offers: { "@type": "Offer", url: s.ticketUrl } } : {}),
    });
  }

  const head = [
    `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1">`, `<title>${esc(title)}</title>`,
    description ? `<meta name="description" content="${esc(description)}">` : "",
    preview ? "" : `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta property="og:type" content="website">`, `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:url" content="${esc(canonical)}">`,
    description ? `<meta property="og:description" content="${esc(description)}">` : "", ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : "",
    `<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">`,
    by.get("img/favicon.png") ? `<link rel="icon" href="/img/favicon.png">` : "",
    fonts, style,
    ...ld.map((j) => `<script type="application/ld+json">${jsonLd(j)}</script>`),
  ].filter(Boolean).join("\n");
  const html = `<!doctype html>\n<html lang="en">\n<head>\n${head}\n</head>\n<body class="page-${esc(path.replace(/\.html$/, ""))}">\n${root.html()}\n</body>\n</html>\n`;
  return { html, removed };
}

/** Every file of a version: pages, style.css, images, sitemap.xml, robots.txt and the Hosting config. */
export function renderSite(input: RenderInput, opts: RenderOpts): Rendered {
  const by = new Map(input.files.map((f) => [f.path, f]));
  const cfg = parseConfig(by.get("site.json")?.body);
  const host = cfg.canonicalHost || opts.defaultHost;
  const files: Rendered["files"] = {};
  const removed: Record<string, string[]> = {};
  const pages = input.files.filter((f) => f.kind === "page").sort((a, b) => a.path.localeCompare(b.path));
  for (const p of pages) {
    const r = renderPage(input, p.path, { ...opts, mode: "public" });
    files[`/${p.path}`] = { text: r.html, type: "text/html; charset=utf-8" };
    if (r.removed.length) removed[p.path] = r.removed;
  }
  if (!by.has("404.html")) {
    files["/404.html"] = { text: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found</title>${by.get("style.css") ? `<link rel="stylesheet" href="/style.css">` : ""}</head><body><main style="padding:4rem 1rem;text-align:center"><h1>Page not found</h1><p><a href="/">Go to the home page</a></p></main></body></html>\n`, type: "text/html; charset=utf-8" };
  }
  const css = by.get("style.css");
  if (css) files["/style.css"] = { text: sanitizeCss(css.body), type: "text/css; charset=utf-8" };
  for (const f of input.files) if (f.kind === "image") files[`/${f.path}`] = { asset: f.body, type: mimeOf(f.path) };
  const lastmod = opts.today ? `<lastmod>${opts.today}</lastmod>` : "";
  files["/sitemap.xml"] = {
    text: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.filter((p) => p.path !== "404.html").map((p) => `  <url><loc>https://${host}${urlOfPage(p.path)}</loc>${lastmod}</url>`).join("\n")}\n</urlset>\n`,
    type: "application/xml",
  };
  // Never `Disallow`: that would hide staging's noindex header from crawlers.
  files["/robots.txt"] = { text: `User-agent: *\nAllow: /\n\nSitemap: https://${host}/sitemap.xml\n`, type: "text/plain" };
  return { files, config: hostingConfig(cfg, opts.target), blockInputs: blockInputsOf(input.data), removed };
}

/** Validate a draft write: the kind from its path, sanitized HTML, a parseable site.json. Returns the body to store. */
export function prepareSource(path: string, body: string): { kind: SiteFileKind; body: string; removed: string[] } {
  const kind = kindOfPath(path);
  if (kind === "config") {
    let v: unknown;
    try { v = JSON.parse(body); } catch { throw new Error("site.json isn't valid JSON"); }
    const r = SiteConfig.safeParse(v);
    if (!r.success) throw new Error(`site.json: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    return { kind, body: JSON.stringify(v, null, 2), removed: [] };
  }
  if (kind === "css") {
    const c = sanitizeCss(body);
    return { kind, body: c, removed: c === body ? [] : ["@import / unsafe url()"] };
  }
  if (kind === "image") throw new Error("Images are added with site.uploadImage");
  const s = sanitizeHtml(body);
  if (s.unknownBlocks.length) throw new Error(`Unknown block ${s.unknownBlocks.map((b) => `<${b}>`).join(", ")}: use <roadie-shows>, <roadie-links> or <roadie-signup>`);
  // Keep the author's source as written (sanitized at render too), but refuse nothing that the sanitizer can fix: store the clean form.
  return { kind, body: s.html, removed: s.removed };
}
