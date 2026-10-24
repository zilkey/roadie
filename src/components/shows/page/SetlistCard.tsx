"use client";
import { useState } from "react";
import Link from "@/lib/artist";
import { useCommand } from "@/components/ui";
import { useCollection } from "@/lib/firestore-hooks";
import { fmtDur } from "@/lib/shows";
import type { Setlist } from "@/schema";
import type { ShowRow } from "../common";
import { EditableCard, UnfinishedPlaceholder, useCardEdit } from "./kit";

/** Setlist: the show's setlist, with a link to open it. */
export function SetlistCard({ show, admin }: { show: ShowRow; admin: boolean }) {
  const setlists = useCollection<Setlist>("setlists").rows ?? [];
  const { call, error, busy, setError } = useCommand();
  const [pick, setPick] = useState(show.setlistId ?? "");
  const ed = useCardEdit({ canEdit: admin, onStart: () => { setPick(show.setlistId ?? ""); setError(null); } });
  const sl = setlists.find((s) => s.id === show.setlistId);

  async function save() {
    if (pick === (show.setlistId ?? "")) return true;
    return !!(await call("setlists.attach", { showId: show.id, setlistId: pick || null }));
  }

  return (
    <EditableCard title="Setlist" testid="setlist" ed={ed} onSave={save} busy={busy} error={error}>
      {ed.editing ? (
        <div className="grid gap-2">
          <label className="lbl" htmlFor={`setlist-select-${show.id}`}>Setlist</label>
          <select id={`setlist-select-${show.id}`} className="select" value={pick} onChange={(e) => setPick(e.target.value)} data-testid="setlist-select">
            <option value="">No setlist</option>
            {setlists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      ) : sl ? (
        <div className="flex items-center justify-between gap-3" data-testid="setlist-view">
          <div className="grid gap-0.5">
            <b className="text-[15px]" data-testid="setlist-name">{sl.name}</b>
            <span className="s" data-testid="setlist-length">{fmtDur(sl.totalSec)}</span>
          </div>
          <Link href={`/songs?setlist=${sl.id}`} className="btn ghost" data-testid="setlist-link">Open ›</Link>
        </div>
      ) : admin ? (
        <UnfinishedPlaceholder lead="No setlist yet." row testid="setlist-empty" actions={<button type="button" className="btn ghost" onClick={ed.start} data-testid="setlist-pick">Pick a setlist</button>} />
      ) : <span className="s" data-testid="setlist-empty">No setlist yet.</span>}
    </EditableCard>
  );
}
