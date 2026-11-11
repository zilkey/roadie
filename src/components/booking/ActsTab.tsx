"use client";
/**
 * Booking's Acts tab (issue #77, board "ListActs" on the booking canvas): every act seen on a venue calendar plus any added by hand,
 * filtered (a dropdown) to the shortlist, the acts that opened at rooms on our list, or those on tour, and by genre (several at once),
 * city and name; the filters add up. Each row shows a few genres and an icon per link we have. The star shortlists; the X
 * beside it dismisses the act as not a fit (hidden from here, with an Undo).
 *
 * The acts and this band's take on them are live (useCollection); what the calendars say about each (rooms, next show, opened at our
 * rooms, on tour) comes from acts.find, which reads every venue's shows on the server. It is fetched again when the acts change.
 *
 * Paging: the filters, city and search run over every act on the client, then the table shows the first ACTS_PAGE of them and
 * "Load more" adds a page (the Festivals tab's button, the Shows list's client-side slice). A new filter, city or search starts back
 * at the first page, in its own change handler: no effect sets the page, so a filter can't set off a run of re-renders.
 */
import { useEffect, useMemo, useState } from "react";
import Link, { useArtist } from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import { ErrorBox, useCommand } from "@/components/ui";
import { hrefFor } from "@/components/booking/common";
import { CheckFilter } from "@/components/booking/CheckFilter";
import { LinkIcons } from "@/components/booking/LinkIcons";
import { useOurGenres } from "@/components/booking/useOurGenres";
import { ACT_FILTERS, actListed, type ActFilter, type ActStats } from "@/lib/acts";
import { fmtEventDay, genreOptions } from "@/lib/venueEvents";
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
export const XIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
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

/** Acts per page. e2e sets a small one (NEXT_PUBLIC_ACTS_PAGE) so its few fixture acts span pages. */
export const ACTS_PAGE = Number(process.env.NEXT_PUBLIC_ACTS_PAGE) || 50;
const ROOMS_SHOWN = 3;
const GENRES_SHOWN = 3;
const roleWord = (roles: ("headliner" | "support")[]) => (roles.length === 2 ? "headlining, opening" : roles[0] === "support" ? "opening" : "headlining");

export function ActsTab() {
  const { artistId } = useArtist();
  const acts = useCollection<ActDoc>("acts");
  const notes = useCollection<ActNote>("actNotes", { where: [["artistId", "==", artistId]] });
  const takes = useMemo(() => new Map((notes.rows ?? []).map((n) => [n.actId, n])), [notes.rows]);
  const { call, error } = useCommand();
  const star = useCommand();
  const shortlistLookup = useCommand();
  const [lookupStatus, setLookupStatus] = useState("");
  const [found, setFound] = useState<Map<string, FoundRow> | null>(null);
  const [filter, setFilterState] = useState<ActFilter>("shortlist");
  const [city, setCityState] = useState("");
  const [q, setQState] = useState("");
  const [genres, setGenresState] = useState<string[]>([]);
  const dismiss = useCommand();
  const [dismissed, setDismissed] = useState<Row | null>(null);
  const [shown, setShown] = useState(ACTS_PAGE);
  // Each change starts back at the first page.
  const setFilter = (v: ActFilter) => { setFilterState(v); setShown(ACTS_PAGE); };
  const setCity = (v: string) => { setCityState(v); setShown(ACTS_PAGE); };
  const setQ = (v: string) => { setQState(v); setShown(ACTS_PAGE); };
  const setGenres = (v: string[]) => { setGenresState(v); setShown(ACTS_PAGE); };
  const ours = useOurGenres();
  const genreChoices = useMemo(() => genreOptions(ours, (acts.rows ?? []).map((a) => a.genres)), [ours, acts.rows]);

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
    const listed = all.filter((a) => actListed(a, found?.get(a.id), takes.get(a.id), { filter, city: city || undefined, q, genres }));
    return listed.sort((x, y) => (found?.get(x.id)?.next?.date ?? "9999").localeCompare(found?.get(y.id)?.next?.date ?? "9999") || x.name.localeCompare(y.name));
  }, [acts.rows, found, takes, filter, city, q, genres]);
  const loading = !acts.rows || !notes.rows || (!found && !error);
  const page = rows.slice(0, shown);
  const left = rows.length - page.length;

  const toLookUp = filter === "shortlist" && rows.some((a) => !a.lookedUpAt && !a.lookupCandidates?.length);
  const lookUpShortlist = async () => {
    setLookupStatus("");
    const r = await shortlistLookup.call<{ lookedUp: number; found: number; pick: number; nothing: number; failed: number; left: number }>("acts.lookupShortlist", {});
    if (!r) return;
    const bits = [
      r.found ? `found something for ${r.found}` : "",
      r.pick ? `${r.pick} need${r.pick === 1 ? "s" : ""} you to pick which band` : "",
      r.nothing ? `nothing for ${r.nothing}` : "",
      r.failed ? `${r.failed} failed, try again` : "",
    ].filter(Boolean);
    setLookupStatus(`Looked up ${r.lookedUp}${bits.length ? `: ${bits.join(", ")}` : ""}.${r.left ? ` ${r.left} left: run it again.` : ""}`);
  };

  const toggle = (a: Row) => void star.call("acts.shortlist", { id: a.id, on: !takes.get(a.id)?.shortlist });
  /** Not a fit, from the row: the act leaves the list (unless it was searched for), so say so with an Undo. Again clears it. */
  const notFit = async (a: Row) => {
    const on = takes.get(a.id)?.relationship !== "notFit";
    if (await dismiss.call("acts.note", { id: a.id, relationship: on ? "notFit" : null })) setDismissed(on ? a : null);
  };
  const undo = async () => { if (dismissed && await dismiss.call("acts.note", { id: dismissed.id, relationship: null })) setDismissed(null); };

  return (
    <div className="grid min-w-0 gap-3" data-testid="acts-tab">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter acts">
        <select className="select !w-auto" value={filter} onChange={(e) => setFilter(e.target.value as ActFilter)} aria-label="Which acts" data-testid="acts-filter">
          {ACT_FILTERS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <CheckFilter label="Genre" all="Any genre" noun="genres" value={genres} onChange={setGenres} testid="acts-genre"
          groups={[{ label: genreChoices.ours.length ? "Our genres" : undefined, options: genreChoices.ours.map((g) => ({ key: g, label: g })) }, { label: genreChoices.ours.length ? "Other genres" : undefined, options: genreChoices.rest.map((g) => ({ key: g, label: g })) }]} />
        <label className="sr-only" htmlFor="acts-city">City</label>
        <select id="acts-city" className="select !w-auto" value={city} onChange={(e) => setCity(e.target.value)} data-testid="acts-city">
          <option value="">Any city</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="flex-auto" />
        {toLookUp && (
          <button type="button" className="btn soft sm" disabled={shortlistLookup.busy} onClick={() => void lookUpShortlist()} data-testid="acts-lookup-shortlist">
            {shortlistLookup.busy ? "Looking up…" : "Look up shortlist"}
          </button>
        )}
        <label className="sr-only" htmlFor="acts-q">Find an act</label>
        <input id="acts-q" className="input !min-h-9 !w-[220px]" type="search" placeholder="Find an act…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="acts-q" />
      </div>
      <ErrorBox error={error ?? star.error ?? shortlistLookup.error ?? dismiss.error} />
      {dismissed && (
        <div className="s flex flex-wrap items-center gap-2" role="status" data-testid="acts-dismissed">
          <span><b>{dismissed.name}</b> is hidden as not a fit.</span>
          <button type="button" className="btn ghost sm" disabled={dismiss.busy} onClick={() => void undo()} data-testid="acts-undo">Undo</button>
        </div>
      )}
      {lookupStatus && <span className="s" data-testid="acts-lookup-status">{lookupStatus}</span>}
      {loading && <span className="s">Loading…</span>}
      {!loading && rows.length === 0 && (
        <div className="empty" data-testid="acts-empty"><span>{filter === "shortlist" && !q && !city ? "Nothing on the shortlist yet. Tap an act's star to add it." : "Nothing matches."}</span></div>
      )}
      {!loading && rows.length > 0 && (
        <div className="book-tw">
          <table className="book-table wn">
            <thead><tr>
              <th className="flag"><span className="sr-only">Shortlist or not a fit</span></th>
              <th className="name">Act</th>
              <th>Links</th>
              <th>Seen at</th>
              <th>Next show</th>
              <th className="sl acts-sl">Sounds like</th>
            </tr></thead>
            <tbody>
              {page.map((a) => {
                const f = found?.get(a.id), take = takes.get(a.id), on = !!take?.shortlist, nf = take?.relationship === "notFit";
                const gs = a.genres ?? [], rel = take?.relationship as ActRelationship | undefined;
                const rooms = f?.rooms ?? [];
                return (
                  <tr key={a.id} data-testid={`act-row-${a.id}`}>
                    <td className="flag">
                      <span className="inline-flex">
                        <button type="button" className="flag-ic star-ic" aria-pressed={on} data-on={on ? "1" : "0"} aria-label={`Shortlist ${a.name}`} title={on ? "On the shortlist" : "Shortlist"} disabled={star.busy}
                          onClick={() => toggle(a)} data-testid={`act-star-${a.id}`}><StarIcon on={on} /></button>
                        <button type="button" className="flag-ic dismiss-ic" aria-pressed={nf} data-on={nf ? "1" : "0"} aria-label={`${a.name} is not a fit`} title={nf ? "Not a fit (again to clear)" : "Not a fit: hide it"} disabled={dismiss.busy}
                          onClick={() => void notFit(a)} data-testid={`act-dismiss-${a.id}`}><XIcon size={16} /></button>
                      </span>
                    </td>
                    <td className="name">
                      <div className="flex items-center gap-3">
                        <ActThumb src={a.imageUrl} />
                        <span className="min-w-0">
                          <Link href={hrefFor("act", a.id)} className="nm" data-testid={`act-link-${a.id}`}>{a.name}</Link>
                          {(!!f?.openedAt.length || f?.tour || rel) && (
                            <span className="mt-1 flex flex-wrap gap-1.5">
                              {rel && <span className="chip m" data-testid={`act-take-${a.id}`} title="Our take">{RELATIONSHIP_LABEL[rel]}</span>}
                              {!!f?.openedAt.length && <span className="chip a" data-testid="act-opened">Opened at our rooms</span>}
                              {f?.tour && <span className="chip y" data-testid="act-tour">On tour</span>}
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td><LinkIcons links={a.links} name={a.name} testid={`act-links-${a.id}`} /></td>
                    <td data-testid={`act-seen-${a.id}`}>
                      {rooms.length ? <>{rooms.length} room{rooms.length === 1 ? "" : "s"}
                        <span className="sub">{rooms.slice(0, ROOMS_SHOWN).map((r) => `${r.name} (${roleWord(r.roles)})`).join(" · ")}{rooms.length > ROOMS_SHOWN ? ` · +${rooms.length - ROOMS_SHOWN}` : ""}</span></>
                        : <span className="dash">—</span>}
                    </td>
                    <td className="nw">{f?.next ? <>{fmtEventDay(f.next.date)}<span className="sub">{f.next.name}</span></> : <span className="dash">—</span>}</td>
                    <td className="sl acts-sl" data-testid={`act-genres-${a.id}`}>
                      {gs.length > 0 && (
                        <span className="mb-1 flex flex-wrap gap-1">
                          {gs.slice(0, GENRES_SHOWN).map((g) => <span key={g} className="chip">{g}</span>)}
                          {gs.length > GENRES_SHOWN && <span className="chip" title={gs.slice(GENRES_SHOWN).join(", ")}>+{gs.length - GENRES_SHOWN}</span>}
                        </span>
                      )}
                      {a.description ? <span className="s line-clamp-2" title={a.description}>{a.description}</span> : !gs.length && <span className="s">{a.lookedUpAt ? "Nothing found" : "Not looked up"}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!loading && left > 0 && (
        <button type="button" className="btn ghost justify-self-center" onClick={() => setShown((n) => n + ACTS_PAGE)} data-testid="acts-more">
          Load more ({left} left)
        </button>
      )}
      <p className="s m-0" data-testid="table-caption">Every act seen on a venue calendar, plus any you add. &quot;Opened at our rooms&quot; means they played support at a venue on our list. &quot;On tour&quot; means 2+ Colorado dates within a few weeks.</p>
    </div>
  );
}
