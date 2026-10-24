"use client";
import { useEffect, useRef } from "react";

/**
 * A side sheet: a native <dialog> pinned to the right edge (full screen on phones). Focus is trapped and Escape closes it;
 * so does a click on the backdrop. `header` goes beside the Close button. Content only renders while open.
 */
export function Sheet({ open, onClose, title, header, testid, children }: { open: boolean; onClose(): void; title: string; header?: React.ReactNode; testid?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet" data-testid={testid} aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <div className="sheet-body">
          <div className="sheet-head">
            <div className="min-w-0 grow">{header}</div>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} data-testid={testid ? `${testid}-close` : undefined}><CloseIcon /></button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export const CloseIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>;
