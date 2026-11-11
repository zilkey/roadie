"use client";
import { useEffect, useRef, useState } from "react";
import { runCommand } from "@/lib/commands";

export interface Place { name?: string; address: string; lat: number; lng: number }

/**
 * A typed address / place field with a suggestion list (geo.autocomplete through the server, debounced 300 ms).
 * `value` is the text to show (e.g. a saved label); typing replaces it and calls `onChange(text)` (so a caller can
 * drop a previous pick); choosing a suggestion calls `onPick(place)`. Suggestion rows get `${testId}-suggestion`.
 */
export function AddressAutocomplete({ value, onPick, onChange, placeholder, testId, disabled }: {
  value: string; onPick(place: Place): void; onChange?(text: string): void; placeholder?: string; testId?: string; disabled?: boolean;
}) {
  const [text, setText] = useState(value);
  const [hits, setHits] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const skip = useRef(false); // set after a pick so the label we just wrote doesn't search again
  useEffect(() => { setText(value); }, [value]);

  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const q = text.trim();
    const my = ++seq.current;
    if (q.length < 3) { setHits([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await runCommand<{ suggestions: Place[] }>("geo.autocomplete", { q });
        if (my === seq.current) { setHits(r.suggestions ?? []); setOpen(true); }
      } catch { if (my === seq.current) setHits([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [text]);

  function pick(p: Place) {
    skip.current = true; seq.current++;
    const label = p.name && !p.address.startsWith(p.name) ? `${p.name}, ${p.address}` : p.address;
    setText(label); setHits([]); setOpen(false);
    onPick(p);
  }
  return (
    <div className="relative">
      <input className="input" value={text} placeholder={placeholder} disabled={disabled} autoComplete="off" data-testid={testId}
        onChange={(e) => { setText(e.target.value); setOpen(true); onChange?.(e.target.value); }}
        onFocus={() => hits.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && hits.length > 0 && (
        <ul className="absolute left-0 right-0 z-10 mt-1 grid max-h-64 overflow-auto rounded-[10px] border p-1" style={{ background: "var(--surface)", borderColor: "var(--input-border)" }} role="listbox">
          {hits.map((h, i) => (
            <li key={`${h.lat},${h.lng},${i}`} role="option" aria-selected={false}>
              <button type="button" className="w-full cursor-pointer rounded-md border-0 bg-transparent px-3 py-2 text-left" style={{ color: "var(--ink)", font: "inherit" }}
                onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)} data-testid={testId ? `${testId}-suggestion` : undefined}>
                {h.name && <b>{h.name}</b>}{h.name ? " " : ""}<span className="s">{h.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
