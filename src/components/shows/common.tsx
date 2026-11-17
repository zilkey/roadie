"use client";
import { useArtist } from "@/lib/artist";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { useProfile } from "@/lib/auth";
import type { Show, Musician, Setlist, Availability } from "@/schema";

export type ShowRow = Row<Show>;

/** Everything a show screen needs that the whole band can read. */
export function useBand() {
  const p = useProfile();
  const shows = useCollection<Show>("shows");
  const musicians = useCollection<Musician>("musicians");
  const { doc: artist, musicianId } = useArtist();
  const setlists = useCollection<Setlist>("setlists");
  // Rules only let a member read asks they are on, so a member's query must say so.
  const asks = useCollection<Availability>("availability", {
    where: p.role === "member" ? [["askedMusicianIds", "array-contains", musicianId ?? "none"]] : [],
  });
  return {
    shows: shows.rows ?? [], musicians: musicians.rows ?? [], artist: artist ?? undefined, setlists: setlists.rows ?? [], asks: asks.rows ?? [],
    loading: [shows, musicians, setlists, asks].some((c) => c.loading) || !artist,
  };
}

export const STATUS_CHIP: Record<string, [string, string]> = {
  hold: ["Hold", "a"], confirmed: ["Confirmed", "g"], played: ["Played", ""], canceled: ["Canceled", ""], dropped: ["Dropped", ""],
};

export const nameOf = (ms: Row<Musician>[], id?: string) => ms.find((m) => m.id === id)?.name ?? "Someone";
