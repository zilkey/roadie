"use client";
import Link from "next/link";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { MIME_ICON, mimeGroup } from "@/lib/music";
import type { FileDoc, Musician, Rehearsal, Setlist, Show, Song } from "@/schema";

export type FileRow = Row<FileDoc>;
export type SongRow = Row<Song>;

/** Everything the Music screens read (the whole band can read all of it). */
export function useMusic() {
  const songs = useCollection<Song>("songs");
  const files = useCollection<FileDoc>("files");
  const setlists = useCollection<Setlist>("setlists");
  const rehearsals = useCollection<Rehearsal>("rehearsals");
  const musicians = useCollection<Musician>("musicians");
  const shows = useCollection<Show>("shows");
  return {
    songs: songs.rows ?? [], files: files.rows ?? [], setlists: setlists.rows ?? [], rehearsals: rehearsals.rows ?? [],
    musicians: musicians.rows ?? [], shows: shows.rows ?? [],
    loading: [songs, files, setlists, rehearsals, musicians, shows].some((c) => c.loading),
  };
}

/** Active musicians with an email: the people who must be able to open every file. */
export const bandMembers = (ms: Row<Musician>[]) => ms.filter((m) => m.active && m.email);

export function FileIcon({ mime }: { mime?: string }) {
  const g = mimeGroup(mime);
  return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-soft font-bold" data-testid={`icon-${g}`} aria-hidden>{MIME_ICON[g]}</span>;
}

export function BackTo({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="s font-semibold" data-testid="back">← {label}</Link>;
}

export function Missing({ what }: { what: string }) {
  return <div className="card" data-testid="not-found">That {what} isn&apos;t here any more. <Link href="/songs" className="font-bold">Back to Songs</Link></div>;
}

export const fmtDay = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
