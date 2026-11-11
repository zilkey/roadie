"use client";
import { useMemo } from "react";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { BUILTIN_VENUE_TYPES, LEGACY_OTHER, type VenueType } from "@/schema";

export type VenueTypeOption = { id: string; label: string };

/** The venue type list every band shares, A-Z. Until anyone has touched it (still empty), the built-in types. */
export function useVenueTypes(): VenueTypeOption[] {
  const { rows } = useCollection<VenueType>("venueTypes");
  return useMemo(() => {
    const list: VenueTypeOption[] = rows?.length ? rows.map((r: Row<VenueType>) => ({ id: r.id, label: r.label })) : BUILTIN_VENUE_TYPES.map(([id, label]) => ({ id, label }));
    return list.sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);
}

/** What a venue's type reads as: its label, "Other" for a venue typed so before the list could grow, or the key itself. */
export const venueTypeLabel = (types: VenueTypeOption[], key: string) =>
  types.find((t) => t.id === key)?.label ?? (key === LEGACY_OTHER ? "Other" : key);
