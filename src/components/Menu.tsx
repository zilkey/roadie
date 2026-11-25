"use client";
import { useEffect, useId, useRef, useState } from "react";

export interface MenuItem {
  key: string; label: string; onSelect(): void; icon?: React.ReactNode;
  /** Overrides the row's `${testid}-menu-${key}` test id, for items that kept an id from an earlier layout. */
  testid?: string;
  /** Disabled items stay visible; `hint` says why. */
  disabled?: boolean; hint?: string; danger?: boolean;
  /** A small line under the label, always shown ("Last checked Oct 30"). */
  sub?: string;
  /** Draw a divider above this item. */
  divider?: boolean;
  /** One of a set of choices (a song's status): the row is a menuitemradio, ticked when true. */
  checked?: boolean;
}

/**
 * A "⋯" actions menu. The trigger is a 44px icon button, or an outline button holding `trigger` (e.g. "More ▾" in a page header), restyled by `triggerClass`; the list is role=menu with role=menuitem rows.
 * Closes on Escape (focus returns to the trigger) and on a click outside; arrow keys, Home and End move between items.
 * Items with `checked` set are radio choices (role=menuitemradio, a ✓ on the ticked one).
 * Test ids: `${testid}-actions` (trigger), `${testid}-menu`, `${testid}-menu-${item.key}`.
 */
export function Menu({ label, testid, items, trigger, triggerClass }: { label: string; testid: string; items: MenuItem[]; trigger?: React.ReactNode; triggerClass?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const enabled = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    enabled()[0]?.focus();
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btn.current?.focus(); return; }
    if (e.key === "Tab") { setOpen(false); return; }
    const list = enabled();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % list.length : e.key === "ArrowUp" ? (i - 1 + list.length) % list.length : e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : -1;
    if (next >= 0) { e.preventDefault(); list[next]?.focus(); }
  }

  return (
    <div className="menu" ref={root} onKeyDown={open ? onKey : undefined}>
      <button ref={btn} type="button" className={triggerClass ?? (trigger ? "btn outline" : "icon-btn")} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        data-testid={`${testid}-actions`} onClick={() => setOpen(!open)}>
        {trigger ?? <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>}
      </button>
      {open && (
        <div className="menu-list" id={id} role="menu" aria-label={label} data-testid={`${testid}-menu`}>
          {items.map((it) => (
            <div key={it.key} role="none">
              {it.divider && <div className="menu-sep" role="separator" />}
              <button type="button" role={it.checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={it.checked} className={`menu-item${it.danger ? " danger" : ""}`} aria-disabled={it.disabled || undefined} tabIndex={-1}
                title={it.disabled ? it.hint : undefined} data-testid={it.testid ?? `${testid}-menu-${it.key}`}
                onClick={() => { if (it.disabled) return; setOpen(false); btn.current?.focus(); it.onSelect(); }}>
                {it.checked !== undefined && <span aria-hidden className="w-4 text-center">{it.checked ? "✓" : ""}</span>}
                {it.icon}
                <span className="grid text-left"><span>{it.label}</span>{it.sub && <span className="s" data-testid={`${it.testid ?? `${testid}-menu-${it.key}`}-sub`}>{it.sub}</span>}{it.disabled && it.hint && <span className="s">{it.hint}</span>}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
