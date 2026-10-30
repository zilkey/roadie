"use client";
import { useMemo } from "react";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";
import { DialogClose } from "@/components/booking/AddContactDialog";
import { useCollection } from "@/lib/firestore-hooks";
import { fmtPitchDate } from "@/lib/booking";
import type { Pitch, Tour } from "@/schema";

type Picked = Pick<Pitch, "id" | "showIds">;
const ORDER = { planning: 0, idea: 1, booked: 2, done: 3 } as const;

/**
 * "Add to a tour" on the Pitch List's selection bar: pick one of the band's live tours. A booked pitch brings its shows
 * (tours.addShow); the rest land in the tour's bucket with the dates they offer (tours.addPitch). `testid`s: `add-to-tour-dialog`,
 * `-close`, `add-to-tour-<tourId>`.
 */
export function AddToTourDialog({ open, onClose, pitches, onDone }: { open: boolean; onClose(): void; pitches: Picked[]; onDone(msg: string): void }) {
  const { call, error, busy } = useCommand();
  const tours = useCollection<Tour>("tours").rows;
  const sorted = useMemo(() => [...(tours ?? [])].sort((a, b) =>
    ORDER[a.status] - ORDER[b.status] || (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999") || a.name.localeCompare(b.name)), [tours]);

  async function pick(tour: Tour) {
    for (const p of pitches) {
      if (p.showIds.length > 0) { for (const showId of p.showIds) if (!await call("tours.addShow", { tourId: tour.id, showId })) return; }
      else if (!await call("tours.addPitch", { tourId: tour.id, pitchId: p.id })) return;
    }
    onDone(`Added ${pitches.length} pitch${pitches.length === 1 ? "" : "es"} to ${tour.name}.`);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add to a tour" testid="add-to-tour-dialog">
      <DialogClose onClose={onClose} testid="add-to-tour-close" />
      <span className="s -mt-2">Booked pitches bring their shows. The rest land in the tour&apos;s bucket with the dates they offer.</span>
      <div className="hit-list" data-testid="add-to-tour-list">
        {sorted.length === 0 && <span className="s p-3">{tours ? "No tours yet." : "Loading…"}</span>}
        {sorted.map((t) => (
          <button key={t.id} type="button" className="hit-row" disabled={busy} onClick={() => void pick(t)} data-testid={`add-to-tour-${t.id}`}>
            <span className="grid min-w-0 gap-px"><b>{t.name}</b>
              <span className="s">{t.startDate ? `${fmtPitchDate(t.startDate)}${t.endDate ? ` – ${fmtPitchDate(t.endDate)}` : ""}` : "No dates yet"}</span></span>
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
    </Dialog>
  );
}
