"use client";
import { useEffect, useRef, useState } from "react";
import type { ChecklistLike } from "@/lib/shows";
import { Menu } from "@/components/Menu";
import { ErrorBox, useCommand } from "@/components/ui";
import { toast } from "@/components/Toasts";
import { confetti } from "@/components/Celebrate";
import { useBand } from "../common";
import type { ChecklistHost } from "./ChecklistSidebar";
import { ChecklistItem } from "./ChecklistItem";
import { AssigneeSelect, activePeople } from "./shared";

export interface ChecklistCardProps {
  host: ChecklistHost;
  list: ChecklistLike;
  admin: boolean;
  /** list.templateId points at a live template of this artist ("Update template"); otherwise "Save as template". */
  templateLive: boolean;
  /** Focus this list's "Add a to-do…" field once it is on screen (a blank list was just added). */
  autoFocusAdd?: boolean;
}

export function ChecklistCard({ host, list, admin, templateLive, autoFocusAdd }: ChecklistCardProps) {
  const { musicians } = useBand();
  const people = activePeople(musicians);
  const { call, busy, error } = useCommand();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(list.name);
  const [text, setText] = useState("");
  const [owner, setOwner] = useState("");
  const [saved, setSaved] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  const base = { kind: host.kind, id: host.id, listId: list.id };
  const done = list.items.filter((i) => i.done).length;
  // Every item ticked: the list folds shut to its title and count; the chevron opens it again.
  // It folds again each time it becomes complete (ticking the last item shuts it).
  const complete = list.items.length > 0 && done === list.items.length;
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (!complete) setExpanded(false); }, [complete]);
  const shut = complete && !expanded && !renaming;

  useEffect(() => { if (autoFocusAdd) addRef.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (renaming) renameRef.current?.select(); }, [renaming]);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  function startRename() { settled.current = false; setName(list.name); setRenaming(true); }
  async function finishRename(save: boolean) {
    if (settled.current) return;
    settled.current = true;
    setRenaming(false);
    const next = name.trim();
    if (save && next && next !== list.name) await call("checklists.rename", { ...base, name: next });
  }
  async function remove() {
    if (!confirm(`Delete the list "${list.name}"?`)) return;
    await call("checklists.remove", base);
  }
  async function template() {
    if (templateLive && !confirm(`Replace the "${list.name}" template with this list? Lists already made from it don't change.`)) return;
    const r = await call(templateLive ? "checklists.updateTemplate" : "checklists.saveAsTemplate", base);
    if (r) setSaved(true);
  }
  async function pin(itemId: string, pinned: boolean) {
    if (await call("checklists.pin", { ...base, itemId, pinned })) toast({ key: `pin:${itemId}`, text: pinned ? "Pinned to To Dos" : "Unpinned from To Dos" });
  }
  async function add() {
    const label = text.trim();
    if (!label) return;
    setText("");
    const r = await call("checklists.addItem", { ...base, label, ownerId: owner || null });
    if (!r) setText(label);
    addRef.current?.focus();
  }

  return (
    <section className="card @container" data-testid={`checklist-${list.id}`}>
      <div className="card-head">
        {renaming ? (
          <input ref={renameRef} className="input" aria-label="List name" value={name} autoFocus data-testid={`checklist-rename-${list.id}`}
            onChange={(e) => setName(e.target.value)} onBlur={() => void finishRename(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void finishRename(true); }
              else if (e.key === "Escape") { e.stopPropagation(); void finishRename(false); }
            }} />
        ) : (
          <div className="flex min-w-0 items-center gap-1">
            {complete && <button type="button" className="icon-btn shrink-0" aria-expanded={!shut} aria-label={`${shut ? "Show" : "Hide"} ${list.name}`}
              onClick={() => setExpanded(shut)} data-testid={`checklist-fold-${list.id}`}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                style={{ transform: shut ? "rotate(-90deg)" : undefined }}><path d="M3.5 6 8 10.5 12.5 6" /></svg>
            </button>}
            <h3 className="min-w-0 break-words text-[1.125rem] font-bold" data-testid={`checklist-title-${list.id}`}>{list.name}</h3>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2">
          <span className="s" data-testid={`checklist-count-${list.id}`}>{done} of {list.items.length}</span>
          {admin && (
            <>
              <button type="button" className="card-edit !px-0 !text-[0.875rem]" disabled={busy} onClick={() => void template()}
                data-testid={`checklist-${templateLive ? "update" : "save"}-template-${list.id}`}>
                {saved ? "Saved" : templateLive ? "Update template" : "Save as template"}
              </button>
              <Menu label={`Actions for ${list.name}`} testid={`checklist-${list.id}`} items={[
                { key: "rename", label: "Rename", onSelect: startRename },
                { key: "delete", label: "Delete list", danger: true, onSelect: () => void remove() },
              ]} />
            </>
          )}
        </div>
      </div>
      {!shut && <>
      {list.items.length === 0 ? <p className="s">Nothing on this list yet.</p> : (
        <ul className="flex flex-col">
          {list.items.map((i) => (
            <li key={i.id}>
              <ChecklistItem item={i} people={people} musicians={musicians} busy={busy}
                onToggle={(d) => { if (d) confetti(); void call("checklists.check", { ...base, itemId: i.id, done: d }); }}
                onSave={(n) => void call("checklists.editItem", { ...base, itemId: i.id, label: n.label, ownerId: n.ownerId })}
                onRemove={() => void call("checklists.removeItem", { ...base, itemId: i.id })}
                onPin={admin ? (p) => void pin(i.id, p) : undefined} />
            </li>
          ))}
        </ul>
      )}
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input ref={addRef} className="input basis-full @md:grow @md:basis-0" placeholder="Add a to-do…" aria-label={`New to-do for ${list.name}`}
          value={text} onChange={(e) => setText(e.target.value)} data-testid={`checklist-add-${list.id}`} />
        <AssigneeSelect className="!w-auto grow @md:grow-0" value={owner} onChange={setOwner} people={people} musicians={musicians}
          testid={`checklist-add-owner-${list.id}`} />
        <button type="submit" className="btn ghost" disabled={!text.trim() || busy} data-testid={`checklist-add-btn-${list.id}`}>Add</button>
      </form>
      </>}
      <ErrorBox error={error} />
    </section>
  );
}
