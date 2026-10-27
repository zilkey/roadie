"use client";
import { useEffect, useId, useRef, useState } from "react";

export interface CheckGroup { label?: string; options: { key: string; label: string }[] }

/**
 * A filter that picks several values: a select-styled button ("All venue types", "Theater", "3 venue types") opening a
 * list of checkboxes. Nothing checked means no filter. Closes on Escape and on a click outside.
 * Test ids: `${testid}` (button), `${testid}-list`, `${testid}-${key}` (each checkbox), `${testid}-clear`.
 */
export function CheckFilter({ label, all, noun, groups, value, onChange, testid }: {
  label: string; all: string; noun: string; groups: CheckGroup[]; value: string[]; onChange(v: string[]): void; testid: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const options = groups.flatMap((g) => g.options);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const picked = options.filter((o) => value.includes(o.key));
  const text = picked.length === 0 ? all : picked.length === 1 ? picked[0].label : `${picked.length} ${noun}`;
  const toggle = (key: string) => onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);

  return (
    <div className="menu" ref={root} onKeyDown={(e) => { if (open && e.key === "Escape") { e.stopPropagation(); setOpen(false); btn.current?.focus(); } }}>
      <button ref={btn} type="button" className={`select text-left${picked.length ? "" : " muted"}`} aria-label={label} aria-haspopup="true" aria-expanded={open}
        aria-controls={open ? id : undefined} data-testid={testid} onClick={() => setOpen(!open)}>
        {text}
      </button>
      {open && (
        <div className="menu-list check-list" id={id} role="group" aria-label={label} data-testid={`${testid}-list`}>
          {groups.filter((g) => g.options.length > 0).map((g, i) => (
            <div key={g.label ?? i} className="grid gap-1">
              {g.label && <span className="s font-semibold px-1 pt-1">{g.label}</span>}
              {g.options.map((o) => (
                <label key={o.key} className="check menu-item">
                  <input type="checkbox" checked={value.includes(o.key)} onChange={() => toggle(o.key)} data-testid={`${testid}-${o.key}`} />
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
          ))}
          {options.length === 0 && <span className="s px-2 py-1">Nothing to pick yet.</span>}
          {value.length > 0 && (
            <>
              <div className="menu-sep" role="separator" />
              <button type="button" className="menu-item" onClick={() => onChange([])} data-testid={`${testid}-clear`}>Clear</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
