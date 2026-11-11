"use client";
import Link, { useArtistRouter } from "@/lib/artist";
import { fmtLongYear } from "@/lib/shows";
import { todayStr } from "@/lib/booking";
import { initials } from "@/components/shows/page/kit";
import { useMusic } from "./common";

const TH = "s whitespace-nowrap px-3 py-2.5 text-left text-[0.7188rem] font-bold uppercase tracking-wider";
const TD = "px-3 py-3 align-middle";

/** The Rehearsals page body: an Upcoming table (today on, soonest first) above a Past table (newest first).
 *  "Create Rehearsal" lives in the page header. */
export function RehearsalsList() {
  const m = useMusic();
  const today = todayStr();
  const upcoming = m.rehearsals.filter((r) => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = m.rehearsals.filter((r) => r.date < today).sort((a, b) => b.date.localeCompare(a.date));
  if (!m.loading && m.rehearsals.length === 0) return <div className="empty" data-testid="rehearsals-list"><span>No rehearsals logged yet.</span></div>;
  return (
    <div className="grid gap-6" data-testid="rehearsals-list">
      <Section id="upcoming" title="Upcoming" rows={upcoming} empty="No upcoming rehearsals." />
      <Section id="past" title="Past" rows={past} empty="No past rehearsals." />
    </div>
  );
}

function Section({ id, title, rows, empty }: { id: string; title: string; rows: ReturnType<typeof useMusic>["rehearsals"]; empty: string }) {
  const m = useMusic();
  const router = useArtistRouter();
  // personnel ids are musician ids; show them in the roster's order (the order of the musicians collection)
  const roster = new Map(m.musicians.map((x, i) => [x.id, { name: x.name, i }]));
  const withRecording = new Set(m.files.flatMap((f) => (f.rehearsalId ? [f.rehearsalId] : [])));
  return (
    <section className="grid gap-3" data-testid={`rehearsals-${id}`}>
      <h2 className="text-lg font-bold">{title}</h2>
      {rows.length === 0 ? <div className="empty"><span>{empty}</span></div> : (
        <div className="max-w-full overflow-x-auto rounded-xl border border-line bg-panel">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr><th className={TH}>Date</th><th className={TH}>Where</th><th className={TH}>Band members</th><th className={TH}>Songs</th><th className={TH}><span className="sr-only">Recording</span></th></tr>
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
                    <td className={`${TD} s whitespace-nowrap`}>{r.songs.length} songs</td>
                    <td className={TD}>{withRecording.has(r.id) && <span className="chip a">Recording</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
