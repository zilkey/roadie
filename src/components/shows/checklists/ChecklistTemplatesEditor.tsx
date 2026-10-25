"use client";
import { useEffect, useRef, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { Icons } from "@/components/people/shared";
import { SaveStatus } from "@/components/SaveStatus";
import { useAutosave } from "@/lib/autosave";
import { useDragReorder } from "@/lib/drag-reorder";
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
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const ids = templates.map((t) => t.id);

  const dr = useDragReorder((from, to) => void call("checklistTemplates.reorder", { ids: moved(ids, from, to) }));
  async function add() {
    const r = await call("checklistTemplates.create", { name: newName.trim() });
    if (r) { setNewName(""); setAdding(false); }
  }
  async function remove(t: TemplateRow) {
    if (confirm(`Delete the "${t.name}" template? Lists already on shows stay.`)) await call("checklistTemplates.remove", { id: t.id });
  }

  return (
    <section id="checklist-templates" className="card" data-testid="checklist-templates" aria-labelledby="tpl-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="tpl-title" className="text-lg font-bold">Checklist templates</h2>
          <p className="s">These show up as “New list” options on every show. Changing a template doesn&apos;t touch lists already on shows.</p>
        </div>
        {!adding && <button type="button" className="btn ghost" onClick={() => setAdding(true)} data-testid="new-template">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg> New template</button>}
      </div>
      <ErrorBox error={error} />
      {adding && (
        <form className="cfg-form" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) void add(); }}
          onKeyDown={(e) => { if (e.key === "Escape") { setAdding(false); setNewName(""); } }}>
          <h3>New template</h3>
          <input className="input" autoFocus placeholder="Template name" aria-label="Template name" value={newName} onChange={(e) => setNewName(e.target.value)} data-testid="new-template-name" />
          <div className="cfg-actions">
            <button type="button" className="btn text" onClick={() => { setAdding(false); setNewName(""); }}>Cancel</button>
            <button type="submit" className="btn acc" disabled={!newName.trim()} data-testid="new-template-add">Add template</button>
          </div>
        </form>
      )}
      {templates.length === 0 && !adding && <p className="s text-center">No templates yet.</p>}
      {templates.map((t, i) => (
        <TemplateCard key={t.id} t={t} onRemove={() => void remove(t)} row={dr.row(i)} handle={dr.handle(i)} />
      ))}
    </section>
  );
}

type Drag = ReturnType<typeof useDragReorder>;

function TemplateCard({ t, onRemove, row, handle: grip }: {
  t: TemplateRow; onRemove(): void; row: ReturnType<Drag["row"]>; handle: ReturnType<Drag["handle"]>;
}) {
  const [name, setName] = useState(t.name);
  const [items, setItems] = useState<Item[]>(() => fromDoc(t));
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
  const dr = useDragReorder((from, to) => editItems(moved(items, from, to)));

  return (
    <div className="grid gap-2 border-t border-line pt-4" data-testid={`template-${t.id}`} onBlur={() => void as.flush()} {...row}>
      <div className="flex items-center gap-2">
        <span className={handle} {...grip} aria-hidden="true"><Grip /></span>
        <input className="min-h-11 min-w-0 flex-1 border border-transparent border-b-line bg-transparent px-0.5 py-1.5 text-lg font-bold outline-none focus:border-b-accent"
          value={name} onChange={(e) => editName(e.target.value)} aria-label="Template name" data-testid={`template-name-${t.id}`} />
        <button type="button" className="icon-btn danger" aria-label={`Delete ${t.name}`} onClick={onRemove} data-testid={`template-delete-${t.id}`}>{Icons.trash}</button>
      </div>
      <SaveStatus {...as.statusProps} />
      {items.map((c, i) => (
        <div key={c.key} className="flex items-center gap-2 pl-8" {...dr.row(i)}>
          <span className={handle} {...dr.handle(i)} aria-hidden="true">⋮⋮</span>
          <input className="input min-w-0 flex-1" value={c.label} onChange={(e) => setLabel(i, e.target.value)} aria-label="Item" data-testid={`template-item-${t.id}-${i}`} />
          <button type="button" className="icon-btn" onClick={() => editItems(items.filter((_, j) => j !== i))} aria-label="Remove item" data-testid={`template-item-remove-${t.id}-${i}`}>×</button>
        </div>
      ))}
      <div className="flex items-center gap-2 pl-8">
        <span className="w-6 shrink-0" />
        <input ref={addRef} className="input min-w-0 flex-1" placeholder="Add an item… (Enter to add another)" aria-label="New item" value={fresh}
          onChange={(e) => setFresh(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }} data-testid={`template-add-item-${t.id}`} />
        <span className="w-11 shrink-0" aria-hidden="true" />
      </div>
    </div>
  );
}
