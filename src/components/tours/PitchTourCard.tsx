"use client";
import Link from "@/lib/artist";
import { useArtist } from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import { ErrorBox, useCommand } from "@/components/ui";
import { InlineValue } from "@/components/InlineValue";
import { KV } from "@/components/booking/DetailCards";
import { onPlanText } from "@/lib/tours";
import type { Tour, TourEntry } from "@/schema";

/**
 * The pitch page's Tour card: which tour the pitch is on (click to change; "No tour" takes it off) and the dates it is an option
 * on. The dates themselves live in the Dates card, so changing them moves it on the plan. Admins only (pitches are).
 */
export function PitchTourCard({ pitchId, tourId }: { pitchId: string; tourId?: string }) {
  const { artistId } = useArtist();
  const { call, error } = useCommand();
  const tours = useCollection<Tour>("tours", { where: [["artistId", "==", artistId]] }).rows ?? [];
  const entries = useCollection<TourEntry>(`tours/${tourId}/entries`, { skip: !tourId }).rows ?? [];
  // Live tours that aren't over, plus the current one.
  const options = tours.filter((t) => t.status !== "done" || t.id === tourId).sort((a, b) => (a.startDate ?? "9").localeCompare(b.startDate ?? "9") || a.name.localeCompare(b.name));
  const current = tours.find((t) => t.id === tourId);

  async function pick(next: string): Promise<boolean> {
    if (next === (tourId ?? "")) return true;
    if (!next) return (await call("tours.removeItem", { tourId, pitchId })) !== undefined;
    return (await call("tours.addPitch", { tourId: next, pitchId })) !== undefined;
  }

  return (
    <section className="card" data-testid="pitch-tour-card">
      <div className="card-head">
        <h2>Tour</h2>
        {tourId && <Link href={`/tours/${tourId}`} className="s font-semibold underline" data-testid="pitch-tour-open">Open tour ›</Link>}
      </div>
      <KV rows={[
        ["Tour", <InlineValue key="t" testid="pitch-tour" label="Tour" kind="select" value={tourId ?? ""} canEdit onSave={pick}
          display={current?.name ?? (tourId ? "Tour" : "No tour")}
          options={[["", "No tour"], ...options.map((t) => [t.id, t.name] as const)]} emptyLabel="No tour" />],
        ...(tourId ? [["On the plan", onPlanText(entries, pitchId) || "Not on the plan yet", "pitch-tour-plan"] as [string, string, string]] : []),
      ]} />
      {tourId && <p className="s m-0">Pick &quot;No tour&quot; to take it off. The dates themselves live in the Dates card above, so changing them moves it on the plan.</p>}
      <ErrorBox error={error} />
    </section>
  );
}
