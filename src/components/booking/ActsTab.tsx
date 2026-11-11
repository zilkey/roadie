"use client";
/**
 * Booking's Acts tab (issue #77, board "ListActs" on the booking canvas): every act seen on a venue calendar plus any added by hand,
 * filtered to the shortlist, the acts that opened at rooms on our list, or those on tour, and by city and name. The star shortlists.
 *
 * The acts and this band's take on them are live (useCollection); what the calendars say about each (rooms, next show, opened at our
 * rooms, on tour) comes from acts.find, which reads every venue's shows on the server. It is fetched again when the acts change.
 */
import { useEffect, useMemo, useState } from "react";
import Link, { useArtist } from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import { ErrorBox, useCommand } from "@/components/ui";
import { hrefFor } from "@/components/booking/common";
import { ACT_FILTERS, actListed, type ActFilter, type ActStats } from "@/lib/acts";
import { fmtEventDay } from "@/lib/venueEvents";
import { RELATIONSHIP_LABEL, type ActDoc, type ActNote, type ActRelationship } from "@/schema";

type Row = ActDoc & { id: string };
interface FoundRow { id: string; rooms: ActStats["rooms"]; next?: ActStats["next"]; openedAt: string[]; tour: boolean; cities: string[] }

export const StarIcon = ({ on, size = 18 }: { on: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
  </svg>
);
export const NoteIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
  </svg>
);
/** The act's picture, or the music-note tile. */
export function ActThumb({ src, size = 40 }: { src?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };
  // Remote hosts are arbitrary (Look up finds them on the web), so a plain img, not next/image with an allowlist.
  // eslint-disable-next-line @next/next/no-img-element
  if (src && !failed) return <img src={src} alt="" style={box} className="shrink-0 rounded-lg object-cover" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  return <span style={box} className="inline-flex shrink-0 items-center justify-center rounded-lg bg-[var(--soft)] text-[var(--muted)]"><NoteIcon size={Math.round(size * 0.45)} /></span>;
}

const ROOMS_SHOWN = 3;
const roleWord = (roles: ("headliner" | "support")[]) => (roles.length === 2 ? "headlining, opening" : roles[0] === "support" ? "opening" : "headlining");

export function ActsTab() {
  const { artistId } = useArtist();
  const acts = useCollection<ActDoc>("acts");
  const notes = useCollection<ActNote>("actNotes", { where: [["artistId", "==", artistId]] });
  const takes = useMemo(() => new Map((notes.rows ?? []).map((n) => [n.actId, n])), [notes.rows]);
  const { call, error } = useCommand();
  const star = useCommand();
  const [found, setFound] = useState<Map<string, FoundRow> | null>(null);
  const [filter, setFilter] = useState<ActFilter>("shortlist");
  const [city, setCity] = useState("");
  const [q, setQ] = useState("");

  // What the calendars say about every act: fetched once the acts load, and again when one is added or renamed.
  const actsVersion = (acts.rows ?? []).length;
  useEffect(() => {
    if (!acts.rows) return;
    let live = true;
    void call<{ rows: FoundRow[] }>("acts.find", { filter: "all", limit: 5000 }).then((r) => { if (live && r) setFound(new Map(r.rows.map((x) => [x.id, x]))); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actsVersion, !!acts.rows]);

  const cities = useMemo(() => [...new Set([...(found?.values() ?? [])].flatMap((f) => f.cities))].sort(), [found]);
  const rows = useMemo(() => {
    const all = (acts.rows ?? []) as Row[];
    const listed = all.filter((a) => actListed(a, found?.get(a.id), takes.get(a.id), { filter, city: city || undefined, q }));
    return listed.sort((x, y) => (found?.get(x.id)?.next?.date ?? "9999").localeCompare(found?.get(y.id)?.next?.date ?? "9999") || x.name.localeCompare(y.name));
  }, [acts.rows, found, takes, filter, city, q]);
  const loading = !acts.rows || !notes.rows || (!found && !error);

  const toggle = (a: Row) => void star.call("acts.shortlist", { id: a.id, on: !takes.get(a.id)?.shortlist });

  return (
    <div className="grid min-w-0 gap-3" data-testid="acts-tab">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter acts">
        {ACT_FILTERS.map(([k, label]) => (
          <button key={k} type="button" className="pick" aria-pressed={filter === k} onClick={() => setFilter(k)} data-testid={`acts-filter-${k}`}>{label}</button>
        ))}
        <label className="sr-only" htmlFor="acts-city">City</label>
        <select id="acts-city" className="select !w-auto" value={city} onChange={(e) => setCity(e.target.value)} data-testid="acts-city">
          <option value="">Any city</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="flex-auto" />
        <label className="sr-only" htmlFor="acts-q">Find an act</label>
        <input id="acts-q" className="input !min-h-9 !w-[220px]" type="search" placeholder="Find an act…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="acts-q" />
      </div>
      <ErrorBox error={error ?? star.error} />
      {loading && <span className="s">Loading…</span>}
      {!loading && rows.length === 0 && (
        <div className="empty" data-testid="acts-empty"><span>{filter === "shortlist" && !q && !city ? "Nothing on the shortlist yet. Tap an act's star to add it." : "Nothing matches."}</span></div>
      )}
      {!loading && rows.length > 0 && (
        <div className="book-tw">
          <table className="book-table wn">
            <thead><tr>
              <th className="flag"><span className="sr-only">Shortlist</span></th>
              <th className="name">Act</th>
              <th>Seen at</th>
              <th>Next show</th>
              <th>Sounds like</th>
              <th>Our take</th>
            </tr></thead>
            <tbody>
              {rows.map((a) => {
                const f = found?.get(a.id), take = takes.get(a.id), on = !!take?.shortlist;
                const rooms = f?.rooms ?? [];
                return (
                  <tr key={a.id} data-testid={`act-row-${a.id}`}>
                    <td className="flag">
                      <button type="button" className="flag-ic star-ic" aria-pressed={on} data-on={on ? "1" : "0"} aria-label={`Shortlist ${a.name}`} disabled={star.busy}
                        onClick={() => toggle(a)} data-testid={`act-star-${a.id}`}><StarIcon on={on} /></button>
                    </td>
                    <td className="name">
                      <div className="flex items-center gap-3">
                        <ActThumb src={a.imageUrl} />
                        <span className="min-w-0">
                          <Link href={hrefFor("act", a.id)} className="nm" data-testid={`act-link-${a.id}`}>{a.name}</Link>
                          {(!!f?.openedAt.length || f?.tour) && (
                            <span className="mt-1 flex flex-wrap gap-1.5">
                              {!!f?.openedAt.length && <span className="chip a" data-testid="act-opened">Opened at our rooms</span>}
                              {f?.tour && <span className="chip y" data-testid="act-tour">On tour</span>}
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td data-testid={`act-seen-${a.id}`}>
                      {rooms.length ? <>{rooms.length} room{rooms.length === 1 ? "" : "s"}
                        <span className="sub">{rooms.slice(0, ROOMS_SHOWN).map((r) => `${r.name} (${roleWord(r.roles)})`).join(" · ")}{rooms.length > ROOMS_SHOWN ? ` · +${rooms.length - ROOMS_SHOWN}` : ""}</span></>
                        : <span className="dash">—</span>}
                    </td>
                    <td className="nw">{f?.next ? <>{fmtEventDay(f.next.date)}<span className="sub">{f.next.name}</span></> : <span className="dash">—</span>}</td>
                    <td><span className="s">{a.description || "Not looked up"}</span></td>
                    <td>{take?.relationship ? RELATIONSHIP_LABEL[take.relationship as ActRelationship] : <span className="dash">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="s m-0" data-testid="table-caption">Every act seen on a venue calendar, plus any you add. &quot;Opened at our rooms&quot; means they played support at a venue on our list. &quot;On tour&quot; means 2+ Colorado dates within a few weeks.</p>
    </div>
  );
}
