"use client";
/**
 * Booking's Venue calendars tab: every venue's upcoming shows (venueEvents, issue #60) in one list, soonest first, to find opener
 * slots to pitch. Each row's pieces are the venue Events tab's (VenueEventBits); the venue name opens that venue's Events tab. The
 * filter row follows the booking canvas board CalendarsPitch: three pills, one on at a time (Likely needs an opener, the default;
 * Hide "not a fit"; All shows), a region and a "When" (Next month, Next 3 months, the default, or Any time), with the opener
 * disclaimer under it.
 *
 * Paging is a live Firestore query (date from today to the "When" limit, ordered by date) whose limit grows by a page per
 * "Load more": every band user may read venueEvents, a range and an order on the same field need no composite index, and a
 * refresh anywhere shows up without a reload. "gone" shows (dropped off a calendar), the pills and the region are applied on the
 * client, so a page can come up short; "Load more" still reads further.
 * The filters are remembered per viewer on this device (localStorage, like the stage plot paper size).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link, { useArtist } from "@/lib/artist";
import { useCollection, useDocs } from "@/lib/firestore-hooks";
import { runCommand } from "@/lib/commands";
import { clientAuth } from "@/lib/firebase-client";
import { ErrorBox } from "@/components/ui";
import { hrefFor, useBooking } from "@/components/booking/common";
import { EventActs, EventBadges, EventPoster, OPENER_DISCLAIMER, TakePicker, TicketLink, type Ev } from "@/components/booking/VenueEventBits";
import { PitchShowDialog, PitchThisButton, type PitchShow } from "@/components/booking/PitchShowDialog";
import { useOurGenres } from "@/components/booking/useOurGenres";
import { byWhen, CALENDAR_WHEN, eventTime, fmtEventDay, isUpcoming, nextCalendarLimit, openerChance, titleSaysMore, whenUntil, type CalendarWhen } from "@/lib/venueEvents";
import { REGION_LABEL, type Region } from "@/lib/regions";
import { dateInBandZone } from "@/lib/timezone";
import type { ActDoc, VenueEvent, VenueEventNote, VenueEventSource } from "@/schema";

/** Shows per page. e2e sets a small one (NEXT_PUBLIC_VENUE_CALENDARS_PAGE) so its three fixture shows span two pages. */
export const CALENDARS_PAGE = Number(process.env.NEXT_PUBLIC_VENUE_CALENDARS_PAGE) || 50;

/** Which shows: likely opener slots only, everything but "not a fit", or all of them. */
export type CalendarShow = "likely" | "hide" | "all";
const SHOW_PILLS: [CalendarShow, string][] = [["likely", "Likely needs an opener"], ["hide", "Hide \u201cnot a fit\u201d"], ["all", "All shows"]];
export interface CalendarFilter { show: CalendarShow; region: Region | ""; when: CalendarWhen }
const DEFAULT_FILTER: CalendarFilter = { show: "likely", region: "", when: "3m" };
/** A remembered filter, with anything unknown (an older shape, a region since removed) back to the default. */
function readFilter(v: unknown): CalendarFilter {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    show: SHOW_PILLS.some(([k]) => k === o.show) ? o.show as CalendarShow : DEFAULT_FILTER.show,
    region: typeof o.region === "string" && o.region in REGION_LABEL ? o.region as Region : "",
    when: CALENDAR_WHEN.some(([k]) => k === o.when) ? o.when as CalendarWhen : DEFAULT_FILTER.when,
  };
}
const filterKey = () => `venueCalendarsFilter:${clientAuth().currentUser?.uid ?? "anon"}`;

/** [filter, setFilter]: remembered per signed-in viewer on this device (read after mount, so the first render matches the server). */
function useCalendarFilter(): [CalendarFilter, (f: CalendarFilter) => void] {
  const [f, set] = useState<CalendarFilter>(DEFAULT_FILTER);
  useEffect(() => {
    try { const v = localStorage.getItem(filterKey()); if (v) set(readFilter(JSON.parse(v))); } catch { /* nothing remembered */ }
  }, []);
  return [f, (v) => { set(v); try { localStorage.setItem(filterKey(), JSON.stringify(v)); } catch { /* private mode: lasts for this page */ } }];
}

/**
 * "New since you last looked" (#79), per viewer: when they last opened this tab (venueEvents.looked, userPrefs), read once on
 * mount, so the chips stay put while they look. Null on their first look: nothing is new then.
 */
function useLastLooked(): string | null {
  const [since, setSince] = useState<string | null>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    runCommand<{ previous: string | null }>("venueEvents.looked", {}).then((r) => setSince(r.previous), () => undefined);
  }, []);
  return since;
}

/**
 * The looked-up genres of these acts, for genre fit (#79). The map only grows (a bigger read keeps what the last one found), so
 * the "Likely" filter doesn't drop rows while a new set of acts loads.
 */
function useActGenres(ids: string[], skip: boolean): Map<string, string[] | undefined> {
  const { rows } = useDocs<ActDoc>("acts", ids, { skip });
  const [map, setMap] = useState<Map<string, string[] | undefined>>(() => new Map());
  useEffect(() => {
    setMap((m) => {
      const changed = rows.filter((r) => !m.has(r.id) || (m.get(r.id) ?? []).join("|") !== (r.genres ?? []).join("|"));
      if (!changed.length) return m;
      const n = new Map(m);
      for (const r of changed) n.set(r.id, r.genres);
      return n;
    });
  }, [rows]);
  return map;
}

export function VenueCalendars() {
  const { artistId } = useArtist();
  const b = useBooking();
  const today = dateInBandZone();
  // `pages` is how many pages the viewer asked for; `limit` is how far the query reads, grown past that when the filters hide rows.
  const [pages, setPages] = useState(1);
  const [limit, setLimit] = useState(CALENDARS_PAGE);
  const [f, setF] = useCalendarFilter();
  const until = whenUntil(today, f.when);
  const where: [string, "<=" | ">=", string][] = [["date", ">=", today], ...(until ? [["date", "<=", until] as [string, "<=", string]] : [])];
  const events = useCollection<VenueEvent>("venueEvents", { where, order: ["date", "asc"], limit, includeDeleted: true, waitForServer: true });
  const sources = useCollection<VenueEventSource>("venueEventSources", { includeDeleted: true });
  const notes = useCollection<VenueEventNote>("venueEventNotes", { where: [["artistId", "==", artistId]] });
  const takes = useMemo(() => new Map((notes.rows ?? []).map((n) => [n.eventId, n])), [notes.rows]);
  const records = useMemo(() => new Map((sources.rows ?? []).map((r) => [r.venueId, r])), [sources.rows]);
  const venues = useMemo(() => new Map(b.venues.map((v) => [v.id, v])), [b.venues]);
  // A bigger limit keeps the rows on screen until the new snapshot lands (useCollection keeps its last rows); a page that came
  // back full may have more behind it.
  const raw = events.rows;
  const upcoming = useMemo(() => (raw ?? []).filter((e) => isUpcoming(e, today)).sort(byWhen), [raw, today]);
  // Genre fit: only read the headliners' acts when the band has genres of its own to compare.
  const ours = useOurGenres();
  const headIds = useMemo(() => [...new Set(upcoming.flatMap((e) => e.acts.filter((a) => a.role === "headliner" && a.actId).map((a) => a.actId!)))], [upcoming]);
  const actGenres = useActGenres(headIds, !ours.length);
  const genres = useMemo(() => (ours.length ? { ours, acts: actGenres } : null), [ours, actGenres]);
  const rows = useMemo(() => upcoming.filter((e) => {
    if (f.show === "hide" && takes.get(e.id)?.take === "notFit") return false;
    if (f.show === "likely" && openerChance(e, records.get(e.venueId), today, genres).chance !== "likely") return false;
    if (f.region) { const v = venues.get(e.venueId); if (v?.region !== f.region) return false; }
    return true;
  }), [upcoming, f, takes, records, venues, today, genres]);
  const since = useLastLooked();
  const [pitching, setPitching] = useState<PitchShow | null>(null);
  const openPitch = (e: Ev) => setPitching({ e, venueName: venues.get(e.venueId)?.name ?? "the venue" });
  // The limit the server answered `raw` for. A new limit keeps the last rows on screen until its snapshot lands, and its first
  // snapshot may come from the cache with only the last read's shows: that one must not count, or it reads as "that's all" (the
  // empty "match" note flashed once a round in prod).
  const [readFor, setReadFor] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (raw && !events.fromCache) setReadFor(limit); }, [raw, events.fromCache]);
  const pending = !raw || readFor !== limit;
  const readAll = !pending && raw.length < limit;
  const want = pages * CALENDARS_PAGE;
  // Filters hide rows on the client: read on until a page's worth shows or the calendars run out.
  useEffect(() => {
    const next = nextCalendarLimit(limit, pending ? null : raw.length, rows.length, want);
    if (next !== limit) setLimit(next);
  }, [pending, raw, limit, rows.length, want]);
  const shown = rows.slice(0, want);
  const hasMore = rows.length > want || (!!raw && !readAll);
  const filling = !!raw && !readAll && rows.length < want;
  // A filter change shows "Loading…" until its first page is all there, then the table once; Load more keeps the table up.
  const settling = filling && pages === 1;
  const filtering = f.show !== "all" || !!f.region || f.when !== "any";
  const change = (patch: Partial<CalendarFilter>) => { setF({ ...f, ...patch }); setPages(1); setLimit(CALENDARS_PAGE); };

  return (
    <div className="grid min-w-0 gap-3" data-testid="venue-calendars">
      <div className="grid gap-1.5">
        <div className="filter-bar" role="group" aria-label="Filter shows" data-testid="calendar-filters">
          {SHOW_PILLS.map(([k, label]) => (
            <button key={k} type="button" className="pick" aria-pressed={f.show === k} onClick={() => change({ show: k })} data-testid={`calendar-filter-${k}`}>{label}</button>
          ))}
          <select className="select" value={f.region} onChange={(e) => change({ region: e.target.value as Region | "" })} aria-label="Region" data-testid="calendar-filter-region">
            <option value="">Anywhere</option>
            {(Object.keys(REGION_LABEL) as Region[]).map((r) => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}
          </select>
          <select className="select" value={f.when} onChange={(e) => change({ when: e.target.value as CalendarWhen })} aria-label="When" data-testid="calendar-filter-when">
            {CALENDAR_WHEN.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        <p className="s" data-testid="opener-disclaimer">Opener chance is {OPENER_DISCLAIMER.charAt(0).toLowerCase() + OPENER_DISCLAIMER.slice(1)} Hover a badge for why.</p>
      </div>
      <ErrorBox error={events.error} />
      {raw && readAll && upcoming.length === 0 && !filtering && <div className="empty" data-testid="venue-calendars-empty"><span>No upcoming shows on any venue&apos;s calendar yet. Set a venue&apos;s calendar up on its Events tab.</span></div>}
      {raw && readAll && rows.length === 0 && filtering && <div className="empty" data-testid="venue-calendars-none"><span>No upcoming shows match these filters.</span></div>}
      {shown.length > 0 && !settling && (
        <div className="book-tw">
          <table className="book-table wn">
            <thead><tr>
              <th aria-label="Poster" />
              <th className="nw">Date</th>
              <th className="name">Show</th>
              <th>Venue</th>
              <th>City</th>
              <th>Our take</th>
              <th><span className="sr-only">Pitch</span></th>
            </tr></thead>
            <tbody>
              {shown.map((e) => {
                const v = venues.get(e.venueId), time = eventTime(e);
                return (
                  <tr key={e.id} data-testid={`calendar-show-${e.id}`}>
                    <td className="w-14"><EventPoster src={e.imageUrl} alt={e.title} size={48} testid="calendar-show-poster" /></td>
                    <td className="nw" data-testid="calendar-show-date"><b>{fmtEventDay(e.date)}</b>{time && <span className="sub">{time}</span>}</td>
                    <td className="name">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><EventActs e={e} /><EventBadges e={e} stats={records.get(e.venueId)} today={today} genres={genres} isNew={!!since && e.firstSeenAt > since} /></div>
                      {titleSaysMore(e) && <span className="sub">{e.title}</span>}
                      {e.ticketUrl && <span className="sub"><TicketLink e={e} /></span>}
                    </td>
                    <td>{v ? <Link href={`${hrefFor("venue", v.id)}?tab=events`} className="nm" data-testid={`calendar-show-venue-${e.id}`}>{v.name}</Link> : <span className="dash">—</span>}</td>
                    <td className="nw">{v?.address.city || <span className="dash">—</span>}</td>
                    <td><TakePicker e={e} take={takes.get(e.id)} artistId={artistId} label={false} /></td>
                    <td className="text-right">{takes.get(e.id)?.take !== "pitched" && <PitchThisButton e={e} onOpen={openPitch} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {(!raw || filling) && !events.error && <span className="s" data-testid="venue-calendars-loading">Loading…</span>}
      {shown.length > 0 && !settling && <p className="s" data-testid="table-caption">Every venue&apos;s upcoming shows, read from its own calendar. A venue&apos;s name opens its Events tab, where Refresh reads the calendar again.</p>}
      <PitchShowDialog show={pitching} onClose={() => setPitching(null)} />
      {hasMore && !filling && (
        <button type="button" className="btn ghost justify-self-center" onClick={() => { setPages((n) => n + 1); if (rows.length <= want + CALENDARS_PAGE) setLimit((n) => n + CALENDARS_PAGE); }} data-testid="venue-calendars-more">
          Load more
        </button>
      )}
    </div>
  );
}
