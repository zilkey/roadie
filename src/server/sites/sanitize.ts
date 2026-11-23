/**
 * The sanitizer for site source (docs/designs/sites, Security): an allowlist on cheerio. It runs on the author's HTML at every
 * write and again as render step 1; the generated nodes (blocks, canonical, JSON-LD) are inserted after it, so they're never
 * stripped. Pure, so tests/unit covers it.
 */
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

/** The three data blocks a page may hold (Decision 4). An unknown roadie-* tag fails validation. */
export const BLOCKS = ["roadie-shows", "roadie-links", "roadie-signup"] as const;

const ELEMENTS = new Set([
  "a", "abbr", "address", "article", "aside", "b", "blockquote", "br", "caption", "cite", "code", "col", "colgroup", "dd", "del",
  "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
  "i", "iframe", "img", "ins", "kbd", "li", "main", "mark", "nav", "ol", "p", "picture", "pre", "q", "s", "section", "small",
  "source", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u", "ul",
  "video", "audio", "title", "meta", "svg", "path", "circle", "rect", "g", "line", "polyline", "polygon", "ellipse",
  ...BLOCKS,
]);
/** Dropped with everything inside them. */
const DROP = new Set(["script", "style", "object", "embed", "base", "form", "foreignobject", "link", "noscript", "template", "input", "button", "select", "textarea"]);

const GLOBAL_ATTRS = new Set(["class", "id", "title", "lang", "dir", "role", "style", "hidden"]);
const ATTRS: Record<string, string[]> = {
  a: ["href", "target", "rel"], img: ["src", "alt", "width", "height", "loading", "srcset", "sizes"], iframe: ["src", "width", "height", "allow", "allowfullscreen", "loading", "frameborder"],
  source: ["src", "srcset", "type", "media"], video: ["src", "controls", "poster", "width", "height", "muted", "loop", "playsinline"], audio: ["src", "controls"],
  td: ["colspan", "rowspan"], th: ["colspan", "rowspan", "scope"], col: ["span"], time: ["datetime"], ol: ["start", "reversed"],
  meta: ["name", "content"], "roadie-shows": ["limit"], details: ["open"],
  svg: ["viewbox", "width", "height", "fill", "stroke", "xmlns", "stroke-width", "aria-hidden"], path: ["d", "fill", "stroke", "stroke-width"],
  circle: ["cx", "cy", "r", "fill", "stroke"], rect: ["x", "y", "width", "height", "rx", "fill", "stroke"], g: ["fill", "stroke", "transform"],
  line: ["x1", "y1", "x2", "y2", "stroke"], polyline: ["points", "fill", "stroke"], polygon: ["points", "fill", "stroke"], ellipse: ["cx", "cy", "rx", "ry", "fill"],
};

/** Hosts an <iframe> may load (Spotify, YouTube, Bandcamp, SoundCloud). */
export const EMBED_HOSTS = ["open.spotify.com", "www.youtube.com", "www.youtube-nocookie.com", "youtube.com", "bandcamp.com", "w.soundcloud.com"];
export const embedAllowed = (src: string) => {
  try {
    const u = new URL(src);
    return u.protocol === "https:" && EMBED_HOSTS.includes(u.hostname);
  } catch { return false; }
};

const URL_ATTRS = new Set(["href", "src", "poster"]);
/** A URL attribute's value is safe: http(s), mailto, tel, a path or fragment, or a data: image. */
export function safeUrl(v: string, attr: string): boolean {
  const s = v.replace(/[\u0000- ]/g, "").toLowerCase();
  if (s.startsWith("data:")) return attr !== "href" && /^data:image\/(png|jpe?g|gif|webp);/.test(s);
  if (/^[a-z][a-z0-9+.-]*:/.test(s)) return /^(https?|mailto|tel):/.test(s);
  return true;
}

/** CSS: no @import, no expression(), no javascript: or non-image data: urls. */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "(")
    .replace(/url\(([^)]*)\)/gi, (m, inner: string) => (/^\s*['"]?\s*(?:javascript:|vbscript:|data:(?!image\/(?:png|jpe?g|gif|webp)))/i.test(inner) ? "url()" : m))
    .replace(/<\/style/gi, "");
}

export interface SanitizeResult { html: string; removed: string[]; unknownBlocks: string[] }

/** Clean an HTML fragment. `removed` names what went, so a write can say so. */
export function sanitizeHtml(html: string): SanitizeResult {
  const $ = cheerio.load(html, null, false);
  const removed: string[] = [];
  const unknownBlocks: string[] = [];
  const walk = (nodes: AnyNode[]) => {
    for (const n of nodes) {
      if (n.type === "comment" || n.type === "directive" || n.type === "cdata") { $(n).remove(); continue; }
      if (n.type === "script" || n.type === "style") { removed.push(`<${(n as Element).name}>`); $(n).remove(); continue; }
      if (n.type !== "tag") continue;
      const el = n as Element;
      const name = el.name.toLowerCase();
      if (DROP.has(name)) { removed.push(`<${name}>`); $(el).remove(); continue; }
      if (name.startsWith("roadie-") && !(BLOCKS as readonly string[]).includes(name)) { unknownBlocks.push(name); $(el).remove(); continue; }
      if (!ELEMENTS.has(name)) { removed.push(`<${name}>`); $(el).replaceWith($(el).contents()); walk(el.children); continue; }
      if (name === "meta" && !["description"].includes(String(el.attribs.name ?? "").toLowerCase())) { removed.push("<meta>"); $(el).remove(); continue; }
      if (name === "iframe" && !embedAllowed(el.attribs.src ?? "")) { removed.push(`<iframe src="${el.attribs.src ?? ""}">`); $(el).remove(); continue; }
      const allowed = new Set([...(ATTRS[name] ?? []), ...GLOBAL_ATTRS]);
      for (const [k, v] of Object.entries(el.attribs)) {
        const key = k.toLowerCase();
        const ok = (allowed.has(key) || key.startsWith("aria-") || key.startsWith("data-")) && !key.startsWith("on")
          && (!URL_ATTRS.has(key) || safeUrl(v, key)) && !(key === "srcset" && /javascript:/i.test(v));
        if (!ok) { removed.push(`${name}[${key}]`); delete el.attribs[k]; continue; }
        if (key === "style") el.attribs[k] = sanitizeCss(v).replace(/url\([^)]*\)/gi, "");
      }
      if (name === "a" && el.attribs.target === "_blank") el.attribs.rel = "noopener";
      walk(el.children);
    }
  };
  walk($.root().contents().toArray());
  return { html: $.html(), removed: [...new Set(removed)], unknownBlocks: [...new Set(unknownBlocks)] };
}
