"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { STATUS_LABEL, isActive } from "@/lib/booking";
import { dayLabel } from "@/lib/tours";
import type { PitchRow, VenueRow } from "@/components/booking/common";
import type { EntryKind } from "./EntryModal";
import type { Drag } from "./TourTray";

type Tab = "pitches" | "venues" | "travel";
type Add = Extract<Drag, { type: "venue" | "pitch" | "show" }>;

/**
 * Phone planning: the bottom sheet behind a day's +. "Add to Fri Mar 12" with Pitches / Venues / Travel. Venues are the ones
 * with no pitch yet near the day (its town, else a town on the route; with none near, every unpitched venue and a search);
 * Add starts a pitch offering this date and the sheet stays open for the next. Travel closes it and opens the Drive / Stay /
 * Note modal at the end of the day. A native dialog: × , Escape and the backdrop close it.
 */
export function AddSheet({ date, town, towns, venues, pitches, tourId, onAdd, onTravel, onClose }: {
  date: string | null; town?: string; towns: Set<string>; venues: VenueRow[]; pitches: PitchRow[]; tourId: string;
  onAdd(d: Add, date: string): void; onTravel(kind: EntryKind, date: string): void; onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (date && !d.open) d.showModal();
    if (!date && d.open) d.close();
  }, [date]);
  return (
    <dialog ref={ref} className="tp-sheet" aria-label={date ? `Add to ${dayLabel(date)}` : "Add"} data-testid="add-sheet"
      onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {date && <SheetBody date={date} town={town} towns={towns} venues={venues} pitches={pitches} tourId={tourId} onAdd={onAdd} onTravel={onTravel} onClose={onClose} />}
    </dialog>
  );
}

/** Its own component so the tab and the search start fresh each time the sheet opens. */
function SheetBody({ date, town, towns, venues, pitches, tourId, onAdd, onTravel, onClose }: {
  date: string; town?: string; towns: Set<string>; venues: VenueRow[]; pitches: PitchRow[]; tourId: string;
  onAdd(d: Add, date: string): void; onTravel(kind: EntryKind, date: string): void; onClose(): void;
}) {
  const [tab, setTab] = useState<Tab>("venues");
  const [q, setQ] = useState("");
  const venueById = useMemo(() => new Map(venues.map((v) => [v.id, v])), [venues]);

  const unpitched = useMemo(() => {
    const pitched = new Set(pitches.filter((p) => p.target.kind === "venue").map((p) => p.target.id));
    return venues.filter((v) => !pitched.has(v.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [venues, pitches]);
  const near = unpitched.filter((v) => (town ? v.address.city.toLowerCase() === town.toLowerCase() : towns.has(v.address.city.toLowerCase())));
  const where = town ? `Near ${town}` : "Near the route";
  const fallback = near.length === 0;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const venueRows = (fallback ? unpitched.filter((v) => words.every((w) => `${v.name} ${v.address.city}`.toLowerCase().includes(w))) : near).slice(0, 30);

  const pitchRows = pitches.filter((p) => isActive(p.status) && p.tourId !== tourId).sort((a, b) => a.target.name.localeCompare(b.target.name)).slice(0, 30);

  return (
    <div className="tp-sheet-body">
      <div className="tp-sheet-grab" aria-hidden />
      <div className="flex items-center gap-2">
        <h2 className="m-0 min-w-0 flex-1 text-lg">Add to {dayLabel(date)}</h2>
        <button type="button" className="ib tp-sheet-x" aria-label="Close" onClick={onClose} data-testid="add-sheet-close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="seg wide" role="radiogroup" aria-label="What to add">
        {(["pitches", "venues", "travel"] as Tab[]).map((t) => (
          <label key={t}><input type="radio" name="sheet-tab" checked={tab === t} onChange={() => setTab(t)} data-testid={`add-sheet-tab-${t}`} />{t[0].toUpperCase() + t.slice(1)}</label>
        ))}
      </div>

      {tab === "venues" && (
        <>
          <span className="text-[0.875rem] text-muted" data-testid="add-sheet-sub">
            {fallback ? `No unpitched venues ${town ? `near ${town}` : "on the route yet"}. Every venue with no pitch yet:` : `${where} · not pitched yet`}
          </span>
          {fallback && <input className="input" type="search" aria-label="Search venues" placeholder="Venue name or city" value={q} onChange={(e) => setQ(e.target.value)} data-testid="add-sheet-search" />}
          <ul className="tp-sheet-list" data-testid="add-sheet-venues">
            {venueRows.length === 0 && <li className="text-[0.875rem] text-muted">Nothing matches.</li>}
            {venueRows.map((v) => (
              <li key={v.id} className="tp-sheet-row" data-testid={`add-sheet-venue-${v.id}`}>
                <span className="grid min-w-0 flex-1"><b className="text-[1rem] leading-tight">{v.name}</b><span className="text-[0.8125rem] text-muted">{v.address.city}</span></span>
                <button type="button" className="btn outline tp-sheet-add" aria-label={`Add ${v.name}`} onClick={() => onAdd({ type: "venue", id: v.id, name: v.name }, date)} data-testid={`add-sheet-add-${v.id}`}>Add</button>
              </li>
            ))}
          </ul>
          <span className="text-[0.8125rem] text-muted">Adding a venue starts a pitch for it, offering this date.</span>
        </>
      )}

      {tab === "pitches" && (
        <>
          <span className="text-[0.875rem] text-muted">Pitches not on this tour yet · adding one offers this date</span>
          <ul className="tp-sheet-list" data-testid="add-sheet-pitches">
            {pitchRows.length === 0 && <li className="text-[0.875rem] text-muted">No open pitches to add.</li>}
            {pitchRows.map((p) => {
              const city = p.target.kind === "venue" ? venueById.get(p.target.id)?.address.city : undefined;
              return (
                <li key={p.id} className="tp-sheet-row" data-testid={`add-sheet-pitch-${p.id}`}>
                  <span className="grid min-w-0 flex-1"><b className="text-[1rem] leading-tight">{p.target.name}</b><span className="text-[0.8125rem] text-muted">{[city, STATUS_LABEL[p.status]].filter(Boolean).join(" · ")}</span></span>
                  <button type="button" className="btn outline tp-sheet-add" aria-label={`Add ${p.target.name}`} onClick={() => onAdd({ type: "pitch", id: p.id, name: p.target.name }, date)} data-testid={`add-sheet-add-${p.id}`}>Add</button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {tab === "travel" && (
        <div className="grid gap-2">
          {(["drive", "stay", "note"] as const).map((k) => (
            <button key={k} type="button" className="btn outline tp-sheet-big" onClick={() => onTravel(k, date)} data-testid={`add-sheet-travel-${k}`}>{k[0].toUpperCase() + k.slice(1)}</button>
          ))}
        </div>
      )}
    </div>
  );
}
