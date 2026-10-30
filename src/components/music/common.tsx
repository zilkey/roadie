"use client";
import Link from "@/lib/artist";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { fileGroup, type FileKind, type MimeGroup, type Provider } from "@/lib/music";
import type { FileDoc, Musician, Rehearsal, Setlist, SetlistTemplate, Show, Song } from "@/schema";

export type FileRow = Row<FileDoc>;
export type SongRow = Row<Song>;

/** Everything the Music screens read (the whole band can read all of it). */
export function useMusic() {
  const songs = useCollection<Song>("songs");
  const files = useCollection<FileDoc>("files");
  const setlists = useCollection<Setlist>("setlists");
  const templates = useCollection<SetlistTemplate>("setlistTemplates");
  const rehearsals = useCollection<Rehearsal>("rehearsals");
  const musicians = useCollection<Musician>("musicians");
  const shows = useCollection<Show>("shows");
  return {
    songs: songs.rows ?? [], files: files.rows ?? [], setlists: setlists.rows ?? [], templates: templates.rows ?? [], rehearsals: rehearsals.rows ?? [],
    musicians: musicians.rows ?? [], shows: shows.rows ?? [],
    loading: [songs, files, setlists, templates, rehearsals, musicians, shows].some((c) => c.loading),
  };
}

/** Active musicians with an email: the people who must be able to open every file. */
export const bandMembers = (ms: Row<Musician>[]) => ms.filter((m) => m.active && m.email);

const ICON_PATH: Record<MimeGroup | Provider, string[]> = {
  doc: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5", "M9 13h6M9 17h6"],
  pdf: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5", "M9 15h1.5a1.2 1.2 0 0 0 0-2.4H9V17"],
  audio: ["M9 18V6l10-2v12", "M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3z", "M19 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z"],
  video: ["M4 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z", "M17 10l5-3v10l-5-3"],
  other: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5"],
  drive: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5"],
  spotify: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M7.5 9.5c3-.9 6-.6 9 1", "M8 12.8c2.5-.7 5-.4 7.5.9", "M8.6 15.8c2-.5 4-.3 6 .7"],
  youtube: ["M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z", "M10 9.5v5l4.5-2.5z"],
  web: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
};

/** A stroke icon in the theme's muted ink. Pass provider for a non-Drive link (no mimeType: the icon says where it goes); kind is the fallback when the mimeType is missing. */
export function FileIcon({ mime, kind, provider }: { mime?: string; kind?: FileKind; provider?: Provider }) {
  const g = fileGroup({ mimeType: mime, kind });
  const key = provider ?? g;
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-soft text-muted" data-testid={`icon-${key}`} aria-hidden>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {ICON_PATH[key].map((d, i) => <path key={i} d={d} />)}
      </svg>
    </span>
  );
}

export function BackTo({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="s font-semibold" data-testid="back">← {label}</Link>;
}

export function Missing({ what }: { what: string }) {
  return <div className="card" data-testid="not-found">That {what} isn&apos;t here any more. <Link href="/songs" className="font-bold">Back to Songs</Link></div>;
}

export const fmtDay = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
