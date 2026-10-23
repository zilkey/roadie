"use client";
import Link from "next/link";
import { useDrafts } from "@/lib/drafts";
import type { SaveState } from "@/lib/autosave";

const KIND: Record<string, string> = { show: "Show", venue: "Venue", promoter: "Promoter", festival: "Festival", edition: "Edition", contact: "Contact", song: "Song", template: "Email template", musician: "Musician", user: "User", configuration: "Configuration", pitchComment: "Pitch comment", pitchCall: "Pitch call" };
export const kindLabel = (k: string) => KIND[k] ?? k.charAt(0).toUpperCase() + k.slice(1);

function when(ms: number) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Home: the signed-in user's unfinished "new X" forms, from any machine. Renders nothing when there are none. */
export function UnfinishedCard() {
  const rows = useDrafts();
  if (!rows?.length) return null;
  return (
    <div className="card" data-testid="unfinished">
      <span className="lbl">Unfinished</span>
      {rows.map((d) => (
        <Link key={d.id} href={d.route} className="flex items-center justify-between gap-2" data-testid={`draft-${d.id}`}>
          <span className="font-bold">{d.title || `New ${d.kind}`}</span>
          <span className="s">{kindLabel(d.kind)} · {when(d.updatedAt)}</span>
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
