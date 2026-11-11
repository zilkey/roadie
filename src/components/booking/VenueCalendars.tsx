"use client";
/**
 * Booking's Venue calendars tab: every venue's upcoming shows (venueEvents, issue #60) in one list, soonest first, to find opener
 * slots to pitch. No design-canvas board exists for it: it is a Booking table like the other tabs, and each row's pieces are the
 * venue Events tab's (VenueEventBits). The venue name opens that venue's Events tab.
 *
 * Paging is a live Firestore query (date >= today, ordered by date) whose limit grows by a page per "Load more": every band user
 * may read venueEvents, a range and an order on the same field need no composite index, and a refresh anywhere shows up without
 * a reload. "gone" shows (dropped off a calendar) are left out on the client, so a page can come up a row or two short.
 */
import { useMemo, useState } from "react";
import Link, { useArtist } from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import { ErrorBox } from "@/components/ui";
import { hrefFor, useBooking } from "@/components/booking/common";
import { EventActs, EventBadges, TakePicker, TicketLink } from "@/components/booking/VenueEventBits";
import { byWhen, eventTime, fmtEventDay, isUpcoming, titleSaysMore } from "@/lib/venueEvents";
import { dateInBandZone } from "@/lib/timezone";
import type { VenueEvent, VenueEventNote } from "@/schema";

/** Shows per page. e2e sets a small one (NEXT_PUBLIC_VENUE_CALENDARS_PAGE) so its three fixture shows span two pages. */
export const CALENDARS_PAGE = Number(process.env.NEXT_PUBLIC_VENUE_CALENDARS_PAGE) || 50;

export function VenueCalendars() {
  const { artistId } = useArtist();
  const b = useBooking();
  const today = dateInBandZone();
  const [limit, setLimit] = useState(CALENDARS_PAGE);
  const events = useCollection<VenueEvent>("venueEvents", { where: [["date", ">=", today]], order: ["date", "asc"], limit, includeDeleted: true });
  const notes = useCollection<VenueEventNote>("venueEventNotes", { where: [["artistId", "==", artistId]] });
  const takes = useMemo(() => new Map((notes.rows ?? []).map((n) => [n.eventId, n])), [notes.rows]);
  const venues = useMemo(() => new Map(b.venues.map((v) => [v.id, v])), [b.venues]);
  // A bigger limit keeps the rows on screen until the new snapshot lands (useCollection keeps its last rows); a page that came
  // back full may have more behind it.
  const raw = events.rows;
  const rows = useMemo(() => (raw ?? []).filter((e) => isUpcoming(e, today)).sort(byWhen), [raw, today]);
  const hasMore = !!raw && raw.length >= limit;

  return (
    <div className="grid min-w-0 gap-3" data-testid="venue-calendars">
      <ErrorBox error={events.error} />
      {!raw && !events.error && <span className="s">Loading…</span>}
      {raw && rows.length === 0 && <div className="empty" data-testid="venue-calendars-empty"><span>No upcoming shows on any venue&apos;s calendar yet. Set a venue&apos;s calendar up on its Events tab.</span></div>}
      {rows.length > 0 && (
        <div className="book-tw">
          <table className="book-table wn">
            <thead><tr>
              <th className="nw">Date</th>
              <th className="name">Show</th>
              <th>Venue</th>
              <th>City</th>
              <th>Our take</th>
            </tr></thead>
            <tbody>
              {rows.map((e) => {
                const v = venues.get(e.venueId), time = eventTime(e);
                return (
                  <tr key={e.id} data-testid={`calendar-show-${e.id}`}>
                    <td className="nw" data-testid="calendar-show-date"><b>{fmtEventDay(e.date)}</b>{time && <span className="sub">{time}</span>}</td>
                    <td className="name">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><EventActs e={e} /><EventBadges e={e} /></div>
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
      {rows.length > 0 && <p className="s" data-testid="table-caption">Every venue&apos;s upcoming shows, read from its own calendar. A venue&apos;s name opens its Events tab, where Refresh reads the calendar again.</p>}
      {hasMore && (
        <button type="button" className="btn ghost justify-self-center" onClick={() => setLimit((n) => n + CALENDARS_PAGE)} data-testid="venue-calendars-more">
          Load more
        </button>
      )}
    </div>
  );
}
