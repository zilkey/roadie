"use client";
import { useEffect, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { InlineValue } from "@/components/InlineValue";
import { Icons } from "@/components/people/shared";
import { useCollection } from "@/lib/firestore-hooks";
import { useDragReorder } from "@/lib/drag-reorder";
import { moved } from "@/components/shows/checklists/shared";
import type { Artist, Show, Song, SongField } from "@/schema";

const Grip = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
  </svg>
);

export type FieldKind = "song" | "show";
const COPY = {
  song: { title: "Song fields", blurb: "Extra facts to note on each song, like Capo or Tuning. Define them here, fill them in on the song. Tick In setlists to offer one when printing a setlist.", eg: "Capo", plural: "songs", coll: "songs" },
  show: { title: "Show fields", blurb: "Extra facts to note on each show, like Parking or Hotel. Define them here, fill them in on the show (admins only).", eg: "Parking", plural: "shows", coll: "shows" },
} as const;
type Flag = "inTable" | "inSetlists";
const SETLIST_LABEL_HINT = "A shorter name printed on setlists (blank prints the field name)";
const SETLISTS_HINT = "Offered as an extra field when printing a setlist";
const TABLE_HINT = {
  song: "A column in the Songs list",
  show: "A column in the Shows list (admins only)",
} as const;

/**
 * The artist's custom fields for songs or shows ("Capo", "Parking"): labels defined here once, values filled in on each record. Every change is
 * its own command (not an artists.update patch) so removing one can clear its values from the records in the same write.
 */
export function CustomFieldsEditor({ artist, kind }: { artist: Artist; kind: FieldKind }) {
  const c = COPY[kind];
  const Kind = kind === "song" ? "Song" : "Show";
  const { call, error, busy } = useCommand();
  const rows = (useCollection<Song | Show>(c.coll).rows ?? []) as { fields?: { fieldId: string }[] }[];
  const fields = (kind === "song" ? artist.songFields : artist.showFields) ?? [];
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [desc, setDesc] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  // "In table" / "In setlists" ticks show at once, keyed "<flag>:<fieldId>"; each is dropped once the artist doc agrees, or if its save fails (the doc is the truth again).
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  useEffect(() => setTicked((t) => {
    const left = Object.fromEntries(Object.entries(t).filter(([k, on]) => { const [flag, id] = k.split(":") as [Flag, string]; return !!fields.find((f) => f.id === id)?.[flag] !== on; }));
    return Object.keys(left).length === Object.keys(t).length ? t : left;
  }), [fields]);
  const isOn = (f: SongField, flag: Flag) => ticked[`${flag}:${f.id}`] ?? !!f[flag];
  async function tick(f: SongField, flag: Flag, on: boolean) {
    const k = `${flag}:${f.id}`;
    setTicked((t) => ({ ...t, [k]: on }));
    const cmd = flag === "inTable" ? `artists.set${Kind}FieldInTable` : "artists.setSongFieldInSetlists";
    if (!(await call(cmd, { id: artist.id, fieldId: f.id, [flag]: on }))) setTicked(({ [k]: _, ...t }) => t);
  }
  const ids = fields.map((f) => f.id);
  const dr = useDragReorder((from, to) => void call(`artists.reorder${Kind}Fields`, { id: artist.id, fieldIds: moved(ids, from, to) }));
  const usedOn = (f: SongField) => rows.filter((s) => (s.fields ?? []).some((v) => v.fieldId === f.id)).length;

  async function add() {
    if (await call(`artists.add${Kind}Field`, { id: artist.id, label: label.trim(), ...(desc.trim() ? { description: desc.trim() } : {}) })) { setLabel(""); setDesc(""); setAdding(false); }
  }
  // An existing field's description is click-to-edit and saves on leaving it; blank removes it.
  const saveDescription = async (f: SongField, v: string) => !!(await call(`artists.update${Kind}Field`, { id: artist.id, fieldId: f.id, description: v.trim() }));
  // A song field's setlist label is click-to-edit too; blank removes it (the label prints).
  const saveSetlistLabel = async (f: SongField, v: string) => !!(await call("artists.updateSongField", { id: artist.id, fieldId: f.id, setlistLabel: v.trim() }));
  async function rename() {
    if (editId && (await call(`artists.update${Kind}Field`, { id: artist.id, fieldId: editId, label: name.trim() }))) setEditId(null);
  }
  async function remove(f: SongField) {
    const n = usedOn(f);
    const has = n === 0 ? `No ${c.plural} have a value for it.` : `${n} ${n === 1 ? kind : c.plural} ${n === 1 ? "has" : "have"} a value for it, and ${n === 1 ? "that value" : "those values"} will be deleted.`;
    if (confirm(`Delete the "${f.label}" field? ${has}`)) await call(`artists.remove${Kind}Field`, { id: artist.id, fieldId: f.id });
  }

  return (
    <section className="card" data-testid={`${kind}-fields`} aria-labelledby={`${kind}-fields-title`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="song-fields-title" className="text-lg font-bold">{c.title}</h2><p className="s">{c.blurb}</p></div>
        {!adding && <button type="button" className="btn ghost" data-testid={`add-${kind}-field`} onClick={() => setAdding(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg> New field</button>}
      </div>
      <ErrorBox error={error} />
      {adding && (
        <form className="cfg-form" data-testid={`new-${kind}-field`} onSubmit={(e) => { e.preventDefault(); if (label.trim()) void add(); }}
          onKeyDown={(e) => { if (e.key === "Escape") { setAdding(false); setLabel(""); setDesc(""); } }}>
          <h3>New field</h3>
          <input className="input" autoFocus placeholder={`e.g. ${c.eg}`} aria-label="Field name" value={label} onChange={(e) => setLabel(e.target.value)} data-testid={`new-${kind}-field-label`} />
          <input className="input" placeholder="What it holds (optional)" aria-label="Description" value={desc} onChange={(e) => setDesc(e.target.value)} data-testid={`new-${kind}-field-description`} />
          <div className="cfg-actions">
            <button type="button" className="btn text" onClick={() => { setAdding(false); setLabel(""); setDesc(""); }}>Cancel</button>
            <button className="btn acc" disabled={busy || !label.trim()} data-testid={`new-${kind}-field-add`}>Create field</button>
          </div>
        </form>
      )}
      {editId && (
        <form className="cfg-form" data-testid={`edit-${kind}-field`} onSubmit={(e) => { e.preventDefault(); if (name.trim()) void rename(); }}
          onKeyDown={(e) => { if (e.key === "Escape") setEditId(null); }}>
          <h3>Rename field</h3>
          <input className="input" autoFocus aria-label="Field name" value={name} onChange={(e) => setName(e.target.value)} data-testid={`edit-${kind}-field-label`} />
          <div className="cfg-actions">
            <button type="button" className="btn text" onClick={() => setEditId(null)}>Cancel</button>
            <button className="btn acc" disabled={busy || !name.trim()} data-testid={`edit-${kind}-field-done`}>Done</button>
          </div>
        </form>
      )}
      {fields.length === 0 ? <p className="s text-center" data-testid={`${kind}-fields-empty`}>No {kind} fields yet.</p> : (
        <div className="cfg-scroll"><table className="cfg-table">
          <thead><tr><th className="act"><span className="sr-only">Reorder</span></th><th>Field</th><th>Description</th>{kind === "song" && <th title={SETLIST_LABEL_HINT}>Setlist label</th>}<th>{Kind}s with a value</th><th title={TABLE_HINT[kind]}>In table</th>{kind === "song" && <th title={SETLISTS_HINT}>In setlists</th>}<th className="act"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{fields.map((f, i) => (
            <tr key={f.id} data-testid={`${kind}-field-${f.id}`} data-editing={editId === f.id ? "1" : undefined} {...dr.row(i)}>
              <td className="act"><span className="flex w-6 cursor-grab select-none justify-center text-muted" {...dr.handle(i)} aria-hidden="true"><Grip /></span></td>
              <td className="nm">{f.label}</td>
              <td><InlineValue testid={`${kind}-field-desc-${f.id}`} label={`${f.label} description`} kind="text" value={f.description ?? ""} emptyLabel="Add a description…" canEdit
                onSave={(v) => saveDescription(f, v)} error={error} /></td>
              {kind === "song" && <td><InlineValue testid={`song-field-setlist-label-${f.id}`} label={`${f.label} setlist label`} kind="text" value={f.setlistLabel ?? ""} emptyLabel="Same as field" canEdit
                onSave={(v) => saveSetlistLabel(f, v)} error={error} /></td>}
              <td>{usedOn(f)}</td>
              <td>
                <input type="checkbox" className="h-4 w-4" aria-label={`Show ${f.label} in the ${Kind}s table`} title={TABLE_HINT[kind]} data-testid={`${kind}-field-in-table-${f.id}`}
                  checked={isOn(f, "inTable")} onChange={(e) => void tick(f, "inTable", e.target.checked)} />
              </td>
              {kind === "song" && <td>
                <input type="checkbox" className="h-4 w-4" aria-label={`Offer ${f.label} when printing setlists`} title={SETLISTS_HINT} data-testid={`song-field-in-setlists-${f.id}`}
                  checked={isOn(f, "inSetlists")} onChange={(e) => void tick(f, "inSetlists", e.target.checked)} />
              </td>}
              <td className="act">
                <button type="button" className="icon-btn" aria-label={`Rename ${f.label}`} data-testid={`${kind}-field-edit-${f.id}`} onClick={() => { setName(f.label); setEditId(f.id); }}>{Icons.edit}</button>
                <button type="button" className="icon-btn danger" aria-label={`Delete ${f.label}`} data-testid={`${kind}-field-remove-${f.id}`} disabled={busy} onClick={() => void remove(f)}>{Icons.trash}</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
