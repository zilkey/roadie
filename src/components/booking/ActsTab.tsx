"use client";
/**
 * Booking's Acts tab (issue #77, board "ListActs" on the booking canvas): every act seen on a venue calendar plus any added by hand,
 * filtered (a dropdown) to the acts we watch (stored as the shortlist), the acts that opened at rooms on our list, or those on tour, and by our take,
 * genre (several at once), city and name; the filters add up. The Our take column is a dropdown that sets the take without opening the act. Each row shows a few genres and an icon per link we have. The star (Watch; stored as shortlist) and the X
 * beside it (not a fit: hidden from here, with an Undo) are one choice: a click sets it, a click on the lit one clears it.
 *
 * The acts and this band's take on them are live (useCollection); what the calendars say about each (rooms, next show, opened at our
 * rooms, on tour) comes from acts.find, which reads every venue's shows on the server. It is fetched again when the acts change.
 *
 * Paging: the filters, city and search run over every act on the client, then the table shows the first ACTS_PAGE of them and
 * "Load more" adds a page (the Festivals tab's button, the Shows list's client-side slice). A new filter, city or search starts back
 * at the first page, in its own change handler: no effect sets the page, so a filter can't set off a run of re-renders.
 *
 * The filters ride in the URL so a link sends the exact list: ?show= (the dropdown; Watching is the default and leaves it out), ?take=,
 * ?genre= (once per genre), ?city= and ?find= (not ?q=: that's the booking-wide search, which replaces the tab). They're written with
 * history.replaceState, which the App Router picks up without a navigation, so typing in Find doesn't refetch the page. Back from
 * an act's page steps back to that URL, and useListMemory opens as many pages as were open and scrolls back to where it was.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useListMemory } from "@/lib/listMemory";
import Link, { useArtist } from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import { ErrorBox, useCommand } from "@/components/ui";
import { hrefFor } from "@/components/booking/common";
import { CheckFilter } from "@/components/booking/CheckFilter";
import { LinkIcons } from "@/components/booking/LinkIcons";
import { WeKnowCheck } from "@/components/booking/WhoWeKnow";
import { useOurGenres } from "@/components/booking/useOurGenres";
import { ACT_FILTERS, actListed, type ActFilter, type ActStats, type ActTakeFilter } from "@/lib/acts";
import { fmtEventDay, genreOptions } from "@/lib/venueEvents";
import { ACT_RELATIONSHIPS, RELATIONSHIP_LABEL, type ActDoc, type ActNote, type ActRelationship } from "@/schema";

export type ActRow = ActDoc & { id: string };
type Row = ActRow;
export interface FoundRow { id: string; rooms: ActStats["rooms"]; next?: ActStats["next"]; openedAt: string[]; tour: boolean; cities: string[] }

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

const TAKE_FILTERS: [ActTakeFilter, string][] = [["", "Any take"], ["none", "No take yet"], ...ACT_RELATIONSHIPS.map((r): [ActTakeFilter, string] => [r, RELATIONSHIP_LABEL[r]])];
const isTakeFilter = (v: string | null): v is ActTakeFilter => TAKE_FILTERS.some(([k]) => k === v);

/**
 * Every act, this band's take on each (live), and what the calendars say about them (acts.find, which reads every venue's shows on
 * the server; fetched again when an act is added). The Acts tab and the booking search's Acts section both read it.
 */
export function useActsData() {
  const { artistId } = useArtist();
  const acts = useCollection<ActDoc>("acts");
  const notes = useCollection<ActNote>("actNotes", { where: [["artistId", "==", artistId]] });
  const takes = useMemo(() => new Map((notes.rows ?? []).map((n) => [n.actId, n])), [notes.rows]);
  const { call, error } = useCommand();
  const [found, setFound] = useState<Map<string, FoundRow> | null>(null);
  const actsVersion = (acts.rows ?? []).length;
  useEffect(() => {
    if (!acts.rows) return;
    let live = true;
    void call<{ rows: FoundRow[] }>("acts.find", { filter: "all", limit: 5000 }).then((r) => { if (live && r) setFound(new Map(r.rows.map((x) => [x.id, x]))); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actsVersion, !!acts.rows]);
  const loading = !acts.rows || !notes.rows || (!found && !error);
  return { acts: (acts.rows ?? []) as Row[], takes, found, error, loading };
}
type Takes = ReturnType<typeof useActsData>["takes"];

/**
 * Watch, Not a fit and the take dropdown. Watch and Not a fit are one choice: a click sets that one (and clears the other), a click on
 * the lit one clears it. Not a fit (from the X or the dropdown) takes the act off the list unless it was searched for, so it says so
 * with an Undo back to how it was.
 */
export function useActChoices(takes: Takes) {
  const star = useCommand();
  const [dismissed, setDismissed] = useState<{ row: Row; shortlist: boolean; relationship: ActRelationship | null } | null>(null);
  const before = (a: Row) => { const t = takes.get(a.id); return { shortlist: !!t?.shortlist, relationship: (t?.relationship as ActRelationship | undefined) ?? null }; };
  const choose = async (a: Row, pick: "shortlist" | "notFit") => {
    const was = before(a), nf = was.relationship === "notFit";
    if (pick === "notFit") return setTake(a, nf ? null : "notFit");
    const ok = await star.call("acts.update", { id: a.id, patch: { shortlist: !was.shortlist, ...(nf ? { relationship: null } : {}) } });
    if (ok) setDismissed(null);
  };
  const setTake = async (a: Row, next: ActRelationship | null) => {
    const was = before(a);
    if (was.relationship === next) return;
    const ok = await star.call("acts.update", { id: a.id, patch: { relationship: next, ...(next === "notFit" ? { shortlist: false } : {}) } });
    if (ok) setDismissed(next === "notFit" ? { row: a, ...was } : null);
  };
  const undo = async () => {
    if (dismissed && await star.call("acts.update", { id: dismissed.row.id, patch: { relationship: dismissed.relationship, shortlist: dismissed.shortlist } })) setDismissed(null);
  };
  return { choose, setTake, undo, dismissed, busy: star.busy, error: star.error };
}
type Choices = ReturnType<typeof useActChoices>;

/**
 * The acts table: Watch / Not a fit, the act, our take (a dropdown), where they've been seen and their next show; the full table
 * adds Sounds like and We know. compact is the booking search's Acts section.
 */
export function ActsTable({ rows, found, takes, choices, compact = false, testid }: { rows: Row[]; found: Map<string, FoundRow> | null; takes: Takes; choices: Choices; compact?: boolean; testid?: string }) {
  return (
    <div className="book-tw">
      <table className={`book-table wn acts${compact ? " compact" : ""}`} data-testid={testid}>
        <thead><tr>
          <th className="flag"><span className="sr-only">Watch or not a fit</span></th>
          <th className="name">Act</th>
          <th className="take">Our take</th>
          <th className="seen">Seen at</th>
          <th className="next">Next show</th>
          {!compact && <th className="sl acts-sl">Sounds like</th>}
          {!compact && <th className="wk" title="Someone in the band knows them: the rooms they play show it on their Network tab">We know</th>}
        </tr></thead>
        <tbody>
          {rows.map((a) => {
            const f = found?.get(a.id), take = takes.get(a.id), on = !!take?.shortlist, nf = take?.relationship === "notFit";
            const gs = a.genres ?? [], rel = take?.relationship as ActRelationship | undefined;
            const rooms = f?.rooms ?? [];
            return (
              <tr key={a.id} data-testid={`act-row-${a.id}`}>
                <td className="flag">
                  <span className="inline-flex">
                    <button type="button" className="flag-ic star-ic" aria-pressed={on} data-on={on ? "1" : "0"} aria-label={`Watch ${a.name}`} title={on ? "Watching (click to stop)" : "Watch"} disabled={choices.busy}
                      onClick={() => void choices.choose(a, "shortlist")} data-testid={`act-star-${a.id}`}><StarIcon on={on} /></button>
                    <button type="button" className="flag-ic dismiss-ic" aria-pressed={nf} data-on={nf ? "1" : "0"} aria-label={`${a.name} is not a fit`} title={nf ? "Not a fit (click to clear)" : "Not a fit: hide it"} disabled={choices.busy}
                      onClick={() => void choices.choose(a, "notFit")} data-testid={`act-dismiss-${a.id}`}><XIcon size={16} /></button>
                  </span>
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
                      {a.links && Object.values(a.links).some(Boolean) && <span className="mt-1 -ml-2 flex"><LinkIcons links={a.links} name={a.name} testid={`act-links-${a.id}`} /></span>}
                    </span>
                  </div>
                </td>
                <td className="take">
                  <select className="select take-sel" value={rel ?? ""} disabled={choices.busy} aria-label={`Our take on ${a.name}`} data-on={rel ? "1" : "0"}
                    onChange={(e) => void choices.setTake(a, (e.target.value || null) as ActRelationship | null)} data-testid={`act-take-${a.id}`}>
                    <option value="">—</option>
                    {ACT_RELATIONSHIPS.map((r) => <option key={r} value={r}>{RELATIONSHIP_LABEL[r]}</option>)}
                  </select>
                </td>
                <td className="seen" data-testid={`act-seen-${a.id}`}>
                  {rooms.length ? <>{rooms.length} room{rooms.length === 1 ? "" : "s"}
                    <span className="sub">{rooms.slice(0, ROOMS_SHOWN).map((r, i) => <span key={r.venueId}>{i > 0 && " · "}<Link href={hrefFor("venue", r.venueId)} className="hover:underline">{r.name}</Link> ({roleWord(r.roles)})</span>)}{rooms.length > ROOMS_SHOWN ? ` · +${rooms.length - ROOMS_SHOWN}` : ""}</span></>
                    : <span className="dash">—</span>}
                </td>
                <td className="nw next" data-testid={`act-next-${a.id}`}>{f?.next ? <>
                  {f.next.ticketUrl ? <a href={f.next.ticketUrl} target="_blank" rel="noreferrer" className="underline" title="Tickets and details" data-testid={`act-next-link-${a.id}`}>{fmtEventDay(f.next.date)} ↗</a> : fmtEventDay(f.next.date)}
                  <span className="sub"><Link href={hrefFor("venue", f.next.venueId)} className="hover:underline" data-testid={`act-next-venue-${a.id}`}>{f.next.name}</Link></span>
                </> : <span className="dash">—</span>}</td>
                {!compact && (
                  <td className="sl acts-sl" data-testid={`act-genres-${a.id}`}>
                    {gs.length > 0 && (
                      <span className="mb-1 flex flex-wrap gap-1">
                        {gs.slice(0, GENRES_SHOWN).map((g) => <span key={g} className="chip">{g}</span>)}
                        {gs.length > GENRES_SHOWN && <span className="chip" title={gs.slice(GENRES_SHOWN).join(", ")}>+{gs.length - GENRES_SHOWN}</span>}
                      </span>
                    )}
                    {a.description ? <span className="s line-clamp-2" title={a.description}>{a.description}</span> : !gs.length && <span className="s">{a.lookedUpAt ? "Nothing found" : "Not looked up"}</span>}
                  </td>
                )}
                {!compact && <td className="wk"><WeKnowCheck kind="act" id={a.id} name={a.name} on={!!take?.weKnow} /></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ActsTab() {
  const { acts, takes, found, error, loading: dataLoading } = useActsData();
  const choices = useActChoices(takes);
  const shortlistLookup = useCommand();
  const [lookupStatus, setLookupStatus] = useState("");
  const params = useSearchParams();
  const [filter, setFilterState] = useState<ActFilter>(() => {
    const v = params.get("show");
    return ACT_FILTERS.some(([k]) => k === v) ? (v as ActFilter) : "shortlist";
  });
  const [take, setTakeState] = useState<ActTakeFilter>(() => { const v = params.get("take"); return isTakeFilter(v) ? v : ""; });
  const [city, setCityState] = useState(() => params.get("city") ?? "");
  const [q, setQState] = useState(() => params.get("find") ?? "");
  const [genres, setGenresState] = useState<string[]>(() => params.getAll("genre"));
  const [shown, setShown] = useState(ACTS_PAGE);
  // Each change starts back at the first page and puts the filters in the URL.
  const toUrl = (f: { filter: ActFilter; take: ActTakeFilter; city: string; q: string; genres: string[] }) => {
    const u = new URLSearchParams(window.location.search);
    for (const k of ["show", "take", "genre", "city", "find"]) u.delete(k);
    if (f.filter !== "shortlist") u.set("show", f.filter);
    if (f.take) u.set("take", f.take);
    for (const g of f.genres) u.append("genre", g);
    if (f.city) u.set("city", f.city);
    if (f.q.trim()) u.set("find", f.q);
    const qs = u.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  };
  const cur = { filter, take, city, q, genres };
  const setFilter = (v: ActFilter) => { setFilterState(v); setShown(ACTS_PAGE); toUrl({ ...cur, filter: v }); };
  const setTake = (v: ActTakeFilter) => { setTakeState(v); setShown(ACTS_PAGE); toUrl({ ...cur, take: v }); };
  const setCity = (v: string) => { setCityState(v); setShown(ACTS_PAGE); toUrl({ ...cur, city: v }); };
  const setQ = (v: string) => { setQState(v); setShown(ACTS_PAGE); toUrl({ ...cur, q: v }); };
  const setGenres = (v: string[]) => { setGenresState(v); setShown(ACTS_PAGE); toUrl({ ...cur, genres: v }); };
  const ours = useOurGenres();
  const genreChoices = useMemo(() => genreOptions(ours, acts.map((a) => a.genres)), [ours, acts]);

  const cities = useMemo(() => [...new Set([...(found?.values() ?? [])].flatMap((f) => f.cities))].sort(), [found]);
  const rows = useMemo(() => {
    const listed = acts.filter((a) => actListed(a, found?.get(a.id), takes.get(a.id), { filter, take, city: city || undefined, q, genres }));
    return listed.sort((x, y) => (found?.get(x.id)?.next?.date ?? "9999").localeCompare(found?.get(y.id)?.next?.date ?? "9999") || x.name.localeCompare(y.name));
  }, [acts, found, takes, filter, take, city, q, genres]);
  const loading = dataLoading;
  // Back from an act's page: the same pages open and the same scroll.
  useListMemory(shown, setShown, !loading);
  const page = rows.slice(0, shown);
  const left = rows.length - page.length;
  // Not a fit only takes the act off this list when the list hides them: not while searching or filtering to Not a fit.
  const dismissed = choices.dismissed && !q.trim() && take !== "notFit" ? choices.dismissed : null;

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

  return (
    <div className="grid min-w-0 gap-3" data-testid="acts-tab">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter acts">
        <select className="select !w-auto" value={filter} onChange={(e) => setFilter(e.target.value as ActFilter)} aria-label="Which acts" data-testid="acts-filter">
          {ACT_FILTERS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select className="select !w-auto" value={take} onChange={(e) => setTake(e.target.value as ActTakeFilter)} aria-label="Our take" data-testid="acts-take-filter">
          {TAKE_FILTERS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <CheckFilter label="Genre" all="Any genre" noun="genres" value={genres} onChange={setGenres} testid="acts-genre"
          groups={[{ label: genreChoices.ours.length ? "Our genres" : undefined, options: genreChoices.ours.map((g) => ({ key: g, label: g })) }, { label: genreChoices.ours.length ? "Other genres" : undefined, options: genreChoices.rest.map((g) => ({ key: g, label: g })) }]} />
        <label className="sr-only" htmlFor="acts-city">City</label>
        <select id="acts-city" className="select !w-auto" value={city} onChange={(e) => setCity(e.target.value)} data-testid="acts-city">
          <option value="">Any city</option>
          {(city && !cities.includes(city) ? [city, ...cities] : cities).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="flex-auto" />
        {toLookUp && (
          <button type="button" className="btn soft sm" disabled={shortlistLookup.busy} onClick={() => void lookUpShortlist()} data-testid="acts-lookup-shortlist">
            {shortlistLookup.busy ? "Looking up…" : "Look up watched acts"}
          </button>
        )}
        <label className="sr-only" htmlFor="acts-q">Find an act</label>
        <input id="acts-q" className="input !min-h-9 !w-[220px]" type="search" placeholder="Find an act…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="acts-q" />
      </div>
      <ErrorBox error={error ?? choices.error ?? shortlistLookup.error} />
      {dismissed && (
        <div className="s flex flex-wrap items-center gap-2" role="status" data-testid="acts-dismissed">
          <span><b>{dismissed.row.name}</b> is hidden as not a fit.</span>
          <button type="button" className="btn ghost sm" disabled={choices.busy} onClick={() => void choices.undo()} data-testid="acts-undo">Undo</button>
        </div>
      )}
      {lookupStatus && <span className="s" data-testid="acts-lookup-status">{lookupStatus}</span>}
      {loading && <span className="s">Loading…</span>}
      {!loading && rows.length === 0 && (
        <div className="empty" data-testid="acts-empty"><span>{filter === "shortlist" && !take && !q && !city ? "You aren't watching any acts yet. Tap an act's star to watch it." : filter === "known" && !take && !q && !city && !genres.length ? "No acts marked yet. Tick We know on an act you know." : "Nothing matches."}</span></div>
      )}
      {!loading && rows.length > 0 && <ActsTable rows={page} found={found} takes={takes} choices={choices} />}
      {!loading && left > 0 && (
        <button type="button" className="btn ghost justify-self-center" onClick={() => setShown((n) => n + ACTS_PAGE)} data-testid="acts-more">
          Load more ({left} left)
        </button>
      )}
      <p className="s m-0" data-testid="table-caption">Every act seen on a venue calendar, plus any you add. &quot;Opened at our rooms&quot; means they played support at a venue on our list. &quot;On tour&quot; means 2+ Colorado dates within a few weeks.</p>
    </div>
  );
}
