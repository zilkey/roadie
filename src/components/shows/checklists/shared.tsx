"use client";
/** Shared by the show page's checklist sidebar and Artist settings › Checklist templates. */
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { nameOf } from "../common";
import type { ChecklistTemplate, Musician } from "@/schema";

export type TemplateRow = Row<ChecklistTemplate>;

/** An artist's live checklist templates, in order. Admins only (rules): members get an empty list without asking. */
export function useChecklistTemplates(artistId: string | undefined, admin: boolean) {
  const c = useCollection<ChecklistTemplate>("checklistTemplates", { where: [["artistId", "==", artistId ?? "none"]], skip: !admin || !artistId });
  return { templates: [...(c.rows ?? [])].sort((a, b) => a.order - b.order), loading: c.loading };
}

/** Who a to-do can be assigned to: the band's active musicians. */
export const activePeople = (musicians: Row<Musician>[]) => musicians.filter((m) => m.active && !m.archivedAt);

/**
 * The assignee dropdown: "Anyone" (unassigned, value "") then the active musicians. An owner who is no longer active stays
 * listed by name so the current choice still shows.
 */
export function AssigneeSelect({ value, onChange, people, musicians, label = "Assign to", testid, className, onKeyDown, disabled }: {
  value: string; onChange(v: string): void; people: Row<Musician>[]; musicians: Row<Musician>[];
  label?: string; testid?: string; className?: string; disabled?: boolean; onKeyDown?(e: React.KeyboardEvent<HTMLSelectElement>): void;
}) {
  return (
    <select className={`select${className ? ` ${className}` : ""}`} aria-label={label} value={value} disabled={disabled} data-testid={testid}
      onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown}>
      <option value="">Anyone</option>
      {people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      {value && !people.some((m) => m.id === value) && <option value={value}>{nameOf(musicians, value)}</option>}
    </select>
  );
}

/** Move one entry of a list from index `from` to index `to` (reorder by drag or by the up/down buttons). */
export function moved<T>(xs: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= xs.length || from === to) return [...xs];
  const next = [...xs];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
}
