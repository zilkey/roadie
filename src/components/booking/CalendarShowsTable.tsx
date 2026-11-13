"use client";
/**
 * The shows table of Venue calendars, shared with a venue's Venue events tab (#82, Jeff 2026-11-12: "look and behave like the
 * Venue calendars table, minus the venue"). Columns: the flag and X (Pitch this / Not a fit, admins), the poster, Show (date and
 * time, and the venue and its city unless `showVenue` is off), Act (the bill with its badges, the title when it says more, the
 * ticket link, the main act's genres, the acts' link icons) and Notes (admins).
 */
import Link from "@/lib/artist";
import { hrefFor, type PitchRow } from "@/components/booking/common";
import { ActLinksLine, EventActs, EventBadges, EventPoster, ShowActions, ShowNote, TicketLink, type Ev, type RoomRecord } from "@/components/booking/VenueEventBits";
import { eventTime, fmtEventDay, showActLinks, titleSaysMore, type OpenerCtx } from "@/lib/venueEvents";
import type { ArtistLinkKey, VenueEventNote } from "@/schema";

export interface CalendarShowsProps {
  shows: Ev[];
  venues: ReadonlyMap<string, { id: string; name: string; address: { city?: string } }>;
  takes: ReadonlyMap<string, VenueEventNote>;
  pitches: readonly Pick<PitchRow, "id" | "status" | "campaignId" | "target">[] | readonly { id: string; status: string; campaignId?: string | null; target?: { kind: string; id: string } }[];
  records: ReadonlyMap<string, RoomRecord>;
  today: string;
  genres: OpenerCtx["genres"];
  actGenres: ReadonlyMap<string, string[] | undefined>;
  actLinks: ReadonlyMap<string, Partial<Record<ArtistLinkKey, string>> | undefined>;
  /** When the person last looked (Venue calendars' New chips). */
  since?: string | null;
  showVenue?: boolean;
  admin?: boolean;
}

export function CalendarShowsTable({ shows, venues, takes, pitches, records, today, genres, actGenres, actLinks, since, showVenue = true, admin = true }: CalendarShowsProps) {
  return (
    <div className="book-tw">
      <table className="book-table wn cal">
        <thead><tr>
          {admin && <th className="flag"><span className="sr-only">Pitch this, or not a fit</span></th>}
          <th aria-label="Poster" />
          <th className="nw">Show</th>
          <th className="name">Act</th>
          {admin && <th className="note">Notes</th>}
        </tr></thead>
        <tbody>
          {shows.map((e) => {
            const v = venues.get(e.venueId), time = eventTime(e);
            const main = e.acts.find((a) => a.role === "headliner") ?? e.acts[0];
            const g = (main?.actId && actGenres.get(main.actId)) || [];
            return (
              <tr key={e.id} data-testid={`calendar-show-${e.id}`}>
                {admin && <td className="flag"><ShowActions e={e} take={takes.get(e.id)} pitches={pitches as never} venueName={v?.name ?? "the venue"} /></td>}
                <td className="w-14"><EventPoster src={e.imageUrl} alt={e.title} size={48} testid="calendar-show-poster" /></td>
                <td className="nw" data-testid="calendar-show-date"><b>{fmtEventDay(e.date)}</b>{time && <span className="sub">{time}</span>}
                  {showVenue && (v ? <span className="sub"><Link href={`${hrefFor("venue", v.id)}?tab=events`} className="font-semibold" data-testid={`calendar-show-venue-${e.id}`}>{v.name}</Link></span> : <span className="dash">—</span>)}
                  {showVenue && v?.address.city && <span className="sub whitespace-nowrap" data-testid={`calendar-show-city-${e.id}`}>{v.address.city}</span>}</td>
                <td className="name">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><EventActs e={e} /><EventBadges e={e} stats={records.get(e.venueId) ?? null} today={today} genres={genres} isNew={!!since && e.firstSeenAt > since} /></div>
                  {titleSaysMore(e) && <span className="sub">{e.title}</span>}
                  {g.length > 0 && <span className="sub" data-testid={`calendar-show-genres-${e.id}`}>{g.slice(0, 3).join(" · ")}</span>}
                  {e.ticketUrl && <span className="sub"><TicketLink e={e} /></span>}
                  <ActLinksLine groups={showActLinks(e.acts, actLinks)} eventId={e.id} />
                </td>
                {admin && <td className="note"><ShowNote e={e} take={takes.get(e.id)} /></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
