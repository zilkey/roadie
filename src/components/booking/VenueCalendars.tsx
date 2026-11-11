"use client";
/**
 * Booking's Venue calendars tab: every venue's upcoming shows (venueEvents, issue #60) in one list, soonest first, to find opener
 * slots to pitch. No design-canvas board exists for it: it is a Booking table like the other tabs, and each row's pieces are the
 * venue Events tab's (VenueEventBits). The venue name opens that venue's Events tab.
 *
 * Paging is a live Firestore query (date in the picked range, from today on, ordered by date) whose limit grows by a page per
 * "Load more": every band user may read venueEvents, a range and an order on the same field need no composite index, and a
 * refresh anywhere shows up without a reload. "gone" shows (dropped off a calendar) and the filters (Likely needs an opener, Hide
 * "not a fit", region) are applied on the client, so a page can come up short; "Load more" still reads further.
 * The filters are remembered per viewer on this device (localStorage, like the stage plot paper size).
 */
import { useEffect, useMemo, useState } from "react";
import Link, { useArtist } from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import { clientAuth } from "@/lib/firebase-client";
import { ErrorBox, PickChip } from "@/components/ui";
import { hrefFor, useBooking } from "@/components/booking/common";
import { EventActs, EventBadges, EventPoster, OpenerNote, TakePicker, TicketLink } from "@/components/booking/VenueEventBits";
import { byWhen, eventTime, fmtEventDay, isUpcoming, openerChance, titleSaysMore } from "@/lib/venueEvents";
import { REGION_LABEL, type Region } from "@/lib/regions";
import { dateInBandZone } from "@/lib/timezone";
import type { VenueEvent, VenueEventNote, VenueEventSource } from "@/schema";

/** Shows per page. e2e sets a small one (NEXT_PUBLIC_VENUE_CALENDARS_PAGE) so its three fixture shows span two pages. */
export const CALENDARS_PAGE = Number(process.env.NEXT_PUBLIC_VENUE_CALENDARS_PAGE) || 50;

export interface CalendarFilter { likely: boolean; hideNotFit: boolean; region: Region | ""; from: string; to: string }
const NO_FILTER: CalendarFilter = { likely: false, hideNotFit: false, region: "", from: "", to: "" };
const filterKey = () => `venueCalendarsFilter:${clientAuth().currentUser?.uid ?? "anon"}`;

/** [filter, setFilter]: remembered per signed-in viewer on this device (read after mount, so the first render matches the server). */
function useCalendarFilter(): [CalendarFilter, (f: CalendarFilter) => void] {
  const [f, set] = useState<CalendarFilter>(NO_FILTER);
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(filterKey()) ?? "null"); if (v && typeof v === "object") set({ ...NO_FILTER, ...v }); } catch { /* nothing remembered */ }
  }, []);
  return [f, (v) => { set(v); try { localStorage.setItem(filterKey(), JSON.stringify(v)); } catch { /* private mode: lasts for this page */ } }];
}

export function VenueCalendars() {
  const { artistId } = useArtist();
  const b = useBooking();
  const today = dateInBandZone();
  // `pages` is how many pages the viewer asked for; `limit` is how far the query reads, grown past that when the filters hide rows.
  const [pages, setPages] = useState(1);
  const [limit, setLimit] = useState(CALENDARS_PAGE);
  const [f, setF] = useCalendarFilter();
  const from = f.from > today ? f.from : today;
  const where: [string, "<=" | ">=", string][] = [["date", ">=", from], ...(f.to ? [["date", "<=", f.to] as [string, "<=", string]] : [])];
  const events = useCollection<VenueEvent>("venueEvents", { where, order: ["date", "asc"], limit, includeDeleted: true });
  const sources = useCollection<VenueEventSource>("venueEventSources", { includeDeleted: true });
  const notes = useCollection<VenueEventNote>("venueEventNotes", { where: [["artistId", "==", artistId]] });
  const takes = useMemo(() => new Map((notes.rows ?? []).map((n) => [n.eventId, n])), [notes.rows]);
  const records = useMemo(() => new Map((sources.rows ?? []).map((r) => [r.venueId, r])), [sources.rows]);
  const venues = useMemo(() => new Map(b.venues.map((v) => [v.id, v])), [b.venues]);
  // A bigger limit keeps the rows on screen until the new snapshot lands (useCollection keeps its last rows); a page that came
  // back full may have more behind it.
  const raw = events.rows;
  const upcoming = useMemo(() => (raw ?? []).filter((e) => isUpcoming(e, today)).sort(byWhen), [raw, today]);
  const rows = useMemo(() => upcoming.filter((e) => {
    if (f.hideNotFit && takes.get(e.id)?.take === "notFit") return false;
    if (f.likely && openerChance(e, records.get(e.venueId), today).chance !== "likely") return false;
    if (f.region) { const v = venues.get(e.venueId); if (v?.region !== f.region) return false; }
    return true;
  }), [upcoming, f, takes, records, venues, today]);
  // The limit `raw` was read with: a new limit keeps the last rows on screen until its snapshot lands.
  const [readFor, setReadFor] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (raw) setReadFor(limit); }, [raw]);
  const pending = !raw || readFor !== limit;
  const readAll = !pending && raw.length < limit;
  const want = pages * CALENDARS_PAGE;
  // Filters hide rows on the client: read on, a page at a time, until a page's worth shows or the calendars run out.
  useEffect(() => { if (!pending && !readAll && rows.length < want) setLimit((n) => n + CALENDARS_PAGE); }, [pending, readAll, rows.length, want]);
  const shown = rows.slice(0, want);
  const hasMore = rows.length > want || (!!raw && !readAll);
  const filling = !!raw && !readAll && rows.length < want;
  const filtering = f.likely || f.hideNotFit || !!f.region || !!f.from || !!f.to;
  const change = (patch: Partial<CalendarFilter>) => { setF({ ...f, ...patch }); setPages(1); setLimit(CALENDARS_PAGE); };

  return (
    <div className="grid min-w-0 gap-3" data-testid="venue-calendars">
      <div className="flex flex-wrap items-center gap-2" data-testid="calendar-filters">
        <PickChip on={f.likely} onToggle={() => change({ likely: !f.likely })} testid="calendar-filter-likely">Likely needs an opener</PickChip>
        <PickChip on={f.hideNotFit} onToggle={() => change({ hideNotFit: !f.hideNotFit })} testid="calendar-filter-notfit">Hide &ldquo;not a fit&rdquo;</PickChip>
        <select className="select w-auto" value={f.region} onChange={(e) => change({ region: e.target.value as Region | "" })} aria-label="Filter shows by region" data-testid="calendar-filter-region">
          <option value="">All regions</option>
          {(Object.keys(REGION_LABEL) as Region[]).map((r) => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}
        </select>
        <label className="flex items-center gap-1 text-sm"><span className="s">From</span>
          <input type="date" className="input !w-auto" value={f.from} min={today} onChange={(e) => change({ from: e.target.value })} aria-label="Shows from" data-testid="calendar-filter-from" /></label>
        <label className="flex items-center gap-1 text-sm"><span className="s">to</span>
          <input type="date" className="input !w-auto" value={f.to} min={from} onChange={(e) => change({ to: e.target.value })} aria-label="Shows until" data-testid="calendar-filter-to" /></label>
        {filtering && <button type="button" className="btn ghost sm" onClick={() => change(NO_FILTER)} data-testid="calendar-filter-clear">Clear filters</button>}
      </div>
      <ErrorBox error={events.error} />
      {(!raw || filling) && !events.error && <span className="s">Loading…</span>}
      {raw && readAll && upcoming.length === 0 && !filtering && <div className="empty" data-testid="venue-calendars-empty"><span>No upcoming shows on any venue&apos;s calendar yet. Set a venue&apos;s calendar up on its Events tab.</span></div>}
      {raw && readAll && rows.length === 0 && filtering && <div className="empty" data-testid="venue-calendars-none"><span>No upcoming shows match these filters.</span></div>}
      {shown.length > 0 && (
        <div className="book-tw">
          <table className="book-table wn">
            <thead><tr>
              <th aria-label="Poster" />
              <th className="nw">Date</th>
              <th className="name">Show</th>
              <th>Venue</th>
              <th>City</th>
              <th>Our take</th>
            </tr></thead>
            <tbody>
              {shown.map((e) => {
                const v = venues.get(e.venueId), time = eventTime(e);
                return (
                  <tr key={e.id} data-testid={`calendar-show-${e.id}`}>
                    <td className="w-14"><EventPoster src={e.imageUrl} alt={e.title} size={48} testid="calendar-show-poster" /></td>
                    <td className="nw" data-testid="calendar-show-date"><b>{fmtEventDay(e.date)}</b>{time && <span className="sub">{time}</span>}</td>
                    <td className="name">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><EventActs e={e} /><EventBadges e={e} stats={records.get(e.venueId)} today={today} /></div>
                      {titleSaysMore(e) && <span className="sub">{e.title}</span>}
                      {e.ticketUrl && <span className="sub"><TicketLink e={e} /></span>}
                    </td>
                    <td>{v ? <Link href={`${hrefFor("venue", v.id)}?tab=events`} className="nm" data-testid={`calendar-show-venue-${e.id}`}>{v.name}</Link> : <span className="dash">—</span>}</td>
                    <td className="nw">{v?.address.city || <span className="dash">—</span>}</td>
                    <td><TakePicker e={e} take={takes.get(e.id)} artistId={artistId} label={false} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {shown.length > 0 && <p className="s" data-testid="table-caption">Every venue&apos;s upcoming shows, read from its own calendar. A venue&apos;s name opens its Events tab, where Refresh reads the calendar again. <OpenerNote /></p>}
      {hasMore && !filling && (
        <button type="button" className="btn ghost justify-self-center" onClick={() => { setPages((n) => n + 1); if (rows.length <= want + CALENDARS_PAGE) setLimit((n) => n + CALENDARS_PAGE); }} data-testid="venue-calendars-more">
          Load more
        </button>
      )}
    </div>
  );
}
