"use client";
import { useMemo } from "react";
import { useMusic } from "@/components/music/common";
import { useArtist } from "@/lib/artist";
import { useProfile } from "@/lib/auth";
import { buildSheets, type BuildResult } from "@/lib/printSheets";
import { showName } from "@/lib/shows";
import type { SongField } from "@/schema";
import type { PrintOptions } from "@/schema/print";

/**
 * Reads what the sheets are built from and builds them. `setlistId` is a setlist template id or a show id (a show's
 * setlist is setlists/{showId}). "mine" without a musician in this band falls back to the band copy.
 */
export function usePrintSheets(setlistId: string, options: PrintOptions) {
  const m = useMusic();
  const artist = useArtist();
  const profile = useProfile();
  const songFields: SongField[] = artist.doc?.songFields ?? [];

  const template = m.templates.find((t) => t.id === setlistId);
  const show = template ? undefined : m.shows.find((s) => s.id === setlistId);
  const items = template ? template.items : show ? m.setlists.find((s) => s.id === show.id)?.items ?? [] : undefined;
  const kind: "template" | "show" | null = template ? "template" : show ? "show" : null;

  const me = profile.musicianId ? m.musicians.find((x) => x.id === profile.musicianId) : undefined;
  const canMine = !!me;
  const mineName = me?.name.split(/\s+/)[0];
  const copy = options.copy === "mine" && canMine ? "mine" : "band";

  const result = useMemo<BuildResult | null>(() => {
    if (!items) return null;
    return buildSheets({
      items, songs: m.songs, songFields, options: { ...options, copy }, bandName: artist.name,
      showName: show ? showName(show) : undefined, date: show?.date, templateName: template?.name, copyName: mineName,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, m.songs, songFields, JSON.stringify(options), copy, artist.name, show, template?.name, mineName]);

  return {
    loading: m.loading, missing: !m.loading && !kind, result, kind,
    backPath: kind === "show" ? `/shows/${setlistId}?tab=setlist` : `/setlists/${setlistId}`,
    canMine, mineName, songFields,
  };
}
