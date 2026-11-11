"use client";
/**
 * Click to edit. The value is the control: tap it and it becomes its own input, already focused; leaving it (blur, or Enter on a
 * single-line input) saves; Escape puts it back. A pencil shows at the end of the value on hover. After a save a green "Saved"
 * tick sits beside the value for 2.5 s. A failed save keeps the input open with the message under it. Empty rests as "Add…".
 *
 *   <InlineValue testid="where-doors" label="Doors" kind="time" value={times.doors ?? ""} canEdit={admin}
 *     onSave={async (v) => !!(await call("shows.update", {...}))} error={error} />
 *
 * Members (`canEdit=false`) get plain text: no button, no pencil.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type InlineKind = "text" | "textarea" | "time" | "date" | "url" | "select";

export function InlineValue({ testid, label, kind, value, display, link, emptyLabel = "Add…", options = [], placeholder, inputMode, canEdit, onSave, error, validate, autoStart, savedMs = 2500, className }: {
  /** button `${testid}`, input `${testid}-input`, tick `${testid}-saved`, error `${testid}-error`. */
  testid: string;
  /** For aria only; the caller draws the visible label. */
  label: string;
  kind: InlineKind;
  /** The stored value ("" = empty). */
  value: string;
  /** What rests on the page; omitted = the value. An empty value rests as `emptyLabel`. */
  display?: ReactNode;
  /** A link that rests beside the pencil instead of inside the button (a link can't live inside a button): the pencil edits, the link opens. */
  link?: ReactNode;
  emptyLabel?: string;
  /** `select` only. */
  options?: readonly (readonly [string, string])[];
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  /** false → plain text, no button, no pencil. */
  canEdit: boolean;
  /** true = saved; false = keep the input open (the caller set `error`). */
  onSave(next: string): Promise<boolean> | boolean;
  /** Shown under the open input. */
  error?: string | null;
  /** A message keeps the input open and sends nothing. */
  validate?(next: string): string | null;
  /** Open on mount. */
  autoStart?: boolean;
  /** How long the Saved tick stays (tests pass 0). */
  savedMs?: number;
  /** Extra classes on the resting button / text. */
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(autoStart && canEdit ? value : null);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Escape (and a save) unmount the input, which can still fire its blur: that blur must not save again.
  const settled = useRef(false);
  const busy = useRef(false);
  const root = useRef<HTMLSpanElement>(null);
  // Tab out of a time input: Chromium's time field tabs through its own hour/minute/AM-PM segments, so we save and move focus ourselves.
  const tabTo = useRef<"next" | "prev" | null>(null);

  useEffect(() => {
    if (draft !== null || !tabTo.current || !root.current) return;
    const dir = tabTo.current; tabTo.current = null;
    const all = Array.from(document.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"))
      .filter((el) => !root.current!.contains(el) && !el.closest("[hidden],[aria-hidden='true']"));
    const pos = (el: HTMLElement) => root.current!.compareDocumentPosition(el);
    const target = dir === "next" ? all.find((el) => pos(el) & Node.DOCUMENT_POSITION_FOLLOWING) : [...all].reverse().find((el) => pos(el) & Node.DOCUMENT_POSITION_PRECEDING);
    target?.focus();
  }, [draft]);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), savedMs);
    return () => clearTimeout(t);
  }, [saved, savedMs]);

  function open() { settled.current = false; setMsg(null); setSaved(false); setDraft(value); }
  function close() { settled.current = true; setMsg(null); setDraft(null); }

  async function finish(next = draft) {
    if (next === null || settled.current || busy.current) return;
    const trimmed = next.trim();
    if (trimmed === value.trim()) { close(); return; }
    const problem = validate?.(trimmed) ?? null;
    if (problem) { tabTo.current = null; setMsg(problem); return; }
    busy.current = true;
    try {
      if (await onSave(trimmed)) { close(); setSaved(true); } else tabTo.current = null;
    } finally { busy.current = false; }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Enter" && kind !== "textarea" && kind !== "select") { e.preventDefault(); void finish(); }
    if (e.key === "Tab" && kind === "time") { e.preventDefault(); tabTo.current = e.shiftKey ? "prev" : "next"; void finish(); }
  };

  if (draft === null) {
    const empty = value.trim() === "";
    const shown = empty ? emptyLabel : display ?? (kind === "select" ? options.find(([v]) => v === value)?.[1] ?? value : value);
    const tick = saved && <span className="val-saved" data-testid={`${testid}-saved`}><TickIcon />Saved</span>;
    if (!canEdit && link && !empty) return <span className={className} data-testid={testid}>{link}</span>;
    if (!canEdit) {
      return empty
        ? <span className={`d-muted${className ? ` ${className}` : ""}`} data-testid={testid}>—</span>
        : <span className={`${kind === "textarea" ? "whitespace-pre-line " : ""}${className ?? ""}`.trim() || undefined} data-testid={testid}>{shown}</span>;
    }
    if (link && !empty) {
      return (
        <span ref={root} className="inline-flex max-w-full flex-wrap items-center gap-1">
          <span className={`min-w-0${className ? ` ${className}` : ""}`}>{link}</span>
          <button type="button" className="val !m-0 !px-2" aria-label={`Edit ${label}`} onClick={open} data-testid={testid}><PenIcon /></button>
          {tick}
        </span>
      );
    }
    return (
      <span ref={root} className="inline-flex max-w-full flex-wrap items-center gap-2">
        <button type="button" className={`val${empty ? " add" : ""}${kind === "textarea" ? " whitespace-pre-line" : ""}${className ? ` ${className}` : ""}`}
          aria-label={empty ? `${emptyLabel} ${label}` : `Edit ${label}`} onClick={open} data-testid={testid}>
          <span className="min-w-0">{shown}</span>
          <PenIcon />
        </button>
        {tick}
      </span>
    );
  }

  const shownError = msg ?? error ?? null;
  const common = { "aria-label": label, "data-testid": `${testid}-input`, autoFocus: true, placeholder, onKeyDown };
  return (
    <span ref={root} className="grid gap-1.5">
      {kind === "textarea" ? (
        <GrowTextarea {...common} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => void finish()} />
      ) : kind === "select" ? (
        <select {...common} className="select" value={draft} onBlur={() => void finish()}
          onChange={(e) => { setDraft(e.target.value); void finish(e.target.value); }}>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ) : (
        <input {...common} className="input" type={kind === "time" || kind === "date" ? kind : kind === "url" ? "url" : "text"} inputMode={inputMode}
          value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => void finish()} />
      )}
      {shownError && <span className="text-[0.8125rem] font-semibold text-[var(--danger)]" role="alert" data-testid={`${testid}-error`}>{shownError}</span>}
    </span>
  );
}

/** The kit's AutoGrowTextarea without the import cycle (kit imports the buttons below). */
function GrowTextarea({ value, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t || globalThis.CSS?.supports?.("field-sizing", "content")) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} {...rest} className="input grow" value={value} />;
}

export const PenIcon = () => (
  <svg className="pen" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);
const TickIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7" /></svg>
);

/** 44 px icon button with a pencil: opens a card's form (`aria-label="Edit <card title>"`). */
export function PencilButton({ label, onClick, testid, className }: { label: string; onClick(): void; testid?: string; className?: string }) {
  return (
    <button type="button" className={`ib${className ? ` ${className}` : ""}`} aria-label={label} title={label} onClick={onClick} data-testid={testid}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    </button>
  );
}

/** 44 px icon button with a plus: adds to a list card. */
export function PlusButton({ label, onClick, testid, className }: { label: string; onClick(): void; testid?: string; className?: string }) {
  return (
    <button type="button" className={`ib${className ? ` ${className}` : ""}`} aria-label={label} title={label} onClick={onClick} data-testid={testid}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
    </button>
  );
}
