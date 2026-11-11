"use client";
import { useMemo } from "react";
import { useArtist } from "@/lib/artist";

const NONE: readonly string[] = [];

/** Our own genres (artists/{id}.genres, set on General Settings), for genre fit in the opener-chance guess (#79). Stable between renders. */
export function useOurGenres(): readonly string[] {
  const genres = useArtist().doc?.genres;
  const key = (genres ?? []).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (genres?.length ? genres : NONE), [key]);
}
