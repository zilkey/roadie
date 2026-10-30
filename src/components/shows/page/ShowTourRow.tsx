"use client";
import Link, { useArtist } from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import { InlineValue } from "@/components/InlineValue";
import { arrivalOf, tourDayNumber } from "@/lib/tours";
import type { Tour, TourEntry } from "@/schema";
import type { ShowRow } from "../common";

/** What the Where & when card needs of the show's tour: the tours to pick from (admins), the tour, and when its drive gets in on the show's day. */
export function useShowTour(show: ShowRow, admin: boolean) {
  const { artistId } = useArtist();
  const tours = useCollection<Tour>("tours", { where: [["artistId", "==", artistId]], skip: !admin && !show.tourId }).rows ?? [];
  const tour = tours.find((t) => t.id === show.tourId);
  // Members read only the band's entries (rules).
  const entries = useCollection<TourEntry>(`tours/${show.tourId}/entries`, { skip: !show.tourId, ...(admin ? {} : { where: [["visibility", "==", "band"]] }) }).rows ?? [];
  const arrival = show.tourId ? arrivalOf(entries, show.date) : null;
  return { tours, tour, entries, arrival };
}

/** The "Tour" row of Where & when: "{name} · day N of M" with Open tour ›; admins click to pick another or "No tour". Members see it only when the show has a tour. */
export function ShowTourRow({ show, admin, info, onPick }: { show: ShowRow; admin: boolean; info: ReturnType<typeof useShowTour>; onPick(tourId: string): Promise<boolean> }) {
  const { tours, tour, entries } = info;
  if (!admin && !show.tourId) return null;
  const day = tour ? tourDayNumber(tour, entries, show.date) : null;
  const text = tour ? `${tour.name}${day ? ` · day ${day.n} of ${day.of}` : ""}` : show.tourId ? "Tour" : "";
  const options = tours.filter((t) => t.status !== "done" || t.id === show.tourId).sort((a, b) => (a.startDate ?? "9").localeCompare(b.startDate ?? "9") || a.name.localeCompare(b.name));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="where-tour-row">
      <span className="lbl">Tour</span>
      <InlineValue testid="where-tour" label="Tour" kind="select" value={show.tourId ?? ""} display={text} emptyLabel="No tour" canEdit={admin}
        options={[["", "No tour"], ...options.map((t) => [t.id, t.name] as const)]} onSave={onPick} />
      {show.tourId && <Link href={`/tours/${show.tourId}`} className="s font-semibold underline" data-testid="where-tour-open">Open tour ›</Link>}
    </div>
  );
}
