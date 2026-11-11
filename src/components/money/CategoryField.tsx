"use client";
import { useState } from "react";

/**
 * A category picker you can type into: focus shows every category, typing filters by name, arrows move and Enter picks,
 * or click one. `options` is [key, label][]; the box shows the picked label until you type again.
 * Testids: `${testid}` on the input, `${testid}-list` on the list, `${testid}-opt-${key}` on each option.
 */
export function CategoryField({ value, options, onChange, testid, label = "Category" }: {
  value: string; options: readonly [string, string][]; onChange(key: string): void; testid: string; label?: string;
}) {
  const [query, setQuery] = useState<string | null>(null); // null = not typing: show the picked label
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const q = (query ?? "").trim().toLowerCase();
  const hits = q ? options.filter(([k, l]) => l.toLowerCase().includes(q) || k.includes(q)) : options;
  const current = options.find(([k]) => k === value)?.[1] ?? value;
  const pick = (k: string) => { onChange(k); setQuery(null); setOpen(false); };
  return (
    <div className="relative grid gap-1">
      <span className="lbl">{label}</span>
      <input className="input" type="text" autoComplete="off" role="combobox" aria-label={label} aria-expanded={open} aria-autocomplete="list" value={query ?? current} data-testid={testid}
        onFocus={(e) => { setOpen(true); setCursor(0); e.currentTarget.select(); }}
        onBlur={() => setTimeout(() => { setOpen(false); setQuery(null); }, 150)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setCursor(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          else if (e.key === "Enter" && open) { e.preventDefault(); if (hits[cursor]) pick(hits[cursor][0]); }
          else if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setQuery(null); }
        }} />
      {open && hits.length > 0 && (
        <div className="card absolute left-0 right-0 top-full z-10 mt-1 grid max-h-64 gap-0 overflow-auto p-1" role="listbox" data-testid={`${testid}-list`}>
          {hits.map(([k, l], i) => (
            <button key={k} type="button" role="option" aria-selected={i === cursor} className={`rounded px-2 py-1 text-left hover:bg-soft${i === cursor ? " bg-soft" : ""}`}
              data-testid={`${testid}-opt-${k}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(k)}>{l}</button>
          ))}
        </div>
      )}
    </div>
  );
}
