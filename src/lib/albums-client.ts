"use client";
import { useMaybeArtist } from "./artist";
import { useCollection } from "./firestore-hooks";
import type { Album } from "@/schema";

/** Has the band made an album yet? Albums sits in the nav only once it has (its pages still open by link before that). */
export function useAlbumsOn(): boolean {
  const artistId = useMaybeArtist()?.artistId;
  const albums = useCollection<Album>("albums", { where: [["artistId", "==", artistId ?? ""]], limit: 1, skip: !artistId });
  return (albums.rows?.length ?? 0) > 0;
}
