"use client";
import type { SaveState } from "@/lib/autosave";

export interface SaveStatusProps {
  status: SaveState; error?: string | null;
  conflict?: { message: string } | null;
  onKeepMine?(): void; onUseTheirs?(): void;
  /** Wording for the saved state ("Draft saved" for drafts). */
  savedLabel?: string;
}

/** The small "Saving… / Saved / Offline · will save / error" label next to an autosaving record. */
export function SaveStatus({ status, error, conflict, onKeepMine, onUseTheirs, savedLabel = "Saved" }: SaveStatusProps) {
  if (status === "conflict" && conflict) {
    return (
      <span className="save-status bad" data-testid="save-status" data-state="conflict" role="alert">
        {conflict.message}
        {onKeepMine && <button type="button" className="btn ghost sm" data-testid="conflict-keep" onClick={onKeepMine}>Keep mine</button>}
        {onUseTheirs && <button type="button" className="btn ghost sm" data-testid="conflict-theirs" onClick={onUseTheirs}>Use theirs</button>}
      </span>
    );
  }
  const text = status === "saving" ? "Saving…" : status === "saved" ? savedLabel : status === "offline" ? "Offline · will save" : status === "error" ? `Not saved: ${error ?? "error"}` : "";
  return (
    <span className={`save-status ${status === "saved" ? "ok" : status === "error" ? "bad" : ""}`} data-testid="save-status" data-state={status} aria-live="polite">{text}</span>
  );
}
