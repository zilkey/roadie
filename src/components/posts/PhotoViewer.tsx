"use client";
import { useEffect, useRef } from "react";
import { thumbAt } from "@/lib/photos";

/** A photo or video the viewer can show: `thumb` is any signed thumb link (its size is swapped for the big one). */
export interface ViewerItem { id: string; name: string; thumb?: string; video?: boolean }

const Icon = ({ d }: { d: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

/** The corner button that opens the viewer: four arrows out, white on a dark dot so it reads on any photo. */
export function ViewButton({ label, onClick, testid, className = "" }: { label: string; onClick(): void; testid?: string; className?: string }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} data-testid={testid}
      className={`grid h-9 w-9 place-items-center rounded-full border-0 bg-black/60 p-0 text-white hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${className}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
      </svg>
    </button>
  );
}

/**
 * One photo, as big as the window allows (Drive's 2048px preview, whole, never cropped), over the page. ← and → (keys or
 * buttons) step through `items`; Escape, × or a click on the dark around the photo closes. The link the caller already
 * has shows first, stretched, until the big one arrives. A video shows its still. `action` is the caller's own button for
 * the photo on show (Photos: pick it).
 */
export function PhotoViewer({ items, at, onAt, action }: {
  items: ViewerItem[]; at: number | null; onAt(i: number | null): void; action?(item: ViewerItem): React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cur = at === null ? undefined : items[at];
  const open = !!cur;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const step = (by: number) => { if (at !== null && items[at + by]) onAt(at + by); };
  const bar = "grid h-11 w-11 place-items-center rounded-full border-0 bg-white/15 p-0 text-white hover:bg-white/30 disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-white";

  return (
    <dialog ref={ref} aria-label={cur ? cur.name : "Photo"} data-testid="photo-viewer"
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-black/90 p-0 text-white backdrop:bg-black"
      onCancel={(e) => { e.preventDefault(); onAt(null); }}
      onKeyDown={(e) => { if (e.key === "ArrowLeft") step(-1); else if (e.key === "ArrowRight") step(1); }}>
      {cur && at !== null && (
        <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto]">
          <div className="flex items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm" data-testid="photo-viewer-name">{cur.name}{cur.video ? " · video still" : ""}</span>
            {items.length > 1 && <span className="shrink-0 text-sm opacity-70" data-testid="photo-viewer-count">{at + 1} of {items.length}</span>}
            <button type="button" className={bar} aria-label="Close" onClick={() => onAt(null)} data-testid="photo-viewer-close" autoFocus><Icon d="M18 6L6 18M6 6l12 12" /></button>
          </div>
          <div className="grid min-h-0 place-items-center px-2" onClick={(e) => { if (e.target === e.currentTarget) onAt(null); }}>
            {cur.thumb && (
              // The img box hugs the photo (max-h/max-w), so the dark around it is the closer above.
              <img key={cur.id} src={thumbAt(cur.thumb, 2048)} alt={cur.name} data-testid="photo-viewer-img"
                className="max-h-full max-w-full bg-contain bg-center bg-no-repeat object-contain" style={{ backgroundImage: `url("${cur.thumb}")` }} />
            )}
          </div>
          <div className="flex items-center justify-center gap-3 px-3 py-3">
            {items.length > 1 && <button type="button" className={bar} aria-label="Previous" disabled={at === 0} onClick={() => step(-1)} data-testid="photo-viewer-prev"><Icon d="M15 18l-6-6 6-6" /></button>}
            {action?.(cur)}
            {items.length > 1 && <button type="button" className={bar} aria-label="Next" disabled={at === items.length - 1} onClick={() => step(1)} data-testid="photo-viewer-next"><Icon d="M9 18l6-6-6-6" /></button>}
          </div>
        </div>
      )}
    </dialog>
  );
}
