"use client";
import { useEffect, useState } from "react";
import { runCommand } from "@/lib/commands";
import type { Row } from "@/lib/firestore-hooks";
import { TOUR_STATUS_LABEL, type TourWarning } from "@/lib/tours";
import type { Artist, Project, Tour, TourStatus } from "@/schema";

export type TourRow = Row<Tour> & { rev?: number; updatedAt?: { toMillis(): number } };

/** What tours.summary sends back (members get no bucket and no totals). */
export interface TourSummary {
  days: { date: string; entries: { id: string; kind: string; pitchId?: string }[] }[];
  bucket?: { id: string; kind: string; pitchId?: string }[];
  warnings: TourWarning[];
  totals?: { net: number };
}

/** tours.summary for each tour, fetched again when a tour changes. Keyed by tour id; missing until it arrives. */
export function useTourSummaries(tours: readonly TourRow[]): Record<string, TourSummary> {
  const [out, setOut] = useState<Record<string, TourSummary>>({});
  const key = tours.map((t) => `${t.id}:${t.updatedAt?.toMillis() ?? t.rev ?? 0}`).join(",");
  useEffect(() => {
    let live = true;
    for (const id of key ? key.split(",").map((k) => k.split(":")[0]) : []) {
      runCommand<TourSummary>("tours.summary", { id }).then((s) => live && setOut((o) => ({ ...o, [id]: s })), () => undefined);
    }
    return () => { live = false; };
  }, [key]);
  return out;
}

export function TourStatusPill({ status }: { status: TourStatus }) {
  return <span className={`pill${status === "booked" || status === "done" ? " ok" : ""}`} data-testid="tour-status-pill">{TOUR_STATUS_LABEL[status]}</span>;
}

/** The act's name ("Duo"), from the artist's configurations. */
export const actName = (artist: Row<Artist> | null, billedAs?: string) => artist?.configurations.find((c) => c.id === billedAs)?.name;

/** "Boulder" from a picked town ("Boulder, CO, USA" when it has no name). */
export const townOf = (p?: { name?: string; address: string }) => p?.name ?? p?.address.split(",")[0];

/** "Money goes to" when nobody picked one: the act's own project (its configuration's, else one named like it: Duo, Band), else the default project. */
export function defaultProjectFor(artist: Row<Artist> | null, billedAs: string | undefined, open: readonly Row<Project>[]): string | undefined {
  const c = artist?.configurations.find((x) => x.id === billedAs);
  const has = (id?: string) => (id && open.some((p) => p.id === id) ? id : undefined);
  return has(c?.defaultProjectId) ?? open.find((p) => c && p.name.toLowerCase() === c.name.toLowerCase())?.id ?? open.find((p) => p.isDefault)?.id ?? open[0]?.id;
}
