"use client";
import { useState } from "react";
import Link from "@/lib/artist";
import { ErrorBox, useCommand } from "@/components/ui";
import { checklistCount, checklistsOf } from "@/lib/shows";
import type { ShowRow } from "../common";
import { Menu } from "@/components/Menu";
import { UnfinishedPlaceholder } from "../page/kit";
import { ChecklistCard } from "./ChecklistCard";
import { useDragReorder } from "@/lib/drag-reorder";
import { moved, useChecklistTemplates } from "./shared";

export interface ChecklistSidebarProps {
  show: ShowRow;
  admin: boolean;
}

const Chevron = ({ up }: { up?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={up ? "M3.5 10 8 5.5 12.5 10" : "M3.5 6 8 10.5 12.5 6"} />
  </svg>
);

export function ChecklistSidebar({ show, admin }: ChecklistSidebarProps) {
  const lists = checklistsOf(show);
  const { templates } = useChecklistTemplates(show.artistId, admin);
  const { call, busy, error, setError } = useCommand();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [freshId, setFreshId] = useState<string>();
  const [draft, setDraft] = useState<string[] | null>(null);
  const liveTemplates = new Set(templates.map((t) => t.id));
  const { done, total } = checklistCount(lists);
  // While reordering: the draft order, dropping lists since deleted and appending ones since added.
  const byId = new Map(lists.map((l) => [l.id, l]));
  const order = (draft ?? []).filter((id) => byId.has(id));
  if (draft) for (const l of lists) if (!order.includes(l.id)) order.push(l.id);
  const dr = useDragReorder((from, to) => setDraft(moved(order, from, to)));

  async function addTemplate(templateId: string) {
    await call("shows.addChecklist", { id: show.id, templateId });
  }
  async function addBlank() {
    const n = name.trim();
    if (!n) return;
    const r = await call<{ id: string; listId: string }>("shows.addChecklist", { id: show.id, name: n });
    if (!r) return;
    setFreshId(r.listId);
    setName("");
    setNaming(false);
  }

  // One "New list" dropdown: each template (in order), then Blank list, which becomes a name input + Add.
  const newListRow = naming ? (
    <>
      <input className="input !w-44" aria-label="List name" placeholder="List name" autoFocus value={name} data-testid="new-list-name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setNaming(false); setName(""); }
          else if (e.key === "Enter") { e.preventDefault(); void addBlank(); }
        }} />
      <button type="button" className="btn acc" disabled={busy || !name.trim()} onClick={addBlank} data-testid="new-list-add">Add</button>
    </>
  ) : (
    <Menu label="New list" testid="new-list" trigger={<>New list <span aria-hidden>▾</span></>} items={[
      ...templates.map((t) => ({ key: `template-${t.id}`, label: t.name, onSelect: () => void addTemplate(t.id) })),
      { key: "blank", label: "Blank list", divider: templates.length > 0, onSelect: () => setNaming(true) },
    ]} />
  );

  if (draft) {
    const save = async () => {
      if (await call("shows.reorderChecklists", { id: show.id, listIds: order })) setDraft(null);
    };
    return (
      <section className="card editing" data-testid="checklists" data-reordering="1">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Checklists</h2>
          <span className="tag">Reordering</span>
        </div>
        <p className="s muted">Drag lists to reorder them. Edit items right on the list — no need to come here.</p>
        <ul className="grid gap-2">
          {order.map((id, i) => {
            const l = byId.get(id)!;
            return (
              <li key={id} className="flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
                data-testid={`reorder-row-${id}`} {...dr.row(i)} {...dr.handle(i)}>
                <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" className="shrink-0 cursor-grab text-[var(--muted)]" aria-hidden>
                  {[3, 11].flatMap((x) => [3, 9, 15].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.5" />))}
                </svg>
                <b className="min-w-0 flex-1 truncate">{l.name}</b>
                <span className="s muted shrink-0">{l.items.length} {l.items.length === 1 ? "item" : "items"}</span>
                <button type="button" className="icon-btn" aria-label={`Move ${l.name} up`} disabled={i === 0} onClick={() => setDraft(moved(order, i, i - 1))} data-testid={`reorder-up-${id}`}><Chevron up /></button>
                <button type="button" className="icon-btn" aria-label={`Move ${l.name} down`} disabled={i === order.length - 1} onClick={() => setDraft(moved(order, i, i + 1))} data-testid={`reorder-down-${id}`}><Chevron /></button>
              </li>
            );
          })}
        </ul>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2.5">
          <button type="button" className="btn outline" onClick={() => { setDraft(null); setError(null); }} data-testid="reorder-cancel">Cancel</button>
          <button type="button" className="btn acc" disabled={busy} onClick={save} data-testid="reorder-save">Save order</button>
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-4" data-testid="checklists">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">
          Checklists{total > 0 && <> · <span data-testid="checklists-count">{done} of {total}</span></>}
        </h2>
        {admin && (
          <div className="flex items-center gap-2">
            <Link href="/admin/artist#checklist-templates" className="s underline" data-testid="manage-templates">Manage templates</Link>
            {lists.length >= 2 && (
              <button type="button" className="card-edit" onClick={() => { setDraft(lists.map((l) => l.id)); setError(null); }} data-testid="checklists-edit">Edit</button>
            )}
          </div>
        )}
      </div>
      {lists.length === 0 ? (
        admin ? (
          <>
            <UnfinishedPlaceholder lead="No checklists yet." actions={<div className="flex flex-wrap items-center gap-2.5" data-testid="new-list-row">{newListRow}</div>} testid="checklists-empty">
              Start from one of your templates, or make a blank list.
            </UnfinishedPlaceholder>
            <p className="s muted">
              Templates live in <Link href="/admin/artist#checklist-templates" className="underline" data-testid="checklist-templates-link">Artist settings › Checklist templates</Link>
            </p>
          </>
        ) : (
          <UnfinishedPlaceholder lead="No checklists yet." testid="checklists-empty" />
        )
      ) : (
        <div className="grid gap-4">
          {lists.map((l) => (
            <ChecklistCard key={l.id} show={show} list={l} admin={admin} templateLive={!!l.templateId && liveTemplates.has(l.templateId)} autoFocusAdd={l.id === freshId} />
          ))}
        </div>
      )}
      {admin && lists.length > 0 && <div className="flex flex-wrap items-center justify-end gap-2.5" data-testid="new-list-row">{newListRow}</div>}
      <ErrorBox error={error} />
    </section>
  );
}
