"use client";
import { useMemo, useState } from "react";
import type { Row } from "@/lib/firestore-hooks";
import { STATUS_LABEL, isActive } from "@/lib/booking";
import { fmtLong, showCity, showName } from "@/lib/shows";
import type { PitchRow, VenueRow } from "@/components/booking/common";
import type { Show } from "@/schema";

/** What is being dragged onto the plan: something from the tray, a Drive / Stay / Note chip, or an entry already on it. */
export type Drag =
  | { type: "venue" | "pitch" | "show"; id: string; name: string }
  | { type: "chip"; kind: "drive" | "stay" | "note" }
  | { type: "entry"; id: string; kind: string; date?: string };

type Tab = "pitches" | "venues" | "shows";
interface Item { id: string; name: string; sub: string; city?: string; unpitched: boolean }

/**
 * Admins: "Add to tour". Pitches / Venues / Shows, a search, and the "Near the route" (in a town the tour passes through) and
 * "Not pitched yet" filters. Drag a row onto a day: a venue starts a pitch offering that date, a pitch adds that date, a show
 * goes on the tour (on its own date). Without dragging, the row's Add puts it on the tour undated (a venue or pitch with no
 * dates lands in No date yet); the + menus on the plan do the rest. The Drive / Stay / Note chips drag onto a slot of a day.
 */
export function TourTray({ tourId, venues, pitches, shows, towns, today, onDrag, onAdd }: {
  tourId: string; venues: VenueRow[]; pitches: PitchRow[]; shows: Row<Show>[]; towns: Set<string>; today: string;
  onDrag(d: Drag | null): void; onAdd(d: Extract<Drag, { type: "venue" | "pitch" | "show" }>): void;
}) {
  const [tab, setTab] = useState<Tab>("venues");
  const [q, setQ] = useState("");
  const [near, setNear] = useState(false);
  const [unpitched, setUnpitched] = useState(false);

  const items = useMemo<Item[]>(() => {
    const pitchedVenues = new Set(pitches.filter((p) => p.target.kind === "venue").map((p) => p.target.id));
    const venueById = new Map(venues.map((v) => [v.id, v]));
    if (tab === "venues") {
      return venues.map((v) => ({
        id: v.id, name: v.name, city: v.address.city, unpitched: !pitchedVenues.has(v.id),
        sub: [`${v.address.city}`, v.capacity ? `${v.capacity} cap` : "", pitchedVenues.has(v.id) ? "" : "no pitch yet"].filter(Boolean).join(" · "),
      }));
    }
    if (tab === "pitches") {
      return pitches.filter((p) => isActive(p.status) && p.tourId !== tourId).map((p) => {
        const city = p.target.kind === "venue" ? venueById.get(p.target.id)?.address.city : undefined;
        return { id: p.id, name: p.target.name, city, unpitched: p.status === "idea" || p.status === "toPitch", sub: [city, STATUS_LABEL[p.status]].filter(Boolean).join(" · ") };
      });
    }
    return shows.filter((s) => s.tourId !== tourId && s.date >= today && s.status !== "canceled").sort((a, b) => a.date.localeCompare(b.date)).map((s) => ({
      id: s.id, name: showName(s), city: showCity(s), unpitched: false, sub: [fmtLong(s.date), showCity(s)].filter(Boolean).join(" · "),
    }));
  }, [tab, venues, pitches, shows, tourId, today]);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = items
    .filter((x) => words.every((w) => `${x.name} ${x.sub}`.toLowerCase().includes(w)))
    .filter((x) => !near || (x.city && towns.has(x.city.toLowerCase())))
    .filter((x) => !unpitched || x.unpitched)
    .sort((a, b) => (tab === "shows" ? 0 : a.name.localeCompare(b.name)))
    .slice(0, 30);
  const type = tab === "venues" ? "venue" : tab === "pitches" ? "pitch" : "show";

  return (
    <section className="d-card tp-tray tp-desk" aria-labelledby="tray-h" data-testid="tour-tray">
      <div className="d-ch"><h2 id="tray-h" className="d-ct">Add to tour</h2><span className="text-[0.8125rem] text-muted">Drag onto a day</span></div>
      <div className="seg wide" role="radiogroup" aria-label="What to add">
        {(["pitches", "venues", "shows"] as Tab[]).map((t) => (
          <label key={t}><input type="radio" name="tray-tab" checked={tab === t} onChange={() => { setTab(t); setUnpitched(false); }} data-testid={`tray-tab-${t}`} />{t[0].toUpperCase() + t.slice(1)}</label>
        ))}
      </div>
      <label className="grid"><span className="sr-only">Search {tab}</span>
        <input className="input" type="search" placeholder={tab === "shows" ? "Search shows or cities" : `Search ${tab} or cities`} value={q} onChange={(e) => setQ(e.target.value)} data-testid="tray-search" />
      </label>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={`btn sm ${near ? "ghost" : "outline"}`} aria-pressed={near} onClick={() => setNear(!near)} data-testid="tray-near">Near the route</button>
        {tab !== "shows" && <button type="button" className={`btn sm ${unpitched ? "ghost" : "outline"}`} aria-pressed={unpitched} onClick={() => setUnpitched(!unpitched)} data-testid="tray-unpitched">Not pitched yet</button>}
      </div>
      <ul className="m-0 grid list-none gap-2 p-0" data-testid="tray-items">
        {hits.length === 0 && <li className="text-[0.875rem] text-muted">{near && !towns.size ? "Nothing on the route yet: add a drive, stay or show first." : "Nothing matches."}</li>}
        {hits.map((x) => (
          <li key={x.id} className="tp-tray-item" draggable data-testid={`tray-item-${x.id}`}
            onDragStart={(e) => { e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("text/plain", x.name); onDrag({ type, id: x.id, name: x.name }); }}
            onDragEnd={() => onDrag(null)}>
            <GripIcon />
            <span className="grid min-w-0 flex-1"><b className="text-[0.9375rem] leading-tight">{x.name}</b><span className="text-[0.8125rem] text-muted">{x.sub}</span></span>
            <button type="button" className="btn ghost sm" aria-label={`Add ${x.name} to the tour`} onClick={() => onAdd({ type, id: x.id, name: x.name })} data-testid={`tray-add-${x.id}`}>Add</button>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 border-t border-divider pt-3">
        <span className="text-[0.8125rem] font-semibold text-muted">Travel and stays</span>
        <div className="flex flex-wrap gap-1.5">
          {(["drive", "stay", "note"] as const).map((k) => (
            <span key={k} className="tp-chip" draggable data-testid={`tray-chip-${k}`}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("text/plain", k); onDrag({ type: "chip", kind: k }); }}
              onDragEnd={() => onDrag(null)}>{k[0].toUpperCase() + k.slice(1)}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

export const GripIcon = () => (
  <svg className="tp-grip" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
    <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
  </svg>
);
