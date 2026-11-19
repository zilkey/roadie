/**
 * Small, hand-written HTML helpers for outgoing mail: a sanitizer with an allowlist, an HTML -> plain text alternative,
 * and plain text -> HTML paragraphs. Used on the server (before sending, on the Gmail signature) and in the editor
 * (on paste), and on mail read from Gmail before the thread page shows it.
 */
import { linkify } from "./linkify";
import { splitQuoted } from "./email-text";
import { fillTemplate, type TemplateContext } from "./booking";

const ALLOWED = new Set(["p", "br", "div", "b", "strong", "i", "em", "u", "a", "ul", "ol", "li", "blockquote"]);
/** Tags whose contents are code or hidden text, not words: dropped whole rather than unwrapped. */
const DROP_WITH_CONTENT = new Set(["script", "style", "noscript", "template", "iframe", "object", "embed", "head", "title", "textarea", "select"]);

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
/** Decodes the entities that matter (named basics and numeric). Unknown named entities are left as written. */
export function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));?/g, (whole, dec, hex, name) => {
    if (name) return NAMED[name.toLowerCase()] ?? whole;
    const n = dec ? Number(dec) : parseInt(hex, 16);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
  });
}
const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => escText(s).replace(/"/g, "&quot;");

type Token = { t: "text"; v: string } | { t: "open"; name: string; attrs: string; selfClose: boolean } | { t: "close"; name: string };

const TAG = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<[!?][^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

function tokenize(html: string): Token[] {
  const out: Token[] = [];
  let at = 0;
  const text = (s: string) => { if (s) out.push({ t: "text", v: s }); };
  for (const m of html.matchAll(TAG)) {
    text(html.slice(at, m.index));
    at = m.index + m[0].length;
    if (!m[2]) continue; // comment, doctype, processing instruction
    const name = m[2].toLowerCase();
    if (m[1]) { out.push({ t: "close", name }); continue; }
    out.push({ t: "open", name, attrs: m[3], selfClose: /\/\s*$/.test(m[3]) });
    if (DROP_WITH_CONTENT.has(name) && !/\/\s*$/.test(m[3])) {
      // skip to the matching close tag (or the end), so script text is never shown as words
      const close = new RegExp(`</${name}\\s*>`, "i");
      const rest = html.slice(at);
      const hit = close.exec(rest);
      at += hit ? hit.index + hit[0].length : rest.length;
      out.push({ t: "close", name });
    }
  }
  text(html.slice(at));
  return out;
}

/** Whitespace, control and zero-width characters: browsers ignore them inside a URL scheme, so a check must too. */
const INVISIBLE = (c: number) => c <= 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || c === 0xfeff;

/** The href of an <a>, only when it is http:, https: or mailto:. Entities and control characters can't smuggle a scheme past this. */
function safeHref(attrs: string): string | null {
  const m = /(?:^|[\s/])href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
  if (!m) return null;
  const raw = decodeEntities(m[1] ?? m[2] ?? m[3] ?? "");
  const v = [...raw].filter((ch) => !INVISIBLE(ch.charCodeAt(0))).join("");
  return /^(https?:|mailto:)/i.test(v) ? raw.trim() : null;
}

/** Elements that never have contents or a close tag. */
const VOID = new Set(["img", "hr", "input", "meta", "link", "col", "wbr", "area", "base", "source", "track", "param", "embed", "keygen"]);

/** The style="" value of a tag's attributes, lowercased, "" when none. */
function styleOf(attrs: string): string {
  const m = /(?:^|[\s/])style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
  return decodeEntities(m?.[1] ?? m?.[2] ?? m?.[3] ?? "").toLowerCase();
}
/** Bold, italic and underline that a style="" asks for: how Google Docs, Gmail and Outlook mark formatting on spans. */
function styledFormats(style: string): ("b" | "i" | "u")[] {
  const out: ("b" | "i" | "u")[] = [];
  const weight = /(?:^|;)\s*font-weight\s*:\s*([a-z0-9]+)/.exec(style)?.[1];
  if (weight && (weight === "bold" || weight === "bolder" || Number(weight) >= 600)) out.push("b");
  if (/(?:^|;)\s*font-style\s*:\s*(italic|oblique)/.test(style)) out.push("i");
  if (/(?:^|;)\s*text-decoration(?:-line)?\s*:[^;]*underline/.test(style)) out.push("u");
  return out;
}
/** style="font-weight:normal" (or 400 and below): Google Docs wraps a whole paste in <b style="font-weight:normal">. */
const notBold = (style: string) => /(?:^|;)\s*font-weight\s*:\s*(normal|lighter|[1-4]00)\b/.test(style);
const notItalic = (style: string) => /(?:^|;)\s*font-style\s*:\s*normal\b/.test(style);

/**
 * Keeps p, br, div, b, strong, i, em, u, a, ul, ol, li and blockquote. `a` keeps only `href` (http, https or mailto) and
 * gets rel="noopener" (with `newTab`, target="_blank" and rel="noopener noreferrer"). Bold, italic and underline set by
 * style="" on any tag (Google Docs, Gmail, Outlook) become b, i and u; h1-h6 become a bold paragraph; table rows become
 * lines. Every other tag is unwrapped (its text stays), script/style-like elements go with their contents, all other
 * attributes are dropped, and unclosed tags are closed.
 */
export function sanitizeHtml(html: string, opts: { newTab?: boolean } = {}): string {
  /** An open element: its name, and what to write when it closes ("" for an unwrapped one). */
  const stack: { name: string; close: string; link?: boolean }[] = [];
  let out = "";
  const linkOpen = opts.newTab ? ' target="_blank" rel="noopener noreferrer"' : ' rel="noopener"';
  for (const tok of tokenize(html ?? "")) {
    if (tok.t === "text") { out += escText(decodeEntities(tok.v)); continue; }
    const name = tok.name;
    if (tok.t === "open") {
      if (name === "br") { out += "<br>"; continue; }
      if (VOID.has(name) || DROP_WITH_CONTENT.has(name)) continue;
      const style = styleOf(tok.attrs);
      if (name === "a") {
        const href = safeHref(tok.attrs);
        if (!href || stack.some((f) => f.link)) { stack.push({ name, close: "" }); continue; }
        stack.push({ name, close: "</a>", link: true });
        out += `<a href="${escAttr(href)}"${linkOpen}>`;
        continue;
      }
      let open = "";
      let close = "";
      if (/^h[1-6]$/.test(name)) { open = "<p><b>"; close = "</b></p>"; }
      else if (name === "tr") { open = "<div>"; close = "</div>"; }
      else if (name === "td" || name === "th") close = " ";
      else if ((name === "b" || name === "strong") && notBold(style)) { /* a wrapper, not bold */ }
      else if ((name === "i" || name === "em") && notItalic(style)) { /* a wrapper, not italic */ }
      else if (ALLOWED.has(name)) { open = `<${name}>`; close = `</${name}>`; }
      const extra = styledFormats(style).filter((f) => !open.includes(`<${f}>`) && !(f === "b" && name === "strong") && !(f === "i" && name === "em"));
      open += extra.map((f) => `<${f}>`).join("");
      close = extra.reverse().map((f) => `</${f}>`).join("") + close;
      if (tok.selfClose && !ALLOWED.has(name)) continue;
      out += open;
      stack.push({ name, close });
    } else {
      if (name === "br") continue;
      let idx = -1;
      for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === name) { idx = k; break; }
      if (idx < 0) continue;
      while (stack.length > idx) out += stack.pop()!.close;
    }
  }
  while (stack.length) out += stack.pop()!.close;
  return out;
}

/** The plain-text alternative of some HTML: block tags become line breaks, list items "- ", links "text (href)". */
export function htmlToText(html: string): string {
  let out = "";
  const hrefs: (string | null)[] = [];
  const linkStart: number[] = [];
  const newline = (n: 1 | 2) => {
    if (!out) return;
    const have = /\n*$/.exec(out)![0].length;
    if (have < n) out += "\n".repeat(n - have);
  };
  for (const tok of tokenize(sanitizeHtml(html ?? ""))) {
    if (tok.t === "text") { out += decodeEntities(tok.v).replace(/[ \t\r\n\u00a0]+/g, " "); continue; }
    if (tok.t === "open") {
      if (tok.name === "br") out += "\n";
      else if (tok.name === "p") newline(2);
      else if (tok.name === "div" || tok.name === "ul" || tok.name === "ol" || tok.name === "blockquote") newline(1);
      else if (tok.name === "li") { newline(1); out += "- "; }
      else if (tok.name === "a") { hrefs.push(safeHref(tok.attrs)); linkStart.push(out.length); }
    } else if (tok.name === "p") newline(2);
    else if (["div", "ul", "ol", "li", "blockquote"].includes(tok.name)) newline(1);
    else if (tok.name === "a") {
      const href = hrefs.pop();
      const from = linkStart.pop() ?? out.length;
      const label = out.slice(from).trim();
      const bare = href?.replace(/^mailto:/i, "");
      if (href && label !== href && label !== bare) out += ` (${bare})`;
    }
  }
  return out.split("\n").map((l) => l.replace(/^[ \t]+|[ \t]+$/g, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Plain text as HTML: paragraphs on blank lines, <br> on single newlines, http(s) URLs as links. */
export function textToHtml(text: string): string {
  return (text ?? "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n+/).map((p) => p.replace(/^\n+|\n+$/g, "")).filter((p) => p.trim())
    .map((p) => `<p>${p.split("\n").map((line) => linkify(line).map((s) => (s.href ? `<a href="${escAttr(s.href)}" rel="noopener">${escText(s.text)}</a>` : escText(s.text))).join("")).join("<br>")}</p>`).join("");
}

/** Where mail programs start the quoted earlier message in HTML: Gmail, Apple Mail, Outlook, Yahoo. */
const QUOTE_STARTS = [
  /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bgmail_quote\b/i,
  /<blockquote\b[^>]*\bclass\s*=\s*["'][^"']*\bgmail_quote\b/i,
  /<blockquote\b[^>]*\btype\s*=\s*["']?cite\b/i,
  /<div\b[^>]*\bid\s*=\s*["']?(?:divRplyFwdMsg|appendonsend)\b/i,
  /<div\b[^>]*\bclass\s*=\s*["'][^"']*\byahoo_quoted\b/i,
];

/** Raw message HTML cut where the quoted earlier message starts; `quoted` is "" when no quote marker is found. */
export function splitQuotedHtml(html: string): { html: string; quoted: string } {
  const at = Math.min(...QUOTE_STARTS.map((re) => re.exec(html)?.index ?? Infinity));
  return Number.isFinite(at) ? { html: html.slice(0, at), quoted: html.slice(at) } : { html, quoted: "" };
}

/**
 * A message's HTML part ready for the thread page: sanitized (links open in a new tab), with the quoted part split off.
 * null when there is no HTML, it has no words, or the plain text has a quote the HTML doesn't mark (the page then shows the
 * plain text, which it knows how to split).
 */
export function displayHtml(html: string | undefined, plain: string): { html: string; quotedHtml: string } | null {
  if (!html?.trim()) return null;
  const parts = splitQuotedHtml(html);
  const main = sanitizeHtml(parts.html, { newTab: true });
  if (!htmlToText(main)) return null;
  if (!parts.quoted && splitQuoted(plain).quoted) return null;
  return { html: main, quotedHtml: parts.quoted ? sanitizeHtml(parts.quoted, { newTab: true }) : "" };
}

/** A template's HTML with its {{fields}} filled in: values are escaped, and a URL value becomes a link. */
export function fillTemplateHtml(html: string, ctx: TemplateContext): string {
  const safe: TemplateContext = {};
  for (const [k, v] of Object.entries(ctx)) {
    safe[k] = v && linkify(v).map((s) => (s.href ? `<a href="${escAttr(s.href)}" rel="noopener">${escText(s.text)}</a>` : escText(s.text))).join("");
  }
  return sanitizeHtml(fillTemplate(html, safe));
}
