"use client";
import { useEffect, useRef, useState } from "react";
import { nameOf } from "../common";
import { AssigneeSelect } from "./shared";
import type { Row } from "@/lib/firestore-hooks";
import type { ChecklistItem as Item } from "@/lib/shows";
import type { Musician } from "@/schema";

export interface ChecklistItemProps {
  item: Item;
  /** Choices for the assignee dropdown (activePeople). */
  people: Row<Musician>[];
  /** Every musician, for names of owners no longer active (nameOf). */
  musicians: Row<Musician>[];
  /** A command is running: don't start another from this row. */
  busy?: boolean;
  /** Ticked or unticked. */
  onToggle(done: boolean): void;
  /** The inline edit was saved with a change. label is trimmed and non-empty; ownerId null = unassigned. */
  onSave(next: { label: string; ownerId: string | null }): void;
  /** The × button (beside the assignee), or a save with empty text. */
  onRemove(): void;
}

/** One to-do row: tick it, click the text to edit label and assignee in place (Enter or leaving the row saves, Esc cancels). */
export function ChecklistItem({ item, people, musicians, busy, onToggle, onSave, onRemove }: ChecklistItemProps) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(item.label);
  const [owner, setOwner] = useState(item.ownerId ?? "");
  const rowRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const refocus = useRef(false);

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    } else if (refocus.current) {
      refocus.current = false;
      textRef.current?.focus();
    }
  }, [editing]);

  const start = () => {
    setLabel(item.label);
    setOwner(item.ownerId ?? "");
    setEditing(true);
  };
  const cancel = () => {
    if (!editing) return;
    refocus.current = true;
    setEditing(false);
  };
  const save = (back: boolean) => {
    if (!editing) return;
    const next = label.trim();
    refocus.current = back;
    setEditing(false);
    if (!next) onRemove();
    else if (next !== item.label || owner !== (item.ownerId ?? "")) onSave({ label: next, ownerId: owner || null });
  };

  return (
    <div
      ref={rowRef}
      tabIndex={editing ? -1 : undefined}
      data-testid={`checklist-item-${item.id}`}
      data-editing={editing ? "1" : undefined}
      className={`flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] px-2 py-1 outline-none ${editing ? "" : "cursor-text"}`}
      onClick={(e) => { if (!editing && e.target !== e.currentTarget.querySelector("input[type=checkbox]")) start(); }}
      onBlur={(e) => { if (editing && !rowRef.current?.contains(e.relatedTarget as Node | null)) save(false); }}
      onKeyDown={(e) => { if (editing && e.key === "Escape") { e.preventDefault(); cancel(); } }}
    >
      <input type="checkbox" className="h-[18px] w-[18px] shrink-0" aria-label={`Done: ${item.label}`} checked={item.done} disabled={busy}
        data-testid={`checklist-check-${item.id}`} onChange={(e) => onToggle(e.target.checked)} />
      {editing ? (
        <>
          <input ref={inputRef} className="input grow basis-40" aria-label="Item" data-testid="checklist-edit-input" value={label}
            onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(true); } }} />
          <AssigneeSelect value={owner} onChange={setOwner} people={people} musicians={musicians} label="Assign to" testid="checklist-edit-owner" className="!w-auto grow basis-32 sm:max-w-40" />
        </>
      ) : (
        <>
          <span ref={textRef} role="button" tabIndex={0} aria-label={`Edit ${item.label}`} data-testid={`checklist-text-${item.id}`}
            className="min-w-0 grow basis-0 break-words rounded-[4px] py-1 outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            style={item.done ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); start(); } }}>{item.label}</span>
          <span className="s min-w-0 max-w-[40%] truncate" data-testid={`checklist-owner-${item.id}`}>{item.ownerId ? nameOf(musicians, item.ownerId) : "Unassigned"}</span>
          <button type="button" aria-label={`Remove ${item.label}`} data-testid="checklist-item-remove" disabled={busy}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:border-[var(--muted)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}>×</button>
        </>
      )}
    </div>
  );
}
