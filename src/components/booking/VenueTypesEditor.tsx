"use client";
import { useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { Icons } from "@/components/people/shared";
import { useCollection } from "@/lib/firestore-hooks";
import { useVenueTypes } from "@/lib/venueTypes";
import type { Venue } from "@/schema";

/**
 * The venue type list every band shares (venueTypes.*). Add, rename (its venues keep it: they hold the key), and remove a type no venue
 * has any more. A venue's form adds one too, with "Other…".
 */
export function VenueTypesEditor() {
  const types = useVenueTypes();
  const venues = useCollection<Venue>("venues").rows ?? [];
  const { call, error, busy } = useCommand();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const usedOn = (id: string) => venues.filter((v) => v.type === id && !v.mergedInto).length;

  async function add() {
    if (await call("venueTypes.add", { label: label.trim() })) { setLabel(""); setAdding(false); }
  }
  async function rename() {
    if (editId && (await call("venueTypes.rename", { id: editId, label: name.trim() }))) setEditId(null);
  }
  async function remove(id: string, l: string) {
    if (confirm(`Take "${l}" off the venue types for every band?`)) await call("venueTypes.remove", { id });
  }

  return (
    <section className="card" data-testid="venue-types" aria-labelledby="venue-types-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="venue-types-title" className="text-lg font-bold">Types</h2><p className="s">Renaming a type renames it on its venues. A type can come off the list once no venue has it.</p></div>
        {!adding && <button type="button" className="btn ghost" data-testid="add-venue-type" onClick={() => setAdding(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg> New type</button>}
      </div>
      <ErrorBox error={error} />
      {adding && (
        <form className="cfg-form" data-testid="new-venue-type" onSubmit={(e) => { e.preventDefault(); if (label.trim()) void add(); }}
          onKeyDown={(e) => { if (e.key === "Escape") { setAdding(false); setLabel(""); } }}>
          <h3>New type</h3>
          <input className="input" autoFocus placeholder="e.g. Winery" aria-label="Type name" value={label} onChange={(e) => setLabel(e.target.value)} data-testid="new-venue-type-label" />
          <div className="cfg-actions">
            <button type="button" className="btn text" onClick={() => { setAdding(false); setLabel(""); }}>Cancel</button>
            <button className="btn acc" disabled={busy || !label.trim()} data-testid="new-venue-type-add">Add type</button>
          </div>
        </form>
      )}
      {editId && (
        <form className="cfg-form" data-testid="edit-venue-type" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void rename(); }}
          onKeyDown={(e) => { if (e.key === "Escape") setEditId(null); }}>
          <h3>Rename type</h3>
          <input className="input" autoFocus aria-label="Type name" value={name} onChange={(e) => setName(e.target.value)} data-testid="edit-venue-type-label" />
          <div className="cfg-actions">
            <button type="button" className="btn text" onClick={() => setEditId(null)}>Cancel</button>
            <button className="btn acc" disabled={busy || !name.trim()} data-testid="edit-venue-type-done">Done</button>
          </div>
        </form>
      )}
      <div className="cfg-scroll"><table className="cfg-table">
        <thead><tr><th>Type</th><th>Venues</th><th className="act"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{types.map((t) => {
          const n = usedOn(t.id);
          return (
            <tr key={t.id} data-testid={`venue-type-${t.id}`} data-editing={editId === t.id ? "1" : undefined}>
              <td className="nm">{t.label}</td>
              <td>{n}</td>
              <td className="act">
                <button type="button" className="icon-btn" aria-label={`Rename ${t.label}`} data-testid={`venue-type-edit-${t.id}`} onClick={() => { setName(t.label); setEditId(t.id); }}>{Icons.edit}</button>
                <button type="button" className="icon-btn danger" aria-label={`Remove ${t.label}`} data-testid={`venue-type-remove-${t.id}`} disabled={busy || n > 0}
                  title={n > 0 ? `${n} ${n === 1 ? "venue has" : "venues have"} this type` : undefined} onClick={() => void remove(t.id, t.label)}>{Icons.trash}</button>
              </td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </section>
  );
}
