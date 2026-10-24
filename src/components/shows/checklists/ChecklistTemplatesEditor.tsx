"use client";
import { useEffect, useRef, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { SaveStatus } from "@/components/SaveStatus";
import { useAutosave } from "@/lib/autosave";
import { moved, useChecklistTemplates, type TemplateRow } from "./shared";

export interface ChecklistTemplatesEditorProps {
  /** The artist whose templates these are (the page is admin-only). */
  artistId: string;
}

interface Item { key: string; id?: string; label: string }
const fromDoc = (t: TemplateRow): Item[] => t.items.map((c) => ({ key: c.id, id: c.id, label: c.label }));
const tempKey = () => `new-${Math.random().toString(36).slice(2)}`;

const Grip = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
  </svg>
);
const handle = "flex w-6 shrink-0 cursor-grab select-none justify-center text-muted";

export function ChecklistTemplatesEditor({ artistId }: ChecklistTemplatesEditorProps) {
  const { templates } = useChecklistTemplates(artistId, true);
  const { call, error } = useCommand();
  const [drag, setDrag] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const ids = templates.map((t) => t.id);

  const reorder = (from: number, to: number) => { if (from !== to) void call("checklistTemplates.reorder", { ids: moved(ids, from, to) }); };
  async function add() {
    const r = await call("checklistTemplates.create", { name: newName.trim() });
    if (r) { setNewName(""); setAdding(false); }
  }
  async function remove(t: TemplateRow) {
    if (confirm(`Delete the "${t.name}" template? Lists already on shows stay.`)) await call("checklistTemplates.remove", { id: t.id });
  }

  return (
    <section id="checklist-templates" className="grid gap-4" data-testid="checklist-templates">
      <div>
        <h2 className="text-lg font-bold">Checklist templates</h2>
        <p className="s">These show up as “New list” options on every show. Changing a template doesn&apos;t touch lists already on shows.</p>
      </div>
      <ErrorBox error={error} />
      {templates.map((t, i) => (
        <TemplateCard key={t.id} t={t} index={i} count={templates.length} onRemove={() => void remove(t)} onMove={(to) => reorder(i, to)}
          onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)} onDrop={() => { if (drag != null) reorder(drag, i); setDrag(null); }} />
      ))}
      {adding ? (
        <form className="card flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) void add(); }}
          onKeyDown={(e) => { if (e.key === "Escape") { setAdding(false); setNewName(""); } }}>
          <input className="input min-w-0 flex-1" autoFocus placeholder="Template name" aria-label="Template name" value={newName} onChange={(e) => setNewName(e.target.value)} data-testid="new-template-name" />
          <button type="submit" className="btn acc" disabled={!newName.trim()} data-testid="new-template-add">Add template</button>
          <button type="button" className="btn ghost" onClick={() => { setAdding(false); setNewName(""); }}>Cancel</button>
        </form>
      ) : (
        <div><button type="button" className="btn ghost" onClick={() => setAdding(true)} data-testid="new-template">+ New template</button></div>
      )}
    </section>
  );
}

function TemplateCard({ t, index, count, onRemove, onMove, onDragStart, onDragEnd, onDrop }: {
  t: TemplateRow; index: number; count: number; onRemove(): void; onMove(to: number): void;
  onDragStart(): void; onDragEnd(): void; onDrop(): void;
}) {
  const [name, setName] = useState(t.name);
  const [items, setItems] = useState<Item[]>(() => fromDoc(t));
  const [drag, setDrag] = useState<number | null>(null);
  const [fresh, setFresh] = useState("");
  const addRef = useRef<HTMLInputElement>(null);
  const as = useAutosave({ command: "checklistTemplates.update", id: t.id, rev: t.rev, title: t.name, onUseTheirs: () => { setName(t.name); setItems(fromDoc(t)); } });

  // Follow the live document whenever nothing of ours is waiting to be saved.
  const liveKey = JSON.stringify([t.name, t.items]);
  useEffect(() => { if (!as.isBusy()) { setName(t.name); setItems(fromDoc(t)); } }, [liveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const editName = (v: string) => {
    setName(v);
    if (v.trim()) as.patch({ name: v }); else as.hold("Template name is required");
  };
  const editItems = (next: Item[]) => {
    setItems(next);
    as.patch({ items: next.filter((c) => c.label.trim()).map((c) => ({ ...(c.id ? { id: c.id } : {}), label: c.label })) });
  };
  const setLabel = (i: number, label: string) => editItems(items.map((c, j) => (j === i ? { ...c, label } : c)));
  const addItem = () => {
    const label = fresh.trim();
    if (!label) return;
    setFresh("");
    editItems([...items, { key: tempKey(), label }]);
    addRef.current?.focus();
  };
  const dnd = (e: React.DragEvent) => e.dataTransfer.setData("text/plain", "");

  return (
    <div className="card grid gap-2" data-testid={`template-${t.id}`} onBlur={() => void as.flush()} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="flex items-center gap-2">
        <span className={handle} draggable onDragStart={(e) => { dnd(e); onDragStart(); }} onDragEnd={onDragEnd} aria-hidden="true"><Grip /></span>
        <input className="min-h-11 min-w-0 flex-1 border border-transparent border-b-line bg-transparent px-0.5 py-1.5 text-lg font-bold outline-none focus:border-b-accent"
          value={name} onChange={(e) => editName(e.target.value)} aria-label="Template name" data-testid={`template-name-${t.id}`} />
        <button type="button" className="icon-btn" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Move ${t.name} up`} data-testid={`template-up-${t.id}`}>↑</button>
        <button type="button" className="icon-btn" disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label={`Move ${t.name} down`} data-testid={`template-down-${t.id}`}>↓</button>
        <button type="button" className="btn outline danger" onClick={onRemove} data-testid={`template-delete-${t.id}`}>Delete</button>
      </div>
      <SaveStatus {...as.statusProps} />
      {items.map((c, i) => (
        <div key={c.key} className="flex items-center gap-2" onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { if (drag == null) return; e.stopPropagation(); if (drag !== i) editItems(moved(items, drag, i)); setDrag(null); }}>
          <span className={handle} draggable onDragStart={(e) => { dnd(e); setDrag(i); }} onDragEnd={() => setDrag(null)} aria-hidden="true">⋮⋮</span>
          <input className="input min-w-0 flex-1" value={c.label} onChange={(e) => setLabel(i, e.target.value)} aria-label="Item" data-testid={`template-item-${t.id}-${i}`} />
          <button type="button" className="icon-btn" disabled={i === 0} onClick={() => editItems(moved(items, i, i - 1))} aria-label={`Move ${c.label || "item"} up`} data-testid={`template-item-up-${t.id}-${i}`}>↑</button>
          <button type="button" className="icon-btn" disabled={i === items.length - 1} onClick={() => editItems(moved(items, i, i + 1))} aria-label={`Move ${c.label || "item"} down`} data-testid={`template-item-down-${t.id}-${i}`}>↓</button>
          <button type="button" className="icon-btn" onClick={() => editItems(items.filter((_, j) => j !== i))} aria-label="Remove item" data-testid={`template-item-remove-${t.id}-${i}`}>×</button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0" />
        <input ref={addRef} className="input min-w-0 flex-1" placeholder="Add an item… (Enter to add another)" aria-label="New item" value={fresh}
          onChange={(e) => setFresh(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }} data-testid={`template-add-item-${t.id}`} />
      </div>
    </div>
  );
}
