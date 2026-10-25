"use client";
import { useState } from "react";
import Link from "@/lib/artist";
import { fmtLen, move, parseLen } from "@/lib/music";
import { useDragReorder } from "@/lib/drag-reorder";
import type { SetlistItem } from "@/schema";
import type { z } from "zod";
import type { SongRow } from "./common";

export type SetlistItemT = z.infer<typeof SetlistItem>;

/**
 * What the server needs: songs by id (it fills title, length, key), breaks with their own title and length.
 * An off-library song (a one-off with no song behind it) has nothing to look up, so it carries its own title,
 * length and key -- dropping them here would blank the song's name on the next save.
 */
export const itemsPayload = (items: SetlistItemT[]) => items.map((i) => {
  if (i.type === "break") {
    return { type: "break", title: i.title, ...(i.lengthSec != null ? { lengthSec: i.lengthSec } : {}), ...(i.note ? { note: i.note } : {}) };
  }
  if (!i.songId) {
    return { type: "song", title: i.title, ...(i.lengthSec != null ? { lengthSec: i.lengthSec } : {}), ...(i.key ? { key: i.key } : {}), ...(i.note ? { note: i.note } : {}) };
  }
  return { type: "song", songId: i.songId, ...(i.note ? { note: i.note } : {}) };
});

/**
 * The ordered list of songs and breaks, shared by the template editor and a show's Setlist tab: drag / arrows to reorder,
 * remove, add a song, add a break. Stateless about saving: every change calls `onChange(next)` with the whole new list.
 */
export function SetlistItemsEditor({ items, onChange, songs, admin, empty = "Nothing in this setlist yet." }: {
  items: SetlistItemT[]; onChange(next: SetlistItemT[]): void; songs: SongRow[]; admin: boolean; empty?: string;
}) {
  const [songId, setSongId] = useState("");
  const [breakTitle, setBreakTitle] = useState("Talk / tune");
  const [breakLen, setBreakLen] = useState("1:00");
  const reorder = (from: number, to: number) => { const next = move(items, from, to); if (next !== items) onChange(next); };
  const dr = useDragReorder(reorder);
  const pickable = songs.filter((s) => s.status === "active" || s.status === "learning").sort((a, b) => a.title.localeCompare(b.title));
  const songTitle = (i: SetlistItemT) => (i.type === "song" ? songs.find((s) => s.id === i.songId)?.title ?? i.title : i.title);

  return (
    <div className="card">
      <ol className="grid gap-1.5" data-testid="setlist-items">
        {items.length === 0 && <li className="s">{empty}</li>}
        {items.map((it, i) => (
          <li key={`${i}-${it.songId ?? it.title}`} className="flex items-center gap-2 rounded-lg border border-line bg-panel p-2" data-testid={`item-${i}`}
            {...(admin ? { ...dr.row(i), ...dr.handle(i) } : {})}>
            {admin && <span className="cursor-grab select-none text-muted" aria-hidden>⋮⋮</span>}
            <span className="min-w-0 flex-1 truncate">
              {it.type === "song" && it.songId ? <Link href={`/songs/${it.songId}`} className="font-semibold" data-testid="item-title">{songTitle(it)}</Link> : <span className="italic" data-testid="item-title">{it.title}</span>}
              {it.key && <span className="s"> · {it.key}</span>}
            </span>
            <span className="font-mono text-sm" data-testid="item-len">{fmtLen(it.lengthSec ?? 0)}</span>
            {admin && (
              <span className="flex gap-1">
                <button className="btn ghost sm" disabled={i === 0} onClick={() => reorder(i, i - 1)} aria-label={`Move ${songTitle(it)} up`} data-testid="item-up">↑</button>
                <button className="btn ghost sm" disabled={i === items.length - 1} onClick={() => reorder(i, i + 1)} aria-label={`Move ${songTitle(it)} down`} data-testid="item-down">↓</button>
                <button className="btn danger sm" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${songTitle(it)}`} data-testid="item-remove">✕</button>
              </span>
            )}
          </li>
        ))}
      </ol>

      {admin && (
        <div className="grid gap-2 border-t border-divider pt-3">
          <div className="flex gap-2">
            <select className="select" value={songId} onChange={(e) => setSongId(e.target.value)} aria-label="Song to add" data-testid="add-song-select">
              <option value="">Pick a song…</option>
              {pickable.map((s) => <option key={s.id} value={s.id}>{s.title}{s.key ? ` · ${s.key}` : ""}</option>)}
            </select>
            <button className="btn ghost" disabled={!songId} data-testid="add-song-item" onClick={() => {
              const s = songs.find((x) => x.id === songId)!;
              setSongId("");
              onChange([...items, { type: "song", songId: s.id, title: s.title, lengthSec: s.lengthSec, key: s.key }]);
            }}>+ Song</button>
          </div>
          <div className="flex gap-2">
            <input className="input" value={breakTitle} onChange={(e) => setBreakTitle(e.target.value)} aria-label="Break name" data-testid="break-title" />
            <input className="input !w-24" value={breakLen} onChange={(e) => setBreakLen(e.target.value)} aria-label="Break length" data-testid="break-len" />
            <button className="btn ghost" data-testid="add-break" onClick={() => onChange([...items, { type: "break", title: breakTitle.trim() || "Break", lengthSec: parseLen(breakLen) ?? 60 }])}>+ Break</button>
          </div>
        </div>
      )}
    </div>
  );
}
