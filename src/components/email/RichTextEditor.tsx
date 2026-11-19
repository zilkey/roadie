"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { sanitizeHtml, textToHtml } from "@/lib/email-html";

/** The one place that touches document.execCommand (deprecated but supported everywhere), so it can be swapped later. */
function exec(command: string, value?: string): boolean {
  return document.execCommand(command, false, value);
}

const isBlank = (html: string) => !/<a[\s>]/i.test(html) && html.replace(/<[^>]*>|&nbsp;|\s+/g, "") === "";
/** What a person typed in a link prompt, as a safe address: http(s) and mailto as is, an address with an @ as mailto, a bare domain as https. */
function linkTarget(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (/^(https?:|mailto:)/i.test(s)) return s;
  if (/^[^\s@:/]+@[^\s@:/]+\.[^\s@:/]+$/.test(s)) return `mailto:${s}`;
  if (/^[^\s:/]+\.[^\s:/]+(\/\S*)?$/.test(s)) return `https://${s}`;
  return null;
}

/** The keyboard shortcut for each toolbar action, Gmail's: ⌘/Ctrl + B, I, U, K, and Shift+7 / Shift+8 for the lists. */
const KEYS: Record<string, string> = { bold: "B", italic: "I", underline: "U", link: "K", ol: "Shift+7", ul: "Shift+8", clear: "\\" };
function shortcutAction(e: React.KeyboardEvent): string | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  if (e.shiftKey) return e.code === "Digit7" ? "ol" : e.code === "Digit8" ? "ul" : null;
  const k = e.key.toLowerCase();
  return k === "b" ? "bold" : k === "i" ? "italic" : k === "u" ? "underline" : k === "k" ? "link" : k === "\\" ? "clear" : null;
}

const TOOLS = [
  ["Bold", "bold", <path key="b" d="M6 4h7a3.5 3.5 0 0 1 0 7H6zM6 11h8a3.5 3.5 0 0 1 0 7H6z" />],
  ["Italic", "italic", <path key="i" d="M10 4h8M6 20h8M15 4 9 20" />],
  ["Underline", "underline", <path key="un" d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14" />],
  ["Insert link", "link", <path key="l" d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />],
  ["Bulleted list", "ul", <path key="u" d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />],
  ["Numbered list", "ol", <path key="o" d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1V9M3.5 14.5c0-1 2.5-1 2.5 0S3.5 16 3.5 17.5H6" />],
  ["Clear formatting", "clear", <path key="c" d="M5 5h14M12 5l-3 14M15 19h-6M4 20 20 4" />],
] as const;

/**
 * A small rich text field for mail: bold, italic, underline, links, lists. `value` and `onChange` are HTML (sanitized by
 * sanitizeHtml: only p, br, div, b, strong, i, em, u, a, ul, ol, li, blockquote survive); "" when the field is empty.
 * Pasted content is sanitized the same way, so bold, italic and underline pasted from Gmail or Google Docs (often spans
 * with a style) stay. Enter starts a new paragraph. ⌘/Ctrl + B, I, U and K (link), Shift+7/8 (lists) and \\ (clear) work like Gmail.
 */
export function RichTextEditor({ value, onChange, placeholder, testid }: {
  value: string; onChange(html: string): void; placeholder?: string; testid?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | null>(null); // the last HTML this editor reported, so typing doesn't reset the caret
  const [empty, setEmpty] = useState(isBlank(value));
  const [mod, setMod] = useState("Ctrl+"); // the shortcut prefix shown in the toolbar tips: ⌘ on a Mac
  useEffect(() => { if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) setMod("⌘"); }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || value === emitted.current) return;
    el.innerHTML = sanitizeHtml(value);
    emitted.current = value;
    setEmpty(isBlank(value));
  }, [value]);
  useEffect(() => { try { exec("defaultParagraphSeparator", "p"); } catch { /* old browsers keep div */ } }, []);

  function report() {
    const el = ref.current;
    if (!el) return;
    const clean = sanitizeHtml(el.innerHTML);
    const html = isBlank(clean) ? "" : clean;
    setEmpty(html === "");
    if (html === emitted.current) return;
    emitted.current = html;
    onChange(html);
  }

  function insertLink() {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel) return;
    el.focus();
    const range = sel.rangeCount ? sel.getRangeAt(0) : null;
    const inside = !!range && el.contains(range.commonAncestorContainer);
    const url = linkTarget(window.prompt("Link address") ?? "");
    if (!url) return;
    if (inside && range && !range.collapsed) exec("createLink", url);
    else exec("insertHTML", `<a href="${url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">${url.replace(/^mailto:/, "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</a>`);
    report();
  }

  function run(action: string) {
    ref.current?.focus();
    if (action === "bold") exec("bold");
    else if (action === "italic") exec("italic");
    else if (action === "underline") exec("underline");
    else if (action === "ul") exec("insertUnorderedList");
    else if (action === "ol") exec("insertOrderedList");
    else if (action === "clear") { exec("removeFormat"); exec("unlink"); }
    else return insertLink();
    report();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const action = shortcutAction(e);
    if (!action) return;
    e.preventDefault(); // the browser's own ⌘B/⌘K (bookmarks, search bar) would otherwise win, or skip report()
    run(action);
  }

  function onPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const clean = html ? sanitizeHtml(html) : textToHtml(e.clipboardData.getData("text/plain"));
    if (clean) exec("insertHTML", clean);
    report();
  }

  return (
    <div className="rte">
      <div className="rte-bar" role="toolbar" aria-label="Formatting">
        {TOOLS.map(([label, action, icon]) => (
          <button key={action} type="button" className="rte-btn" aria-label={label} title={`${label} (${mod}${KEYS[action]})`} aria-keyshortcuts={`Control+${KEYS[action]} Meta+${KEYS[action]}`}
            onMouseDown={(e) => e.preventDefault()} onClick={() => run(action)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
          </button>
        ))}
      </div>
      <div className="rte-field">
        {empty && placeholder && <div className="rte-placeholder" aria-hidden="true">{placeholder}</div>}
        <div ref={ref} className="rte-body" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={placeholder || "Message"}
          data-testid={testid} onInput={report} onBlur={report} onPaste={onPaste} onKeyDown={onKeyDown} />
      </div>
    </div>
  );
}
