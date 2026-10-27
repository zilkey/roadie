/**
 * Small, hand-written HTML helpers for outgoing mail: a sanitizer with an allowlist, an HTML -> plain text alternative,
 * and plain text -> HTML paragraphs. Used on the server (before sending, on the Gmail signature) and in the editor
 * (on paste). Nothing here renders received HTML: Roadie shows the plain text part of what strangers send.
 */
import { linkify } from "./linkify";

const ALLOWED = new Set(["p", "br", "div", "b", "strong", "i", "em", "u", "a", "ul", "ol", "li"]);
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

/**
 * Keeps p, br, div, b, strong, i, em, u, a, ul, ol and li. `a` keeps only `href` (http, https or mailto) and gets
 * rel="noopener". Every other tag is unwrapped (its text stays), script/style-like elements go with their contents,
 * all other attributes are dropped, and unclosed tags are closed.
 */
export function sanitizeHtml(html: string): string {
  const stack: string[] = [];
  let out = "";
  for (const tok of tokenize(html ?? "")) {
    if (tok.t === "text") { out += escText(decodeEntities(tok.v)); continue; }
    if (!ALLOWED.has(tok.name)) continue;
    if (tok.t === "open") {
      if (tok.name === "br") { out += "<br>"; continue; }
      if (tok.name === "a") {
        const href = safeHref(tok.attrs);
        if (!href || stack.includes("a")) { stack.push("a:skip"); continue; }
        stack.push("a");
        out += `<a href="${escAttr(href)}" rel="noopener">`;
        continue;
      }
      stack.push(tok.name);
      out += `<${tok.name}>`;
    } else {
      if (tok.name === "br") continue;
      const idx = Math.max(stack.lastIndexOf(tok.name), tok.name === "a" ? stack.lastIndexOf("a:skip") : -1);
      if (idx < 0) continue;
      while (stack.length > idx) {
        const n = stack.pop()!;
        if (n !== "a:skip") out += `</${n}>`;
      }
    }
  }
  while (stack.length) { const n = stack.pop()!; if (n !== "a:skip") out += `</${n}>`; }
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
      else if (tok.name === "div" || tok.name === "ul" || tok.name === "ol") newline(1);
      else if (tok.name === "li") { newline(1); out += "- "; }
      else if (tok.name === "a") { hrefs.push(safeHref(tok.attrs)); linkStart.push(out.length); }
    } else if (tok.name === "p") newline(2);
    else if (["div", "ul", "ol", "li"].includes(tok.name)) newline(1);
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
