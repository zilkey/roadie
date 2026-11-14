"use client";
import { useEffect, useRef, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { Menu, type MenuItem } from "@/components/Menu";
import { SaveStatus } from "@/components/SaveStatus";
import { useAutosave } from "@/lib/autosave";
import { useDragReorder } from "@/lib/drag-reorder";
import { templateKind, type ChecklistKind } from "@/lib/shows";
import { TEMPLATE_TYPE, TEMPLATE_WHEN, type TemplateType, type TemplateWhen } from "@/schema";
import { moved, useChecklistTemplates, type TemplateRow } from "./shared";

/** The three tabs of Artist settings › Checklist templates, in order: [kind, tab label, the word in "New … template" and "Move to …"]. */
export const TEMPLATE_KINDS: [ChecklistKind, string, string][] = [["show", "Shows", "show"], ["release", "Releases", "release"], ["social", "Social media", "social media"]];
export const isTemplateKind = (v: string | null | undefined): v is ChecklistKind => TEMPLATE_KINDS.some(([k]) => k === v);

export interface ChecklistTemplatesEditorProps {
  /** The artist whose templates these are (the page is admin-only). */
  artistId: string;
  /** The tab on show: only templates of this kind are listed, and new ones get it. */
  kind: ChecklistKind;
  onKind(kind: ChecklistKind): void;
  /** The "+ New" menu (top right of the page) picked a kind: open the name form on that tab. Cleared by onAdding(false). */
  adding: boolean;
  onAdding(on: boolean): void;
}

/** "+ New" for the page header: a menu of the three kinds. Picking one switches to its tab and opens the name form there. */
export function NewTemplateMenu({ onPick }: { onPick(kind: ChecklistKind): void }) {
  return (
    <Menu label="New template" testid="new-template" trigger={<>+ New</>} triggerClass="btn acc"
      items={TEMPLATE_KINDS.map(([k, , word]) => ({ key: k, label: `${word[0].toUpperCase()}${word.slice(1)} template`, onSelect: () => onPick(k) }))} />
  );
}

interface Item { key: string; id?: string; label: string }
const fromDoc = (t: TemplateRow): Item[] => t.items.map((c) => ({ key: c.id, id: c.id, label: c.label }));
const tempKey = () => `new-${Math.random().toString(36).slice(2)}`;

/**
 * The global order after dragging within one tab: the other kinds' templates keep their slots, and this tab's slots take
 * its new order. checklistTemplates.reorder wants every template id once.
 */
export function reorderWithinKind(all: readonly { id: string; appliesTo?: ChecklistKind }[], kind: ChecklistKind, from: number, to: number): string[] {
  const queue = moved(all.filter((t) => templateKind(t) === kind).map((t) => t.id), from, to);
  return all.map((t) => (templateKind(t) === kind ? queue.shift()! : t.id));
}

const Grip = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
  </svg>
);
const Chevron = ({ open }: { open: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={open ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6"} />
  </svg>
);
const handle = "flex w-6 shrink-0 cursor-grab select-none justify-center text-muted";

export function ChecklistTemplatesEditor({ artistId, kind, onKind, adding, onAdding: setAdding }: ChecklistTemplatesEditorProps) {
  const { templates: all } = useChecklistTemplates(artistId, true);
  const { call, error } = useCommand();
  const [newName, setNewName] = useState("");
  // Cards open by the user, plus the one just made. The first card of a tab starts open.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const templates = all.filter((t) => templateKind(t) === kind);
  const word = TEMPLATE_KINDS.find(([k]) => k === kind)![2];

  const dr = useDragReorder((from, to) => void call("checklistTemplates.reorder", { ids: reorderWithinKind(all, kind, from, to) }));
  async function add() {
    const r = await call<{ id: string }>("checklistTemplates.create", { name: newName.trim(), appliesTo: kind, items: [] });
    if (r) { setNewName(""); setAdding(false); if (r.id) setOpen((o) => ({ ...o, [r.id]: true })); }
  }
  async function remove(t: TemplateRow) {
    if (confirm(`Delete the "${t.name}" template? Lists already made from it stay.`)) await call("checklistTemplates.remove", { id: t.id });
  }
  const move = (t: TemplateRow, to: ChecklistKind) => void call("checklistTemplates.update", { id: t.id, patch: { appliesTo: to } });
  const cancelAdd = () => { setAdding(false); setNewName(""); };

  return (
    <div className="grid gap-4" data-testid="checklist-templates">
      <div className="tabs" role="tablist" aria-label="Template type" data-testid="template-tabs">
        {TEMPLATE_KINDS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={k === kind} data-testid={`template-tab-${k}`}
            onClick={() => { cancelAdd(); onKind(k); }}>{label} ({all.filter((t) => templateKind(t) === k).length})</button>
        ))}
      </div>
      <ErrorBox error={error} />
      {templates.length === 0 && !adding && <p className="s" data-testid="templates-empty">No {word} templates yet.</p>}
      {templates.length > 0 && (
        <ul className="m-0 grid list-none gap-2.5 p-0" data-testid="template-list">
          {templates.map((t, i) => (
            <TemplateCard key={t.id} t={t} row={dr.row(i)} handle={dr.handle(i)}
              showFields={kind === "show"} firstPromotion={kind === "show" && t.type === "promotion" && templates.find((x) => x.type === "promotion")?.id === t.id}
              open={open[t.id] ?? i === 0} onToggle={() => setOpen((o) => ({ ...o, [t.id]: !(o[t.id] ?? i === 0) }))}
              moves={TEMPLATE_KINDS.filter(([k]) => k !== kind).map(([k, label]) => ({ key: k, label: `Move to ${label}`, onSelect: () => move(t, k) }))}
              onRemove={() => void remove(t)} />
          ))}
        </ul>
      )}
      {adding ? (
        <form className="cfg-form" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) void add(); }}
          onKeyDown={(e) => { if (e.key === "Escape") cancelAdd(); }}>
          <h3>New {word} template</h3>
          <input className="input" autoFocus placeholder="Template name" aria-label="Template name" value={newName} onChange={(e) => setNewName(e.target.value)} data-testid="new-template-name" />
          <div className="cfg-actions">
            <button type="button" className="btn text" onClick={cancelAdd}>Cancel</button>
            <button type="submit" className="btn acc" disabled={!newName.trim()} data-testid="new-template-add">Add template</button>
          </div>
        </form>
      ) : (
        null
      )}
    </div>
  );
}

type Drag = ReturnType<typeof useDragReorder>;

function TemplateCard({ t, row, handle: grip, open, onToggle, moves, onRemove, showFields, firstPromotion }: {
  t: TemplateRow; row: ReturnType<Drag["row"]>; handle: ReturnType<Drag["handle"]>;
  open: boolean; onToggle(): void; moves: MenuItem[]; onRemove(): void;
  /** Show templates have When and Type. */
  showFields: boolean;
  /** The first Promotion template: confirmed venue shows also get "Add to Bandsintown" on its list. */
  firstPromotion: boolean;
}) {
  const fields = useCommand();
  const setField = (k: "when" | "type", v: string) => void fields.call("checklistTemplates.update", { id: t.id, patch: { [k]: v || null } });
  const [name, setName] = useState(t.name);
  const [renaming, setRenaming] = useState(false);
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
  const doneRenaming = () => { if (name.trim()) { setRenaming(false); void as.flush(); } };
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
  const count = items.filter((c) => c.label.trim()).length;

  return (
    <li className="card !gap-0 !px-2.5 !py-1.5" data-testid={`template-${t.id}`} onBlur={() => void as.flush()} {...row}>
      <div className="flex min-h-12 items-center gap-2">
        <span className={handle} {...grip} aria-hidden="true"><Grip /></span>
        <button type="button" className="icon-btn !h-8 !w-8" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${t.name}`} onClick={onToggle} data-testid={`template-toggle-${t.id}`}>
          <Chevron open={open} />
        </button>
        {renaming ? (
          <input className="min-h-9 min-w-0 flex-1 border border-transparent border-b-line bg-transparent px-0.5 py-1 text-base font-extrabold outline-none focus:border-b-accent"
            autoFocus value={name} onChange={(e) => editName(e.target.value)} aria-label="Template name" data-testid={`template-name-${t.id}`}
            onBlur={doneRenaming} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); doneRenaming(); } }} />
        ) : (
          <button type="button" className="min-h-9 min-w-0 cursor-text truncate rounded-lg border-0 bg-transparent px-1 text-left text-base font-extrabold text-ink hover:bg-soft"
            aria-label={`Rename ${t.name}`} onClick={() => setRenaming(true)} data-testid={`template-title-${t.id}`}>{name}</button>
        )}
        {showFields && t.when && <span className="chip" data-testid={`template-when-tag-${t.id}`}>{TEMPLATE_WHEN[t.when]}</span>}
        {showFields && t.type && <span className="chip" data-testid={`template-type-tag-${t.id}`}>{TEMPLATE_TYPE[t.type]}</span>}
        <span className="flex-1" />
        <SaveStatus {...as.statusProps} />
        <span className="s shrink-0" data-testid={`template-count-${t.id}`}>{count} {count === 1 ? "item" : "items"}</span>
        <Menu label={`${t.name} menu`} testid={`template-${t.id}`} items={[
          { key: "rename", label: "Rename", onSelect: () => { if (!open) onToggle(); setRenaming(true); } },
          ...moves,
          { key: "delete", label: "Delete", danger: true, divider: true, onSelect: onRemove },
        ]} />
      </div>
      {open && (
        <div className="grid gap-1.5 border-t border-line pb-2 pl-10 pt-2.5">
          {showFields && (
            <div className="mb-1.5 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2"><span className="lbl">When</span>
                <select className="select !w-auto" value={t.when ?? ""} onChange={(e) => setField("when", e.target.value)} data-testid={`template-when-${t.id}`}>
                  <option value="">—</option>
                  {(Object.entries(TEMPLATE_WHEN) as [TemplateWhen, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></label>
              <label className="flex items-center gap-2"><span className="lbl">Type</span>
                <select className="select !w-auto" value={t.type ?? ""} onChange={(e) => setField("type", e.target.value)} data-testid={`template-type-${t.id}`}>
                  <option value="">—</option>
                  {(Object.entries(TEMPLATE_TYPE) as [TemplateType, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></label>
              <ErrorBox error={fields.error} />
            </div>
          )}
          {items.map((c, i) => (
            <div key={c.key} className="flex items-center gap-2" {...dr.row(i)}>
              <span className={handle} {...dr.handle(i)} aria-hidden="true"><Grip /></span>
              <input className="input min-w-0 flex-1" value={c.label} onChange={(e) => setLabel(i, e.target.value)} aria-label="Item" data-testid={`template-item-${t.id}-${i}`} />
              <button type="button" className="icon-btn" onClick={() => editItems(items.filter((_, j) => j !== i))} aria-label={`Remove ${c.label || "item"}`} data-testid={`template-item-remove-${t.id}-${i}`}>×</button>
            </div>
          ))}
          {firstPromotion && (
            <div className="flex items-center gap-2" data-testid={`template-bandsintown-${t.id}`}>
              <span className="w-6 shrink-0" />
              <span className="s">+ Add to Bandsintown — added automatically on confirmed venue shows</span>
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-2">
            <input ref={addRef} className="input min-w-0 flex-1" placeholder="Add an item" aria-label={`Add an item to ${t.name}`} value={fresh}
              onChange={(e) => setFresh(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }} data-testid={`template-add-item-${t.id}`} />
            <button type="button" className="btn ghost" disabled={!fresh.trim()} onClick={addItem} data-testid={`template-add-item-btn-${t.id}`}>Add</button>
          </div>
        </div>
      )}
    </li>
  );
}
