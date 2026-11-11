"use client";
import { useState } from "react";
import { Dialog, ErrorBox } from "@/components/ui";
import { DialogClose, DialogFoot } from "@/components/booking/AddContactDialog";

export interface PickItem { id: string; name: string; /** The muted line under the name (a kind, a city). */ sub?: string }

/**
 * The plus behind a list card that links existing records ("Works with", "Venues they book"): the "Already in …" half of
 * Add a contact. Find by name or the muted line, pick one, one primary button. `testid` prefixes every part:
 * `-dialog`, `-close`, `-find`, `-hits`, `-hit-<id>`, `-submit`, `-cancel`.
 */
export function PickDialog({ open, onClose, title, subtitle, findLabel, placeholder, items, addLabel, busy, error, onPick, testid }: {
  open: boolean; onClose(): void; title: string; subtitle?: string; findLabel: string; placeholder?: string; items: PickItem[];
  addLabel: string; busy: boolean; error?: string | null; onPick(id: string): Promise<boolean>; testid: string;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} testid={`${testid}-dialog`}>
      <DialogClose onClose={onClose} testid={`${testid}-close`} />
      {subtitle && <span className="s -mt-2">{subtitle}</span>}
      <Picker findLabel={findLabel} placeholder={placeholder} items={items} addLabel={addLabel} busy={busy} onCancel={onClose} testid={testid}
        onPick={async (id) => { if (await onPick(id)) onClose(); }} />
      <ErrorBox error={error ?? null} />
    </Dialog>
  );
}

/** Its own component so the search and the pick start fresh each time the dialog opens (Dialog renders children only while open). */
function Picker({ findLabel, placeholder, items, addLabel, busy, onPick, onCancel, testid }: {
  findLabel: string; placeholder?: string; items: PickItem[]; addLabel: string; busy: boolean; onPick(id: string): Promise<void>; onCancel(): void; testid: string;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = items
    .filter((x) => words.every((w) => `${x.name} ${x.sub ?? ""}`.toLowerCase().includes(w)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 8);
  return (
    <>
      <label className="grid gap-1">
        <span className="lbl">{findLabel}</span>
        <input className="input" placeholder={placeholder} value={q} autoFocus data-testid={`${testid}-find`}
          onChange={(e) => { setQ(e.target.value); setPicked(null); }} />
      </label>
      <div className="hit-list" data-testid={`${testid}-hits`}>
        {hits.length === 0 && <span className="s p-3">{q.trim() ? "Nothing matches." : "Everything is already linked."}</span>}
        {hits.map((x) => (
          <button key={x.id} type="button" className="hit-row" aria-pressed={picked === x.id} onClick={() => setPicked(x.id)} data-testid={`${testid}-hit-${x.id}`}>
            <span className="grid min-w-0 gap-px"><b>{x.name}</b>{x.sub && <span className="s">{x.sub}</span>}</span>
          </button>
        ))}
      </div>
      <DialogFoot onCancel={onCancel} cancelTestid={`${testid}-cancel`}>
        <button type="button" className="btn acc" disabled={busy || !picked} onClick={() => picked && onPick(picked)} data-testid={`${testid}-submit`}>{addLabel}</button>
      </DialogFoot>
    </>
  );
}

/** The × at the end of a list row: shows on hover, stays visible on touch (`.row-x`). Unlinking doesn't ask; deleting asks in `onClick`. */
export function RowX({ label, onClick, disabled, testid }: { label: string; onClick(): void; disabled?: boolean; testid?: string }) {
  return (
    <button type="button" className="row-x" aria-label={label} title={label} disabled={disabled} onClick={onClick} data-testid={testid}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
    </button>
  );
}
