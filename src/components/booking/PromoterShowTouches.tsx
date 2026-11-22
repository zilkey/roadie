"use client";
import { useMemo } from "react";
import { useArtist, useZone } from "@/lib/artist";
import { useCollection, useDocs } from "@/lib/firestore-hooks";
import { useBooking } from "@/components/booking/common";
import { promoterShowTouches } from "@/lib/personalTouches";
import { todayStr } from "@/lib/booking";
import type { VenueEvent, VenueEventNote } from "@/schema";

/**
 * Beside one email to a promoter about several venues (Jeff, 2026-11-22): the shows pitched at those venues ("Pitch this" on a
 * venue's calendar), each with Insert, and Insert for all of them as a list. Nothing goes in on its own. Hidden with none.
 */
export function PromoterShowTouches({ pitchIds, onInsert }: { pitchIds: string[]; onInsert(html: string): void }) {
  const { artistId } = useArtist();
  const b = useBooking();
  const zone = useZone();
  const ids = useMemo(() => [...new Set(pitchIds)].sort().slice(0, 30), [pitchIds]);
  const notes = useCollection<VenueEventNote>("venueEventNotes", { where: [["artistId", "==", artistId], ["pitchId", "in", ids]], skip: ids.length === 0 }).rows ?? [];
  const events = useDocs<VenueEvent>("venueEvents", useMemo(() => notes.map((n) => n.eventId).sort(), [notes]));
  const touches = useMemo(() => promoterShowTouches(events.rows.map((e) => ({
    id: e.id, date: e.date, acts: e.acts, title: e.title, venueName: b.venues.find((v) => v.id === e.venueId)?.name ?? "the venue",
  })), todayStr(zone)), [events.rows, b.venues, zone]);
  if (!touches.length) return null;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (
    <div className="grid gap-1.5" data-testid="promoter-show-touches">
      <span className="lbl">Pitched shows</span>
      <ul className="grid gap-1">
        {touches.map((t) => (
          <li key={t.key} className="flex items-start gap-2 text-sm" data-testid={`touch-${t.key}`}>
            <span className="min-w-0 flex-1">{t.label}</span>
            <button type="button" className="btn sm ghost shrink-0" data-testid={`touch-insert-${t.key}`}
              onClick={() => onInsert(`<p>${esc(t.text)}</p>${t.lines ? `<ul>${t.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}`)}>Insert</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
