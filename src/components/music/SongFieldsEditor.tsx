"use client";
import { useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { Icons } from "@/components/people/shared";
import { useCollection } from "@/lib/firestore-hooks";
import { useDragReorder } from "@/lib/drag-reorder";
import { moved } from "@/components/shows/checklists/shared";
import type { Artist, Song, SongField } from "@/schema";

const Grip = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
  </svg>
);

/**
 * The artist's song fields ("Capo", "Tuning"): labels defined here once, values filled in on each song. Every change is
 * its own command (not an artists.update patch) so removing one can clear its values from the songs in the same write.
 */
export function SongFieldsEditor({ artist }: { artist: Artist }) {
  const { call, error, busy } = useCommand();
  const songs = useCollection<Song>("songs").rows ?? [];
  const fields = artist.songFields ?? [];
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const ids = fields.map((f) => f.id);
  const dr = useDragReorder((from, to) => void call("artists.reorderSongFields", { id: artist.id, fieldIds: moved(ids, from, to) }));
  const usedOn = (f: SongField) => songs.filter((s) => (s.fields ?? []).some((v) => v.fieldId === f.id)).length;

  async function add() {
    if (await call("artists.addSongField", { id: artist.id, label: label.trim() })) { setLabel(""); setAdding(false); }
  }
  async function rename() {
    if (editId && (await call("artists.updateSongField", { id: artist.id, fieldId: editId, label: name.trim() }))) setEditId(null);
  }
  async function remove(f: SongField) {
    const n = usedOn(f);
    const has = n === 0 ? "No songs have a value for it." : `${n} song${n === 1 ? " has" : "s have"} a value for it, and ${n === 1 ? "that value" : "those values"} will be deleted.`;
    if (confirm(`Delete the "${f.label}" field? ${has}`)) await call("artists.removeSongField", { id: artist.id, fieldId: f.id });
  }

  return (
    <section className="card" data-testid="song-fields" aria-labelledby="song-fields-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="song-fields-title" className="text-lg font-bold">Song fields</h2><p className="s">Extra facts to note on each song, like Capo or Tuning. Define them here, fill them in on the song.</p></div>
        {!adding && <button type="button" className="btn ghost" data-testid="add-song-field" onClick={() => setAdding(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg> New field</button>}
      </div>
      <ErrorBox error={error} />
      {adding && (
        <form className="cfg-form" data-testid="new-song-field" onSubmit={(e) => { e.preventDefault(); if (label.trim()) void add(); }}
          onKeyDown={(e) => { if (e.key === "Escape") { setAdding(false); setLabel(""); } }}>
          <h3>New field</h3>
          <input className="input" autoFocus placeholder="e.g. Capo" aria-label="Field name" value={label} onChange={(e) => setLabel(e.target.value)} data-testid="new-song-field-label" />
          <div className="cfg-actions">
            <button type="button" className="btn text" onClick={() => { setAdding(false); setLabel(""); }}>Cancel</button>
            <button className="btn acc" disabled={busy || !label.trim()} data-testid="new-song-field-add">Add field</button>
          </div>
        </form>
      )}
      {editId && (
        <form className="cfg-form" data-testid="edit-song-field" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void rename(); }}
          onKeyDown={(e) => { if (e.key === "Escape") setEditId(null); }}>
          <h3>Rename field</h3>
          <input className="input" autoFocus aria-label="Field name" value={name} onChange={(e) => setName(e.target.value)} data-testid="edit-song-field-label" />
          <div className="cfg-actions">
            <button type="button" className="btn text" onClick={() => setEditId(null)}>Cancel</button>
            <button className="btn acc" disabled={busy || !name.trim()} data-testid="edit-song-field-done">Done</button>
          </div>
        </form>
      )}
      {fields.length === 0 ? <p className="s text-center" data-testid="song-fields-empty">No song fields yet.</p> : (
        <div className="cfg-scroll"><table className="cfg-table">
          <thead><tr><th className="act"><span className="sr-only">Reorder</span></th><th>Field</th><th>Songs with a value</th><th className="act"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{fields.map((f, i) => (
            <tr key={f.id} data-testid={`song-field-${f.id}`} data-editing={editId === f.id ? "1" : undefined} {...dr.row(i)}>
              <td className="act"><span className="flex w-6 cursor-grab select-none justify-center text-muted" {...dr.handle(i)} aria-hidden="true"><Grip /></span></td>
              <td className="nm">{f.label}</td>
              <td>{usedOn(f)}</td>
              <td className="act">
                <button type="button" className="icon-btn" aria-label={`Rename ${f.label}`} data-testid={`song-field-edit-${f.id}`} onClick={() => { setName(f.label); setEditId(f.id); }}>{Icons.edit}</button>
                <button type="button" className="icon-btn danger" aria-label={`Delete ${f.label}`} data-testid={`song-field-remove-${f.id}`} disabled={busy} onClick={() => void remove(f)}>{Icons.trash}</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
