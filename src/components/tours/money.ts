"use client";
import { useMemo } from "react";
import { useCollection } from "@/lib/firestore-hooks";
import { dayLabel } from "@/lib/tours";
import { showName } from "@/lib/shows";
import type { Show, Tour, TourEntry } from "@/schema";
import type { Place } from "@/components/AddressAutocomplete";
import { townOf } from "./common";

/** One entry money can be pinned to (a drive, stay or show), as the "On" select and the money lines read it. */
export interface TourEntryOption { id: string; date: string; kind: "drive" | "stay" | "show"; label: string; /** A drive's places, for the gas form. */ from?: Place; to?: Place; roundTrip?: boolean }

/** "Drive Boulder → Fort Collins", "Stay · Airbnb", "Show · Washington's". */
export function entryText(e: Pick<TourEntry, "kind" | "from" | "to" | "name">, show?: Show | null): string {
  if (e.kind === "drive") return ["Drive", [townOf(e.from), townOf(e.to)].filter(Boolean).join(" → ")].filter(Boolean).join(" ");
  if (e.kind === "stay") return e.name ? `Stay · ${e.name}` : "Stay";
  return show ? `Show · ${showName(show)}` : "Show";
}

/**
 * A tour's dated drives, stays and shows in day order, each "Tue Mar 9 · Drive Boulder → Fort Collins", for the money modals'
 * "On (optional)" select and the day tag on money lines. Members read the band's entries only. Nothing while `tourId` is empty.
 */
export function useTourEntries(tourId: string | undefined, admin = true) {
  const entries = useCollection<TourEntry>(`tours/${tourId || "none"}/entries`, { skip: !tourId, ...(admin ? {} : { where: [["visibility", "==", "band"]] }) }).rows;
  const shows = useCollection<Show>("shows", { skip: !tourId }).rows;
  return useMemo(() => {
    const byShow = new Map((shows ?? []).map((s) => [s.id, s]));
    const options: TourEntryOption[] = (entries ?? [])
      .filter((e): e is typeof e & { date: string; kind: TourEntryOption["kind"] } => !!e.date && (e.kind === "drive" || e.kind === "stay" || e.kind === "show"))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.position - b.position))
      .map((e) => ({ id: e.id, date: e.date, kind: e.kind, ...(e.kind === "drive" ? { from: e.from, to: e.to, roundTrip: !!e.roundTrip } : {}), label: `${dayLabel(e.date)} · ${entryText(e, e.showId ? byShow.get(e.showId) : null)}` }));
    const byId = new Map(options.map((o) => [o.id, o]));
    return { options, byId, labelOf: (id?: string) => (id ? byId.get(id)?.label ?? null : null) };
  }, [entries, shows]);
}

/** The band's tours (soft-deleted ones are left out by useCollection), soonest first, for the Money page's "Tour (optional)" select. */
export function useTours() {
  const rows = useCollection<Tour>("tours").rows;
  return useMemo(() => [...(rows ?? [])].sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999")), [rows]);
}
