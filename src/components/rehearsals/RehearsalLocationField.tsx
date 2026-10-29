"use client";
/**
 * The rehearsal location typeahead, used by the new-rehearsal form and the When & where card. The dropdown first lists the
 * places already used on earlier rehearsals (unique by name + address, most recent first, only ones with an address and
 * coordinates), filtered by what is typed (reh-location-saved); then geo.autocomplete's address suggestions, debounced 300 ms
 * (reh-location-suggestion). Picking a saved place calls onPick with its name, address, lat and lng at once. Picking a new
 * address calls onPick and shows a small Name input ("David's", reh-location-name-input); leaving it calls onPick again with the
 * name, so it is saved with the location and appears in later rehearsals' lists. onType fires on every keystroke.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import type { Rehearsal, RehearsalLocation } from "@/schema";

export interface Place { name?: string; address: string; lat: number; lng: number }
/** The shape rehearsals.setLocation and rehearsals.create take (name optional, the rest from the autocomplete). */
export const placeOf = (p: Place): RehearsalLocation => ({ ...(p.name ? { name: p.name } : {}), address: p.address, lat: p.lat, lng: p.lng });

/** Unique places from earlier rehearsals, most recent first; only those with an address and coordinates. */
export function savedPlaces(rehearsals: readonly Rehearsal[]): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const r of [...rehearsals].sort((a, b) => b.date.localeCompare(a.date))) {
    const l = r.location;
    if (!l?.address || l.lat === undefined || l.lng === undefined) continue;
    const key = `${(l.name ?? "").toLowerCase()}|${l.address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...(l.name ? { name: l.name } : {}), address: l.address, lat: l.lat, lng: l.lng });
  }
  return out;
}

export function RehearsalLocationField({ initial, rehearsals, onType, onPick, testid = "reh-location-input" }: {
  initial: string; rehearsals: readonly Rehearsal[]; onType?(text: string): void; onPick(p: Place): void; testid?: string;
}) {
  const { call, error } = useCommand();
  const [text, setText] = useState(initial);
  const [hits, setHits] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState<Place | null>(null); // a newly picked address awaiting its Name
  const [name, setName] = useState("");
  const seq = useRef(0);
  const skip = useRef(false); // after a pick, the label we just wrote doesn't search again
  const saved = useMemo(() => savedPlaces(rehearsals), [rehearsals]);
  const q = text.trim().toLowerCase();
  const savedHits = saved.filter((p) => !q || `${p.name ?? ""} ${p.address}`.toLowerCase().includes(q));

  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const t0 = text.trim();
    const my = ++seq.current;
    if (t0.length < 3) { setHits([]); return; }
    const t = setTimeout(async () => {
      const r = await call<{ suggestions: Place[] }>("geo.autocomplete", { q: t0 });
      if (my === seq.current) { setHits(r?.suggestions ?? []); setOpen(true); }
    }, 300);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  function label(p: Place) { return p.name && !p.address.startsWith(p.name) ? `${p.name}, ${p.address}` : p.address; }
  function pick(p: Place, isNew: boolean) {
    skip.current = true; seq.current++;
    setText(label(p));
    setHits([]); setOpen(false);
    setFresh(isNew ? p : null); setName(isNew ? (p.name ?? "") : "");
    onPick(p);
  }
  function commitName() {
    if (!fresh) return;
    const n = name.trim();
    if (n === (fresh.name ?? "")) return;
    const next = { ...fresh, ...(n ? { name: n } : { name: undefined }) };
    setFresh(next);
    onPick(next);
  }

  const showList = open && (savedHits.length > 0 || hits.length > 0);
  const row = "w-full cursor-pointer rounded-md border-0 bg-transparent px-3 py-2 text-left";
  return (
    <div className="grid gap-1">
      <input className="input" value={text} placeholder="Start typing an address or place…" autoComplete="off" aria-label="Rehearsal address" data-testid={testid}
        onChange={(e) => { setText(e.target.value); setFresh(null); setOpen(true); onType?.(e.target.value); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {showList && (
        <ul role="listbox" className="grid gap-1 rounded-[10px] border p-1" style={{ background: "var(--surface)", borderColor: "var(--input-border)" }}>
          {savedHits.map((h, i) => (
            <li key={`saved-${h.lat},${h.lng},${i}`} role="option" aria-selected={false} data-testid="reh-location-saved">
              <button type="button" className={row} style={{ color: "var(--ink)", font: "inherit" }} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h, false)}>
                {h.name && <b>{h.name}</b>}{h.name ? " " : ""}<span className="s">{h.address}</span>
              </button>
            </li>
          ))}
          {hits.map((h, i) => (
            <li key={`${h.lat},${h.lng},${i}`} role="option" aria-selected={false} data-testid="reh-location-suggestion">
              <button type="button" className={row} style={{ color: "var(--ink)", font: "inherit" }} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h, true)}>
                {h.name && <b>{h.name}</b>}{h.name ? " " : ""}<span className="s">{h.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {fresh && (
        <label className="grid gap-1"><span className="lbl">Name</span>
          <input className="input" value={name} placeholder="e.g. David's" autoComplete="off" data-testid="reh-location-name-input"
            onChange={(e) => setName(e.target.value)} onBlur={commitName}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitName(); } }} />
        </label>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
