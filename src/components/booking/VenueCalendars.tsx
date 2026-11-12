"use client";
/**
 * Booking's Venue calendars tab: every venue's upcoming shows (venueEvents, issue #60) in one list, furthest out first (an
 * opener slot six months out is likelier to land than one in a few days), to find opener slots to pitch. Each row's pieces are the
 * venue Events tab's (VenueEventBits); the venue name opens that venue's Events tab. The filters are the Events tab's
 * (ShowFilterBar: Likely needs an opener or All shows, Hide "not a fit", the main act's genres, When) plus a region, with the
 * opener disclaimer under them. They add up, and they ride in the URL so a link sends the exact list (the Acts tab's way):
 * ?show=, ?notfit=, ?genre= and ?when= (showFilterToParams) and ?region=, defaults left out. They're written with
 * history.replaceState, which the App Router picks up without a navigation. Back from a venue's page steps back to that URL, and
 * useListMemory opens as many pages as were open and scrolls back to where it was.
 *
 * Paging is a live Firestore query (date from the "When" start on, latest date first) whose limit grows by a page per
 * "Load more": every band user may read venueEvents, a range and an order on the same field need no composite index, and a
 * refresh anywhere shows up without a reload. "gone" shows (dropped off a calendar) and the filters are applied on the client, so
 * a page can come up short; "Load more" still reads further. Genres come from every act (the Acts tab reads the same).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link, { useArtist } from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import { runCommand } from "@/lib/commands";
import { ErrorBox } from "@/components/ui";
import { hrefFor, useBooking } from "@/components/booking/common";
import { ActLinksLine, EventActs, EventBadges, EventPoster, OPENER_DISCLAIMER, ShowActions, ShowNote, TicketLink } from "@/components/booking/VenueEventBits";
import { useOurGenres } from "@/components/booking/useOurGenres";
import { useSearchParams } from "next/navigation";
import { CalendarShowsTable } from "@/components/booking/CalendarShowsTable";
import { FlagCampaignSelect } from "@/components/booking/FlagCampaign";
import { useListMemory } from "@/lib/listMemory";
import { ShowFilterBar } from "@/components/booking/ShowFilters";
import { eventTime, fmtEventDay, genreOptions, isUpcoming, latestFirst, nextCalendarLimit, openerChance, showActLinks, showFilterFromParams, showFilterToParams, showListed, titleSaysMore, whenFrom, type ShowFilter } from "@/lib/venueEvents";
import { REGION_LABEL, type Region } from "@/lib/regions";
import { dateInBandZone } from "@/lib/timezone";
import type { ActDoc, VenueEvent, VenueEventNote, VenueEventSource } from "@/schema";

/** Shows per page. e2e sets a small one (NEXT_PUBLIC_VENUE_CALENDARS_PAGE) so its three fixture shows span two pages. */
export const CALENDARS_PAGE = Number(process.env.NEXT_PUBLIC_VENUE_CALENDARS_PAGE) || 50;

type CalendarFilter = ShowFilter & { region: Region | "" };
/** The region on its own: anything else (a region since removed) is anywhere. */
const regionOf = (r: string): Region | "" => (r in REGION_LABEL ? r as Region : "");

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

export function VenueCalendars() {
  const { artistId } = useArtist();
  const b = useBooking();
  const today = dateInBandZone();
  // `pages` is how many pages the viewer asked for; `limit` is how far the query reads, grown past that when the filters hide rows.
  const [pages, setPages] = useState(1);
  const [limit, setLimit] = useState(CALENDARS_PAGE);
  const params = useSearchParams();
  const [f, setF] = useState<CalendarFilter>(() => ({ ...showFilterFromParams(params), region: regionOf(params.get("region") ?? "") }));
  const from = whenFrom(today, f.when);
  const events = useCollection<VenueEvent>("venueEvents", { where: [["date", ">=", from]], order: ["date", "desc"], limit, includeDeleted: true, waitForServer: true });
  const sources = useCollection<VenueEventSource>("venueEventSources", { includeDeleted: true });
  const notes = useCollection<VenueEventNote>("venueEventNotes", { where: [["artistId", "==", artistId]] });
  const takes = useMemo(() => new Map((notes.rows ?? []).map((n) => [n.eventId, n])), [notes.rows]);
  const records = useMemo(() => new Map((sources.rows ?? []).map((r) => [r.venueId, r])), [sources.rows]);
  const venues = useMemo(() => new Map(b.venues.map((v) => [v.id, v])), [b.venues]);
  // A bigger limit keeps the rows on screen until the new snapshot lands (useCollection keeps its last rows); a page that came
  // back full may have more behind it.
  const raw = events.rows;
  const upcoming = useMemo(() => (raw ?? []).filter((e) => isUpcoming(e, today)).sort(latestFirst), [raw, today]);
  // Every act's genres: the genre filter's choices, the main act's genres for it, and genre fit in the opener guess.
  const ours = useOurGenres();
  const acts = useCollection<ActDoc>("acts");
  const actGenres = useMemo(() => new Map((acts.rows ?? []).map((a) => [a.id, a.genres])), [acts.rows]);
  const actLinks = useMemo(() => new Map((acts.rows ?? []).map((a) => [a.id, a.links])), [acts.rows]);
  const genres = useMemo(() => (ours.length ? { ours, acts: actGenres } : null), [ours, actGenres]);
  const genreChoices = useMemo(() => genreOptions(ours, actGenres.values()), [ours, actGenres]);
  const fKey = JSON.stringify(f);
  const rows = useMemo(() => upcoming.filter((e) => {
    if (f.region && venues.get(e.venueId)?.region !== f.region) return false;
    return showListed(e, f, { from, take: takes.get(e.id)?.take, acts: actGenres, chance: () => openerChance(e, records.get(e.venueId), today, genres).chance });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [upcoming, fKey, from, takes, records, venues, today, genres, actGenres]);
  const since = useLastLooked();
  // The limit the server answered `raw` for. A new limit keeps the last rows on screen until its snapshot lands, and its first
  // snapshot may come from the cache with only the last read's shows: that one must not count, or it reads as "that's all" (the
  // empty "match" note flashed once a round in prod).
  const [readFor, setReadFor] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (raw && !events.fromCache) setReadFor(limit); }, [raw, events.fromCache]);
  // Until the acts are in, the genre filters can't tell: don't read on looking for matches.
  const pending = !raw || readFor !== limit || !acts.rows;
  const readAll = !pending && raw.length < limit;
  const want = pages * CALENDARS_PAGE;
  // Filters hide rows on the client: read on until a page's worth shows or the calendars run out.
  useEffect(() => {
    const next = nextCalendarLimit(limit, pending ? null : raw.length, rows.length, want);
    if (next !== limit) setLimit(next);
  }, [pending, raw, limit, rows.length, want]);
  const shown = rows.slice(0, want);
  const hasMore = rows.length > want || (!!raw && !readAll);
  const filling = (!!raw && !readAll && rows.length < want) || (!!raw && !acts.rows);
  // A filter change shows "Loading…" until its first page is all there, then the table once; Load more keeps the table up.
  const settling = filling && pages === 1;
  // Back from a venue's page: the same pages open (the limit reads on to them) and the same scroll.
  useListMemory(pages, setPages, !!raw && !filling);
  const change = (patch: Partial<CalendarFilter>) => {
    const next = { ...f, ...patch };
    setF(next); setPages(1); setLimit(CALENDARS_PAGE);
    const u = showFilterToParams(new URLSearchParams(window.location.search), next);
    if (next.region) u.set("region", next.region); else u.delete("region");
    const qs = u.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  };

  return (
    <div className="grid min-w-0 gap-3" data-testid="venue-calendars">
      <div className="grid gap-1.5">
        <ShowFilterBar f={f} onChange={change} genres={genreChoices} canTake testid="calendar-filter">
          <select className="select" value={f.region} onChange={(e) => change({ region: e.target.value as Region | "" })} aria-label="Region" data-testid="calendar-filter-region">
            <option value="">Anywhere</option>
            {(Object.keys(REGION_LABEL) as Region[]).map((r) => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}
          </select>
          <FlagCampaignSelect />
        </ShowFilterBar>
        <p className="s" data-testid="opener-disclaimer">Opener chance is {OPENER_DISCLAIMER.charAt(0).toLowerCase() + OPENER_DISCLAIMER.slice(1)} Hover a badge for why.</p>
      </div>
      <ErrorBox error={events.error ?? acts.error} />
      {raw && readAll && upcoming.length === 0 && f.when === "any" && <div className="empty" data-testid="venue-calendars-empty"><span>No upcoming shows on any venue&apos;s calendar yet. Set a venue&apos;s calendar up on its Events tab.</span></div>}
      {raw && readAll && !filling && rows.length === 0 && (upcoming.length > 0 || f.when !== "any") && <div className="empty" data-testid="venue-calendars-none"><span>No upcoming shows match these filters.</span></div>}
      {shown.length > 0 && !settling && (
        <CalendarShowsTable shows={shown} venues={venues} takes={takes} pitches={b.pitches} records={records} today={today} genres={genres} actGenres={actGenres} actLinks={actLinks} since={since} />
      )}
      {(!raw || filling) && !events.error && <span className="s" data-testid="venue-calendars-loading">Loading…</span>}
      {shown.length > 0 && !settling && <p className="s" data-testid="table-caption">Every venue&apos;s upcoming shows, furthest out first, read from its own calendar. A venue&apos;s name opens its Events tab, where Refresh reads the calendar again.</p>}
      {hasMore && !filling && (
        <button type="button" className="btn ghost justify-self-center" onClick={() => { setPages((n) => n + 1); if (rows.length <= want + CALENDARS_PAGE) setLimit((n) => n + CALENDARS_PAGE); }} data-testid="venue-calendars-more">
          Load more
        </button>
      )}
    </div>
  );
}
