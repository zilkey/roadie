"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { useArtist } from "@/lib/artist";
import { useAuth } from "@/lib/auth";
import { clientDb } from "@/lib/firebase-client";
import { runCommand } from "@/lib/commands";
import { useCollection } from "@/lib/firestore-hooks";
import { showName } from "@/lib/shows";
import type { ShowFacts } from "@/lib/tours";
import { buildTourLayer, overlaps, type LayerEntry, type LayerTour, type TourLayer } from "@/lib/calendarTours";
import type { Show, Tour } from "@/schema";

/** Live "Tours" switch of the signed-in user (userPrefs/{uid}.calendarTours; owner-only read), off until set. `set` saves it (command calendar.setTours) and flips at once. */
export function useToursPref() {
  const { state } = useAuth();
  const uid = state.status === "ready" ? state.profile.uid : null;
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(clientDb(), "userPrefs", uid), (s) => setOn(s.data()?.calendarTours === true), () => undefined);
  }, [uid]);
  const set = useCallback((v: boolean) => {
    setOn(v);
    runCommand("calendar.setTours", { on: v }).catch(() => setOn(!v));
  }, []);
  return { on, set };
}

/** Reads one tour's entries (members: band ones only, as the rules require) and hands them up; renders nothing. */
function TourFeed({ tourId, admin, onRows }: { tourId: string; admin: boolean; onRows(id: string, rows: LayerEntry[] | null): void }) {
  const { rows } = useCollection<LayerEntry>(`tours/${tourId}/entries`, { where: admin ? undefined : [["visibility", "==", "band"]] });
  useEffect(() => { if (rows) onRows(tourId, rows); }, [rows, tourId, onRows]);
  useEffect(() => () => onRows(tourId, null), [tourId, onRows]);
  return null;
}

/**
 * The tours that touch the shown grid, as layers. Nothing is read while the switch is off. `feeds` must be rendered somewhere
 * (one entries listener per tour that might touch the month: those within it, or without both dates).
 */
export function useTourLayers(grid: readonly string[], on: boolean, admin: boolean): { layers: TourLayer[]; tours: Tour[]; feeds: React.ReactNode } {
  const { artistId } = useArtist();
  const tours = useCollection<Tour>("tours", { where: [["artistId", "==", artistId]], skip: !on });
  const shows = useCollection<Show>("shows", { skip: !on });
  const [entries, setEntries] = useState<Record<string, LayerEntry[]>>({});
  const onRows = useCallback((id: string, rows: LayerEntry[] | null) => setEntries((e) => {
    if (rows === null) { if (!(id in e)) return e; const { [id]: _gone, ...rest } = e; return rest; } // eslint-disable-line @typescript-eslint/no-unused-vars
    return e[id] === rows ? e : { ...e, [id]: rows };
  }), []);
  const first = grid[0], last = grid[grid.length - 1];
  const near = useMemo(() => (on ? tours.rows ?? [] : []).filter((t) => !t.startDate || !t.endDate || overlaps({ from: t.startDate, to: t.endDate }, [first, last])), [on, tours.rows, first, last]);
  const facts = useMemo(() => new Map<string, ShowFacts>((shows.rows ?? []).map((s) => [s.id, { date: s.date, name: showName(s), loadIn: s.times?.loadIn }])), [shows.rows]);
  const layers = useMemo(() => near.flatMap((t) => {
    const l = entries[t.id] && buildTourLayer(t as unknown as LayerTour, entries[t.id], facts, admin);
    return l && overlaps(l.span, [first, last]) ? [l] : [];
  }), [near, entries, facts, admin, first, last]);
  return { layers, tours: near, feeds: near.map((t) => <TourFeed key={t.id} tourId={t.id} admin={admin} onRows={onRows} />) };
}
