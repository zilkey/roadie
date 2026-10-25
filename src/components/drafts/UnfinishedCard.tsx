"use client";
import type { SaveState } from "@/lib/autosave";

function when(ms: number) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Under a create form: draft status, and (when restored) a note with Start over. Pass the useDraft() result fields. */
export function DraftNote({ restoredAt, status, onStartOver }: { restoredAt: number | null; status: SaveState; onStartOver(): void }) {
  const label = status === "saving" ? "Saving draft…" : status === "saved" ? "Draft saved" : status === "offline" ? "Offline · draft kept on this device" : status === "error" ? "Draft not saved to your other devices" : "";
  return (
    <div className="flex flex-wrap items-center gap-2 s" data-testid="draft-note">
      {restoredAt && <span data-testid="draft-restored">Picked up where you left off ({when(restoredAt)}).</span>}
      <span data-testid="draft-status" data-state={status}>{label}</span>
      {restoredAt && <button type="button" className="btn ghost sm" data-testid="draft-start-over" onClick={onStartOver}>Start over</button>}
    </div>
  );
}
