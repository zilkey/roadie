"use client";
import { useMemo } from "react";
import { useArtist } from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import { useBooking } from "@/components/booking/common";
import { personalTouches } from "@/lib/personalTouches";
import { todayStr } from "@/lib/booking";
import type { ActNote, VenueEvent, VenueEventNote } from "@/schema";

/**
 * Personal touches (#82 S9) beside a booking email to a venue: what the band knows about the room, each with Insert, which adds
 * it at the end of the message. Nothing goes in on its own. Hidden when there is nothing to offer.
 */
export function PersonalTouches({ venueId, venueName, pitchId, onInsert }: { venueId: string; venueName: string; pitchId: string; onInsert(text: string): void }) {
  const { artistId } = useArtist();
  const b = useBooking();
  const mine = [["artistId", "==", artistId]] as [string, "==", string][];
  const shows = useCollection<{ date: string; status: string; venue?: { id: string } }>("shows", { where: mine }).rows ?? [];
  const events = useCollection<VenueEvent>("venueEvents", { where: [["venueId", "==", venueId]] }).rows ?? [];
  const notes = useCollection<VenueEventNote>("venueEventNotes", { where: [...mine, ["pitchId", "==", pitchId]] }).rows ?? [];
  const actNotes = useCollection<ActNote>("actNotes", { where: mine }).rows ?? [];
  const touches = useMemo(() => {
    const onPitch = new Set(notes.map((n) => n.eventId));
    return personalTouches({
      placeName: venueName, today: todayStr(),
      shows: shows.filter((s) => s.venue?.id === venueId).map((s) => ({ id: (s as { id?: string }).id ?? s.date, date: s.date, status: s.status })),
      pitched: events.filter((e) => onPitch.has(e.id)),
      actNotes: new Map(actNotes.map((n) => [n.actId, { relationship: n.relationship, note: n.note }])),
      venueNote: b.venueNotes.get(venueId)?.notes,
    });
  }, [shows, events, notes, actNotes, b.venueNotes, venueId, venueName]);
  if (!touches.length) return null;
  return (
    <div className="grid gap-1.5" data-testid="personal-touches">
      <span className="lbl">Personal touches</span>
      <ul className="grid gap-1">
        {touches.map((t) => (
          <li key={t.key} className="flex items-start gap-2 text-sm" data-testid={`touch-${t.key}`}>
            <span className="min-w-0 flex-1">{t.label}</span>
            <button type="button" className="btn sm ghost shrink-0" onClick={() => onInsert(t.text)} data-testid={`touch-insert-${t.key}`}>Insert</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
