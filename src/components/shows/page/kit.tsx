"use client";
/**
 * Shared pieces of the show page. A card flips into a form only when it really is one (Income, Expenses): pencil -> fields -> Cancel / Save.
 * Everything else edits where it sits (InlineValue). There is no page-level Edit.
 *
 *   const ed = useCardEdit({ canEdit: admin, onStart: () => setForm(formOf(show)) });
 *   <EditableCard title="Sound" testid="sound" ed={ed} onSave={save} busy={busy} error={error}>
 *     {ed.editing ? <form fields/> : <view/>}
 *   </EditableCard>
 * onSave returns true when it saved; the card then goes back to view mode.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { ErrorBox } from "@/components/ui";
import { PencilButton } from "@/components/InlineValue";

// ---------- a card that flips ----------

export interface CardEdit { editing: boolean; canEdit: boolean; start(): void; cancel(): void; done(): void }
export function useCardEdit({ canEdit, onStart }: { canEdit: boolean; onStart?(): void }): CardEdit {
  const [editing, setEditing] = useState(false);
  const startRef = useRef(onStart); startRef.current = onStart;
  const start = () => { if (!canEdit) return; startRef.current?.(); setEditing(true); };
  return { editing, canEdit, start, cancel: () => setEditing(false), done: () => setEditing(false) };
}

// ---------- the card ----------

export function EditableCard({ title, editLabel, testid, ed, badge, aside, onSave, onCancel, busy, error, saveLabel = "Save", footLeft, children }: {
  title: React.ReactNode; testid: string; ed: CardEdit;
  /** The pencil's aria-label is "Edit <title>"; pass this when `title` is a node. */
  editLabel?: string;
  /** Beside the title (AdminOnlyBadge). */
  badge?: React.ReactNode;
  /** Right of the header in view mode, before Edit ("3 of 4"). */
  aside?: React.ReactNode;
  onSave(): Promise<boolean> | boolean; onCancel?(): void; busy?: boolean; error?: string | null; saveLabel?: string;
  /** Left side of the Cancel/Save row in edit mode ("Ask who's free", "Delete"). */
  footLeft?: React.ReactNode;
  children: React.ReactNode;
}) {
  async function save() { if (await onSave()) ed.done(); }
  return (
    <section className={`card${ed.editing ? " editing" : ""}`} data-testid={testid} data-editing={ed.editing ? "1" : undefined}>
      <div className="card-head">
        <div className="flex flex-wrap items-center gap-2.5"><h2>{title}</h2>{badge}</div>
        {ed.editing ? <span className="tag">Editing</span> : (
          <div className="flex items-center gap-2">
            {aside}
            {ed.canEdit && <PencilButton label={`Edit ${editLabel ?? (typeof title === "string" ? title : testid)}`} onClick={ed.start} testid={`${testid}-edit`} />}
          </div>
        )}
      </div>
      {children}
      {ed.editing && (
        <>
          <ErrorBox error={error ?? null} />
          <div className="card-foot">
            {footLeft}
            <div className="end">
              <button type="button" className="btn outline" disabled={busy} onClick={() => { onCancel?.(); ed.cancel(); }} data-testid={`${testid}-cancel`}>Cancel</button>
              <button type="button" className="btn acc" disabled={busy} onClick={() => void save()} data-testid={`${testid}-save`}>{saveLabel}</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** A plain card with the same header (Comments, Net): no Edit. */
export function ShowCard({ title, testid, badge, aside, children, className }: { title: React.ReactNode; testid: string; badge?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card${className ? ` ${className}` : ""}`} data-testid={testid}>
      <div className="card-head"><div className="flex flex-wrap items-center gap-2.5"><h2>{title}</h2>{badge}</div>{aside}</div>
      {children}
    </section>
  );
}

// ---------- small parts ----------

/** "Admins only" with a lock: on cards members never see (Income, Net). */
export function AdminOnlyBadge() {
  return (
    <span className="admin-only" data-testid="admin-only">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>
      Admins only
    </span>
  );
}

/**
 * The light-yellow "not filled in yet" box: a bold lead, a sentence, and one-tap starters (buttons, `btn ghost`).
 * `row` lays the text and a single button side by side.
 */
export function UnfinishedPlaceholder({ lead, children, actions, row, testid }: { lead: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode; row?: boolean; testid?: string }) {
  return (
    <div className={`todo${row ? " row" : ""}`} data-testid={testid}>
      <span><b>{lead}</b>{children ? <> {children}</> : null}</span>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

/** A textarea that grows with its content and never scrolls (field-sizing where supported, measured height elsewhere). */
export function AutoGrowTextarea({ className, value, onChange, ...rest }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & { value: string; onChange(v: string): void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t || CSS.supports?.("field-sizing", "content")) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} {...rest} className={`input grow${className ? ` ${className}` : ""}`} value={value} onChange={(e) => onChange(e.target.value)} />;
}

/** Initials for the round avatar ("Ingrid Avison" -> "IA", "Jeff" -> "J"). */
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
