"use client";
import { useRef } from "react";
import Link from "@/lib/artist";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import type { ChecklistLike } from "@/lib/shows";
import type { Setlist, Song } from "@/schema";
import { ChecklistCard } from "../checklists/ChecklistCard";
import { useChecklistTemplates } from "../checklists/shared";

const open = (l: ChecklistLike) => l.items.some((i) => !i.done);

/**
 * Under the show's checklists: the to-dos of the songs on its setlist, one section per song in set order, each holding the song's
 * lists that still have something open (ticked items stay visible in them; a list finished here stays until the page is left). Songs with nothing open, and off-library one-offs,
 * don't appear; with none at all the section is gone. Ticking here ticks the song's own list (the song page and To Dos › Songs).
 */
export function SongTodosCard({ showId, artistId, admin }: { showId: string; artistId?: string; admin: boolean }) {
  const setlist = useDoc<Setlist>("setlists", showId).doc;
  const songs = useCollection<Song>("songs").rows ?? [];
  const live = new Set(useChecklistTemplates(artistId, admin).templates.map((t) => t.id));
  // A list that was open while this page is up stays (ticked off, folded) until the page is left, so finishing it here doesn't yank it away.
  const seen = useRef(new Set<string>());
  const ids = [...new Set((setlist?.items ?? []).flatMap((i) => (i.type === "song" && i.songId ? [i.songId] : [])))];
  const rows = ids.flatMap((id) => {
    const s = songs.find((x) => x.id === id);
    const lists = (s?.checklists ?? []).filter((l) => open(l) || seen.current.has(`${id}:${l.id}`));
    for (const l of lists) seen.current.add(`${id}:${l.id}`);
    return s && lists.length ? [{ s, lists }] : [];
  });
  if (!rows.length) return null;
  return (
    <section className="mt-6 grid gap-4" data-testid="song-todos">
      <h2 className="text-lg font-bold">Songs</h2>
      {rows.map(({ s, lists }) => (
        <div key={s.id} className="grid gap-2" data-testid={`song-todos-${s.id}`}>
          <h3 className="font-bold"><Link href={`/songs/${s.id}`} className="underline" data-testid="song-todos-title">{s.title}</Link></h3>
          {lists.map((l) => (
            <ChecklistCard key={l.id} host={{ kind: "song", id: s.id, artistId, checklists: s.checklists ?? [] }} list={l} admin={admin} templateLive={!!l.templateId && live.has(l.templateId)} />
          ))}
        </div>
      ))}
    </section>
  );
}
