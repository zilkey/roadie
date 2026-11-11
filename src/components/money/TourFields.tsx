"use client";
import { useState } from "react";
import { useTourEntries, useTours } from "../tours/money";
import type { MoneyDefaults } from "./modals";

/**
 * A money form's tour tag: the tour (from the context, or picked on the Money page) and the "On" entry (a drive, stay or show; "" = whole tour).
 * Adding: nothing is saved until the form is; `payload` is what the add commands take ({ tourId, tourEntryId? } or {}). Editing (`save` given):
 * each change autosaves tourId / tourEntryId (null clears; a new tour drops the old entry). `ps.setProjectHint` moves Project to the picked
 * tour's "Money goes to" while the admin has not picked a project (adding only).
 */
export function useTourPick(
  context: MoneyDefaults["context"],
  initial: { tourId?: string; tourEntryId?: string } | undefined,
  o?: { ps?: { setProjectHint(id: string | null): void }; save?: (patch: Record<string, unknown>, what: string) => unknown },
) {
  const tours = useTours();
  const fixed = context?.kind === "tour" ? context.tourId : "";
  const [tourPick, setTourPick] = useState(initial?.tourId ?? "");
  const [entry, setEntryState] = useState(initial ? initial.tourEntryId ?? "" : context?.kind === "tour" ? context.tourEntryId ?? "" : "");
  const tourId = fixed || tourPick;
  const entries = useTourEntries(tourId || undefined);
  // The Tour select: the Money page or a project page (no context), or a tagged line whose context is something else; a tour context decides it.
  const canPick = context?.kind !== "tour" && (!context || !!initial?.tourId);
  const save = o?.save;
  function setTour(id: string) {
    setTourPick(id);
    const hadEntry = !!entry;
    setEntryState("");
    if (save) void save({ tourId: id || null, ...(hadEntry ? { tourEntryId: null } : {}) }, "the tour");
    else o?.ps?.setProjectHint(id ? tours.find((t) => t.id === id)?.projectId ?? null : null);
  }
  function setEntry(id: string) {
    setEntryState(id);
    if (save) void save({ ...(tourId !== initial?.tourId ? { tourId } : {}), tourEntryId: id || null }, "the day");
  }
  const payload = tourId ? { tourId, ...(entry ? { tourEntryId: entry } : {}) } : {};
  return { tours, tourId, entry, setTour, setEntry, entries, canPick, payload };
}
export type TourPick = ReturnType<typeof useTourPick>;

/** "Tour (optional)" (when the form may pick one) and "On (optional)" (Whole tour, or one drive, stay or show), side by side. */
export function TourFields({ t, prefix }: { t: TourPick; prefix: string }) {
  if (!t.canPick && !t.tourId) return null;
  return (
    <div className={`grid gap-[14px]${t.canPick && t.tourId ? " sm:grid-cols-2" : ""}`}>
      {t.canPick && <label className="grid gap-1">
        <span className="lbl">Tour <span className="font-normal">(optional)</span></span>
        <select className="select" value={t.tourId} onChange={(e) => t.setTour(e.target.value)} data-testid={`${prefix}-tour`}>
          <option value="">None</option>
          {t.tours.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>}
      {t.tourId && <label className="grid gap-1">
        <span className="lbl">On <span className="font-normal">(optional)</span></span>
        <select className="select" value={t.entry} onChange={(e) => t.setEntry(e.target.value)} data-testid={`${prefix}-on`}>
          <option value="">Whole tour</option>
          {t.entries.options.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>}
    </div>
  );
}
