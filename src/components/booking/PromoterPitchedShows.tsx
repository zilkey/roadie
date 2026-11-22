"use client";
import { useMemo } from "react";
import { useArtist, useZone } from "@/lib/artist";
import { useCollection, useDocs } from "@/lib/firestore-hooks";
import { DetailCard } from "@/components/booking/DetailCards";
import { CalendarShowsTable } from "@/components/booking/CalendarShowsTable";
import { isActive } from "@/lib/booking";
import { byWhen, isUpcoming } from "@/lib/venueEvents";
import { dateInZone } from "@/lib/timezone";
import type { LineupAct } from "@/components/booking/VenueEventBits";
import type { ActDoc, Venue, VenueEvent, VenueEventNote } from "@/schema";

/**
 * A promoter's Pitch tab (Jeff, 2026-11-22): the upcoming shows we pitched ("Pitch this") at any venue the promoter books for us,
 * soonest first. Each show sits on its venue's own pitch; the flag here is the same flag as Venue calendars'.
 */
export function PromoterPitchedShows({ venues }: { venues: (Venue & { id: string })[] }) {
  const { artistId } = useArtist();
  const zone = useZone();
  const today = dateInZone(zone);
  // Firestore's "in" takes at most 30 values; a promoter books far fewer rooms for us.
  const ids = useMemo(() => venues.map((v) => v.id).sort().slice(0, 30), [venues]);
  const none = ids.length === 0;
  const notes = useCollection<VenueEventNote>("venueEventNotes", { where: [["artistId", "==", artistId], ["venueId", "in", ids]], skip: none });
  const events = useCollection<VenueEvent>("venueEvents", { where: [["venueId", "in", ids]], skip: none });
  const pitches = useCollection<{ status: string; campaignId?: string; target: { kind: string; id: string } }>("pitches", { where: [["artistId", "==", artistId]] });
  const open = useMemo(() => new Set((pitches.rows ?? []).filter((p) => isActive(p.status)).map((p) => p.id)), [pitches.rows]);
  const takes = useMemo(() => new Map((notes.rows ?? []).map((n) => [n.eventId, n])), [notes.rows]);
  const shown = useMemo(() => (events.rows ?? [])
    .filter((e) => isUpcoming(e, today) && !!takes.get(e.id)?.pitchId && open.has(takes.get(e.id)!.pitchId!))
    .sort(byWhen), [events.rows, takes, open, today]);
  const actIds = useMemo(() => [...new Set(shown.flatMap((e) => e.acts.filter((a) => a.actId).map((a) => a.actId!)))], [shown]);
  const acts = useDocs<ActDoc>("acts", actIds);
  const actGenres = useMemo(() => new Map(acts.rows.map((a) => [a.id, a.genres])), [acts.rows]);
  const actLinks = useMemo(() => new Map(acts.rows.map((a) => [a.id, a.links])), [acts.rows]);
  const actLineups = useMemo(() => new Map(acts.rows.map((a) => [a.id, a as LineupAct])), [acts.rows]);
  const loading = !none && (!events.rows || !notes.rows || !pitches.rows);

  return (
    <DetailCard private title={`Pitched shows${loading ? "" : ` (${shown.length})`}`} testid="promoter-pitched-shows">
      {loading ? <div className="s">Loading…</div>
        : shown.length === 0 ? <div className="empty" data-testid="promoter-pitched-empty"><span>{none ? "No venues linked to this promoter yet." : "No upcoming shows pitched at their venues yet. Pitch one from a venue's calendar."}</span></div>
        : <CalendarShowsTable shows={shown} venues={new Map(venues.map((v) => [v.id, v]))} takes={takes} pitches={pitches.rows ?? []} today={today}
            actGenres={actGenres} actLinks={actLinks} actLineups={actLineups} showVenue admin />}
    </DetailCard>
  );
}
