"use client";
import Link from "@/lib/artist";
import { fmtDay, useMusic } from "./common";

/** The Rehearsals page body: past rehearsals newest first. "Log a rehearsal" lives in the page header. */
export function RehearsalsList() {
  const m = useMusic();
  return (
    <div className="grid gap-2" data-testid="rehearsals-list">
      {!m.loading && m.rehearsals.length === 0 && <div className="empty"><span>No rehearsals logged yet.</span></div>}
      {[...m.rehearsals].sort((a, b) => b.date.localeCompare(a.date)).map((r) => (
        <Link key={r.id} href={`/rehearsals/${r.id}`} className="card" data-testid={`rehearsal-${r.id}`}>
          <div className="flex items-center justify-between"><b>{fmtDay(r.date)}{r.location?.name ?? r.location?.address ? ` · ${r.location?.name ?? r.location?.address}` : ""}</b><span className="s font-semibold">Open ›</span></div>
          <span className="s">{r.songs.length} songs run</span>
        </Link>
      ))}
    </div>
  );
}
