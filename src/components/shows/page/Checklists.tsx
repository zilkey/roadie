"use client";
import { useEffect, useRef, useState } from "react";
import { useProfile } from "@/lib/auth";
import { checklistsOf, type ChecklistLike } from "@/lib/shows";
import { useCommand } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { nameOf, useBand, type ShowRow } from "../common";
import { EditableCard, ShowCard, UnfinishedPlaceholder, useCardEdit } from "./kit";

interface DraftItem { key: string; id?: string; label: string; done: boolean; ownerId?: string; due?: string }
interface DraftList { key: string; id?: string; name: string; items: DraftItem[]; adding: string; addOwner: string }

const uid = () => Math.random().toString(36).slice(2, 10);
const draftOf = (lists: ChecklistLike[]): DraftList[] => lists.map((l) => ({
  key: l.id, id: l.id, name: l.name, adding: "", addOwner: "",
  items: l.items.map((i) => ({ key: i.id, id: i.id, label: i.label, done: i.done, ownerId: i.ownerId, due: i.due })),
}));
const isGear = (name: string) => name.trim().toLowerCase() === "gear";

/** Prep tab: every checklist on the show, + New checklist. */
export function Checklists({ show, admin }: { show: ShowRow; admin: boolean }) {
  const { musicians } = useBand();
  const p = useProfile();
  const cmd = useCommand();
  const lists = checklistsOf(show);
  const [draft, setDraft] = useState<DraftList[]>([]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const nameRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const addRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const ed = useCardEdit({ canEdit: admin, onStart: () => setDraft(draftOf(checklistsOf(show))) });
  const people = musicians.filter((m) => m.active && !m.archivedAt);

  useEffect(() => {
    if (focusKey && nameRefs.current[focusKey]) { nameRefs.current[focusKey]!.focus(); nameRefs.current[focusKey]!.select(); setFocusKey(null); }
  }, [focusKey, draft]);

  const setList = (key: string, f: (l: DraftList) => DraftList) => setDraft((d) => d.map((l) => (l.key === key ? f(l) : l)));
  const setItem = (lk: string, ik: string, patch: Partial<DraftItem>) => setList(lk, (l) => ({ ...l, items: l.items.map((i) => (i.key === ik ? { ...i, ...patch } : i)) }));
  function addItem(lk: string) {
    setList(lk, (l) => {
      const label = l.adding.trim();
      if (!label) return l;
      return { ...l, adding: "", items: [...l.items, { key: uid(), label, done: false, ownerId: l.addOwner || undefined }] };
    });
    addRefs.current[lk]?.focus();
  }
  function newList() {
    const key = uid();
    setDraft((d) => [...d, { key, name: "New list", items: [], adding: "", addOwner: "" }]);
    setFocusKey(key);
  }
  function startWithNew() {
    ed.start();
    const key = uid();
    setDraft([...draftOf(lists), { key, name: "New list", items: [], adding: "", addOwner: "" }]);
    setFocusKey(key);
  }

  async function save() {
    const checklists = draft.map((l) => {
      const items = l.items.map((i) => ({ ...i, label: i.label.trim() }));
      const pending = l.adding.trim();
      if (pending) items.push({ key: "", label: pending, done: false, ownerId: l.addOwner || undefined, due: undefined, id: undefined });
      return {
        ...(l.id ? { id: l.id } : {}), name: l.name.trim() || "New list",
        items: items.filter((i) => i.label).map((i) => ({
          ...(i.id ? { id: i.id } : {}), label: i.label, done: i.done,
          ...(i.ownerId ? { ownerId: i.ownerId } : {}), ...(i.due ? { due: i.due } : {}),
        })),
      };
    });
    return !!(await cmd.call("shows.setChecklists", { id: show.id, checklists }));
  }

  const canTick = (ownerId?: string) => admin || (!!p.musicianId && ownerId === p.musicianId);
  const tick = (listId: string, itemId: string, done: boolean) => void cmd.call("shows.checkItem", { id: show.id, listId, itemId, done });

  if (ed.editing) {
    return (
      <EditableCard title="Checklists" testid="checklists" ed={ed} onSave={save} busy={cmd.busy} error={cmd.error}>
        <div className="flex flex-col gap-4">
          {draft.map((l, li) => {
            const who = (value: string, onChange: (v: string) => void, label: string, testid: string) => (
              <select className="select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
                <option value="">Anyone</option>
                {people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                {value && !people.some((m) => m.id === value) && <option value={value}>{nameOf(musicians, value)}</option>}
              </select>
            );
            const whoLabel = isGear(l.name) ? "Who brings it" : "Who";
            return (
              <div key={l.key} className="flex flex-col gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border)" }} data-testid={`checklist-edit-${li}`}>
                <div className="flex items-center gap-2">
                  <input ref={(el) => { nameRefs.current[l.key] = el; }} className="input grow" aria-label="List name" value={l.name} onChange={(e) => setList(l.key, (x) => ({ ...x, name: e.target.value }))} data-testid={`checklist-name-${li}`} />
                  <Menu label="List options" testid={`checklist-${li}`} items={[{ key: "delete", label: "Delete list", danger: true, onSelect: () => setDraft((d) => d.filter((x) => x.key !== l.key)) }]} />
                </div>
                {l.items.map((i, ii) => (
                  <div key={i.key} className="flex flex-wrap items-center gap-2" data-testid={`checklist-item-${li}-${ii}`}>
                    <input type="checkbox" className="h-[18px] w-[18px]" aria-label={isGear(l.name) ? "Packed" : "Done"} checked={i.done} onChange={(e) => setItem(l.key, i.key, { done: e.target.checked })} />
                    <input className="input grow basis-48" aria-label="Item" value={i.label} onChange={(e) => setItem(l.key, i.key, { label: e.target.value })} />
                    {who(i.ownerId ?? "", (v) => setItem(l.key, i.key, { ownerId: v || undefined }), whoLabel, `checklist-who-${li}-${ii}`)}
                    <button type="button" className="icon-btn" aria-label="Remove item" onClick={() => setList(l.key, (x) => ({ ...x, items: x.items.filter((y) => y.key !== i.key) }))}>×</button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <input ref={(el) => { addRefs.current[l.key] = el; }} className="input grow basis-48" aria-label="New item" placeholder={isGear(l.name) ? "Add gear…" : "Add an item… (Enter to add another)"} value={l.adding}
                    onChange={(e) => setList(l.key, (x) => ({ ...x, adding: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(l.key); } }} data-testid={`checklist-add-${li}`} />
                  {who(l.addOwner, (v) => setList(l.key, (x) => ({ ...x, addOwner: v })), whoLabel, `checklist-add-who-${li}`)}
                </div>
              </div>
            );
          })}
          <div><button type="button" className="btn ghost" onClick={newList} data-testid="checklist-new-list">+ New list</button></div>
        </div>
      </EditableCard>
    );
  }

  if (!lists.length) {
    return (
      <ShowCard title="Checklists" testid="checklists">
        <UnfinishedPlaceholder row lead="No checklists yet." testid="checklists-empty"
          actions={admin ? <button type="button" className="btn ghost" onClick={startWithNew} data-testid="checklist-new">New checklist</button> : undefined}>
          Make your own — gear, promo, to-dos, anything.
        </UnfinishedPlaceholder>
      </ShowCard>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="checklists">
      {lists.map((l) => {
        const done = l.items.filter((i) => i.done).length;
        return (
          <ShowCard key={l.id} title={l.name} testid={`checklist-${l.id}`}
            aside={<div className="flex items-center gap-2"><span className="s" data-testid={`checklist-count-${l.id}`}>{done} of {l.items.length}{isGear(l.name) ? " packed" : ""}</span>
              {admin && <button type="button" className="card-edit" onClick={ed.start}>Edit</button>}</div>}>
            {l.items.length === 0 ? <p className="s">Nothing on this list yet.</p> : (
              <ul className="flex flex-col">
                {l.items.map((i) => {
                  const ok = canTick(i.ownerId);
                  return (
                    <li key={i.id} className="flex min-h-11 items-center gap-3" data-testid="checklist-item">
                      <label className="flex min-h-11 grow items-center gap-3">
                        <input type="checkbox" className="h-[18px] w-[18px]" checked={i.done} disabled={!ok || cmd.busy} onChange={(e) => tick(l.id, i.id, e.target.checked)} />
                        <span style={i.done ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>{i.label}</span>
                      </label>
                      <span className="s">{i.ownerId ? nameOf(musicians, i.ownerId) : "Anyone"}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </ShowCard>
        );
      })}
      {cmd.error && <div className="err" role="alert">{cmd.error}</div>}
      {admin && <div><button type="button" className="btn ghost" onClick={startWithNew} data-testid="checklist-new">+ New checklist</button></div>}
    </div>
  );
}
