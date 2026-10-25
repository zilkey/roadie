"use client";
import Link, { useArtistRouter } from "@/lib/artist";
import { fmtLongYear } from "@/lib/shows";
import { initials } from "@/components/shows/page/kit";
import { useMusic } from "./common";

const TH = "s whitespace-nowrap px-3 py-2.5 text-left text-[11.5px] font-bold uppercase tracking-wider";
const TD = "px-3 py-3 align-middle";

/** The Rehearsals page body: past rehearsals newest first, as a table. "Log a rehearsal" lives in the page header. */
export function RehearsalsList() {
  const m = useMusic();
  const router = useArtistRouter();
  // personnel ids are musician ids; show them in the roster's order (the order of the musicians collection)
  const roster = new Map(m.musicians.map((x, i) => [x.id, { name: x.name, i }]));
  const withRecording = new Set(m.files.flatMap((f) => (f.rehearsalId ? [f.rehearsalId] : [])));
  const rows = [...m.rehearsals].sort((a, b) => b.date.localeCompare(a.date));
  if (!m.loading && rows.length === 0) return <div className="empty" data-testid="rehearsals-list"><span>No rehearsals logged yet.</span></div>;
  return (
    <div className="max-w-full overflow-x-auto rounded-xl border border-line bg-panel" data-testid="rehearsals-list">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr><th className={TH}>Date</th><th className={TH}>Where</th><th className={TH}>Who was there</th><th className={TH}>Songs</th><th className={TH}><span className="sr-only">Recording</span></th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const who = r.personnel.flatMap((id) => { const p = roster.get(id); return p ? [p] : []; }).sort((a, b) => a.i - b.i);
            const where = r.location?.name ?? r.location?.address;
            return (
              <tr key={r.id} className="cursor-pointer border-t border-line hover:bg-soft" data-testid={`rehearsal-${r.id}`} onClick={() => router.push(`/rehearsals/${r.id}`)}>
                <td className={`${TD} whitespace-nowrap font-semibold`}><Link href={`/rehearsals/${r.id}`} onClick={(e) => e.stopPropagation()}>{fmtLongYear(r.date)}</Link></td>
                <td className={TD}>{where ?? <span className="s">—</span>}</td>
                <td className={TD}>
                  {who.length === 0 ? <span className="s">—</span> : (
                    <div className="flex" data-testid="rehearsal-who">
                      {who.map((p, i) => (
                        <span key={p.i} title={p.name} className={`inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-[var(--surface)] bg-[var(--accent)] text-xs font-bold text-[var(--on-accent)] ${i ? "-ml-2" : ""}`}>{initials(p.name)}</span>
                      ))}
                    </div>
                  )}
                </td>
                <td className={`${TD} s whitespace-nowrap`}>{r.songs.length} songs run</td>
                <td className={TD}>{withRecording.has(r.id) && <span className="chip a">Recording</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
