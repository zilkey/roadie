"use client";
import { useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { useVenueTypes, venueTypeLabel } from "@/lib/venueTypes";

const NEW = "__new";

/**
 * A venue's type, picked from the list every band shares. "Other…" asks for a name: Add puts it on the list for everyone and picks it.
 * A venue still typed with a key that is off the list keeps it as an option, so opening the form never changes it.
 */
export function VenueTypeSelect({ value, onChange, testid }: { value: string; onChange(key: string): void; testid: string }) {
  const types = useVenueTypes();
  const { call, error, busy } = useCommand();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const known = types.some((t) => t.id === value);
  async function add() {
    const r = await call<{ id: string }>("venueTypes.add", { label: label.trim() });
    if (r) { onChange(r.id); setAdding(false); setLabel(""); }
  }
  const close = () => { setAdding(false); setLabel(""); };
  return (
    <div className="grid gap-1">
      <select className="select" value={adding ? NEW : value} data-testid={testid} onChange={(e) => (e.target.value === NEW ? setAdding(true) : (close(), onChange(e.target.value)))}>
        {!known && value && <option value={value}>{venueTypeLabel(types, value)}</option>}
        {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        <option value={NEW}>Other…</option>
      </select>
      {adding && (
        <div className="flex gap-2">
          {/* Not a <form>: this sits inside the venue form, and Enter must add the type, not submit the venue. */}
          <input className="input" autoFocus placeholder="e.g. Winery" aria-label="New venue type" value={label} data-testid={`${testid}-new`}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (label.trim()) void add(); } else if (e.key === "Escape") close(); }} />
          <button type="button" className="btn acc sm" disabled={busy || !label.trim()} onClick={() => void add()} data-testid={`${testid}-add`}>Add</button>
          <button type="button" className="btn ghost sm" onClick={close}>Cancel</button>
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
