"use client";
import Link from "@/lib/artist";
import { useDrafts } from "@/lib/drafts";
import type { SaveState } from "@/lib/autosave";

const NOUN: Record<string, string> = {
  shows: "Show", venues: "Venue", promoters: "Promoter", festivals: "Festival", editions: "Edition", contacts: "Contact", songs: "Song",
  emailTemplates: "Email template", musicians: "Musician", users: "User", configurations: "Configuration", expenses: "Expense",
  setlists: "Setlist", rehearsals: "Rehearsal", pitches: "Pitch", comments: "Pitch comment", calls: "Pitch call",
  docs: "Show doc", after: "After-show notes", settlement: "Settlement", availability: "Availability ask", artists: "Artist", showDeals: "Deal",
};
/** "Expense" for `expenses` or `shows/{id}/expenses`; for an edit path (`shows/{id}`) the record's kind. */
export function pathLabel(path: string) {
  const parts = path.split("/"), coll = parts.length === 2 ? parts[0] : parts[parts.length - 1];
  return NOUN[coll] ?? coll.charAt(0).toUpperCase() + coll.slice(1);
}

function when(ms: number) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Home: the signed-in user's unfinished "new X" forms and unsaved edits, from any machine. Renders nothing when there are none. */
export function UnfinishedCard() {
  const rows = useDrafts();
  if (!rows?.length) return null;
  return (
    <div className="card" data-testid="unfinished">
      <span className="lbl">Unfinished</span>
      {rows.map((d) => (
        <Link key={d.id} href={d.route} className="flex items-center justify-between gap-2" data-testid={`draft-${d.id}`}>
          <span className="font-bold">{d.edit ? `Unsaved changes to ${d.title || pathLabel(d.path).toLowerCase()}` : d.title || `New ${pathLabel(d.path).toLowerCase()}`}</span>
          <span className="s">{pathLabel(d.path)} · {when(d.updatedAt)}</span>
        </Link>
      ))}
    </div>
  );
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
