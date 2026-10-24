"use client";
import { useEffect, useRef, useState } from "react";
import { useCommand, ErrorBox } from "@/components/ui";
import { ConfigurationPicker, PitchDatesField } from "@/components/booking/common";

export interface PitchTarget { kind: "venue" | "promoter" | "edition"; id: string; name: string; meta: string }

/** The "Add to Pitch List" modal opened from a flag on the Booking tables; `target === null` is closed, a save calls `onClose()`. */
export function PitchModal({ target, onClose }: { target: PitchTarget | null; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = !!target;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="pitch-dlg" aria-labelledby="pitch-modal-title" onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {target && <PitchForm key={target.id} target={target} onClose={onClose} />}
    </dialog>
  );
}

function PitchForm({ target, onClose }: { target: PitchTarget; onClose(): void }) {
  const { kind, id, name, meta } = target;
  const { call, error, busy } = useCommand();
  const [pitchedAs, setPitchedAs] = useState("");
  const [comment, setComment] = useState("");
  const [dates, setDates] = useState<string[]>([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); e.stopPropagation();
    const r = await call<{ id: string }>("pitches.flag", { kind, id, ...(dates.length ? { dates } : {}), ...(pitchedAs ? { pitchedAs } : {}) });
    if (!r) return;
    // the first comment is a real comment on the new pitch (its timeline), not a notes field
    if (comment.trim()) await call("pitches.comment", { id: r.id, body: comment.trim() });
    onClose();
  }

  return (
    <form onSubmit={submit} data-testid={`flag-form-${id}`}>
      <div className="flex items-start gap-3 border-b border-divider" style={{ padding: "18px 14px 16px 22px" }}>
        <svg className="mt-1 shrink-0" width="22" height="22" viewBox="0 0 24 24" fill="var(--pitched)" stroke="var(--pitched)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 21V4M5 4h12l-2.5 4L17 12H5" />
        </svg>
        <div className="grid min-w-0 flex-1">
          <span className="text-[13px] font-semibold text-muted">Add to the Pitch List</span>
          <h2 id="pitch-modal-title" className="text-[20px] font-extrabold leading-[1.3]">{name}</h2>
          <span className="text-[14px] text-muted">{meta}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" data-testid={`flag-close-${id}`}
          className="grid shrink-0 place-items-center border-0 bg-transparent text-muted" style={{ width: 44, height: 44, borderRadius: 10 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div className="grid gap-[18px]" style={{ padding: "18px 22px" }}>
        <ConfigurationPicker value={pitchedAs} onChange={setPitchedAs} testid={`flag-pitchedAs-${id}`} />
        <PitchDatesField dates={dates} onChange={setDates} testid={`flag-dates-${id}`} />
        <label className="grid gap-1">
          <span className="lbl">First comment <span className="font-normal">(optional)</span></span>
          <input className="input" type="text" value={comment} placeholder="e.g. Emailed the booker, they plan 3 months out" data-testid={`flag-comment-${id}`}
            onChange={(e) => setComment(e.target.value)} />
        </label>
      </div>
      <ErrorBox error={error} />
      <div className="flex flex-wrap justify-end gap-[10px] border-t border-divider" style={{ padding: "16px 22px 20px" }}>
        <button type="button" className="btn ghost" onClick={onClose} data-testid={`flag-cancel-${id}`}>Cancel</button>
        <button type="submit" className="btn acc" disabled={busy} data-testid={`flag-submit-${id}`}>Add to Pitch List</button>
      </div>
    </form>
  );
}
