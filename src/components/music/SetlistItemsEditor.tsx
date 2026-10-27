"use client";
import { useState } from "react";
import Link from "@/lib/artist";
import { Dialog } from "@/components/ui";
import { SongSearch } from "./SongSearch";
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
  const alts = i.alts?.length ? { alts: i.alts.map((a) => ({ songId: a.songId })) } : {};
  if (i.type === "break") {
    return { type: "break", title: i.title, ...(i.lengthSec != null ? { lengthSec: i.lengthSec } : {}), ...(i.note ? { note: i.note } : {}) };
  }
  if (!i.songId) {
    return { type: "song", title: i.title, ...(i.lengthSec != null ? { lengthSec: i.lengthSec } : {}), ...(i.key ? { key: i.key } : {}), ...(i.note ? { note: i.note } : {}), ...alts };
  }
  return { type: "song", songId: i.songId, ...(i.note ? { note: i.note } : {}), ...alts };
});

/**
 * The ordered list of songs and breaks, shared by the template editor and a show's Setlist tab: drag to reorder, remove,
 * add a song, add a break, and pin alternates to a song (Alt opens a song search). An alternate lives on its song's item,
 * so it drags with it, and it never counts toward the time. Stateless about saving: every change calls `onChange(next)` with the whole new list.
 * `bpm` shows each song's tempo before its time, read live from the song (items don't carry a copy).
 */
export function SetlistItemsEditor({ items, onChange, songs, admin, empty = "Nothing in this setlist yet.", bpm = false }: {
  items: SetlistItemT[]; onChange(next: SetlistItemT[]): void; songs: SongRow[]; admin: boolean; empty?: string; bpm?: boolean;
}) {
  const [songId, setSongId] = useState("");
  const [breakTitle, setBreakTitle] = useState("Talk / tune");
  const [breakLen, setBreakLen] = useState("1:00");
  const [altFor, setAltFor] = useState<number | null>(null);
  const reorder = (from: number, to: number) => { const next = move(items, from, to); if (next !== items) onChange(next); };
  const dr = useDragReorder(reorder);
  const pickable = songs.filter((s) => s.status === "active" || s.status === "learning").sort((a, b) => a.title.localeCompare(b.title));
  const songBpm = (i: SetlistItemT) => (i.type === "song" && i.songId ? songs.find((s) => s.id === i.songId)?.bpm : undefined);
  const songTitle = (i: SetlistItemT) => (i.type === "song" ? songs.find((s) => s.id === i.songId)?.title ?? i.title : i.title);
  const altTitle = (a: { songId: string; title: string }) => songs.find((s) => s.id === a.songId)?.title ?? a.title;
  const patch = (i: number, alts: SetlistItemT["alts"]) => onChange(items.map((it, j) => {
    if (j !== i) return it;
    const { alts: _old, ...rest } = it;
    return alts?.length ? { ...rest, alts } : rest;
  }));
  const addAlt = (songId: string) => {
    const s = songs.find((x) => x.id === songId);
    if (altFor == null || !s) return;
    patch(altFor, [...(items[altFor].alts ?? []), { songId: s.id, title: s.title, ...(s.key ? { key: s.key } : {}) }]);
    setAltFor(null);
  };
  const altItem = altFor != null ? items[altFor] : undefined;

  return (
    <div className="card">
      <ol className="grid gap-1.5" data-testid="setlist-items">
        {items.length === 0 && <li className="s">{empty}</li>}
        {items.map((it, i) => (
          <li key={`${i}-${it.songId ?? it.title}`} className={`sl-row grid gap-1.5 rounded-lg border p-2${it.type === "break" ? " break" : !it.lengthSec ? " nolen" : ""}`} data-testid={`item-${i}`}
            data-kind={it.type} data-nolen={it.type === "song" && !it.lengthSec ? "1" : undefined}
            {...(admin ? { ...dr.row(i), ...dr.handle(i) } : {})}>
            <div className="flex items-center gap-2">
            {admin && <span className="cursor-grab select-none text-muted" aria-hidden>⋮⋮</span>}
            <span className="min-w-0 flex-1 truncate">
              {it.type === "song" && it.songId ? <Link href={`/songs/${it.songId}`} className="font-semibold" data-testid="item-title">{songTitle(it)}</Link> : <span className="italic" data-testid="item-title">{it.title}</span>}
              {it.key && <span className="s"> · {it.key}</span>}
            </span>
            {bpm && songBpm(it) != null && <span className="s font-mono" data-testid="item-bpm">{songBpm(it)} bpm</span>}
            <span className="font-mono text-sm" data-testid="item-len">{fmtLen(it.lengthSec ?? 0)}</span>
            {admin && (
              <span className="flex gap-1">
                {it.type === "song" && <button className="btn ghost sm" onClick={() => setAltFor(i)} aria-label={`Add an alternate for ${songTitle(it)}`} data-testid="item-alt">Alt</button>}
                <button className="btn danger sm" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${songTitle(it)}`} data-testid="item-remove">✕</button>
              </span>
            )}
            </div>
            {it.alts?.length ? (
              <ul className="grid gap-1" data-testid="item-alts">
                {it.alts.map((a, k) => (
                  <li key={a.songId} className="sl-alt ml-6 flex items-center gap-2 rounded-md border px-2 py-1 text-sm" data-testid="alt">
                    <span className="sl-alt-tag">Alt</span>
                    <span className="min-w-0 flex-1 truncate">
                      <Link href={`/songs/${a.songId}`} className="font-semibold" data-testid="alt-title">{altTitle(a)}</Link>
                      {a.key && <span className="s"> · {a.key}</span>}
                    </span>
                    {admin && <button className="btn danger sm" onClick={() => patch(i, it.alts!.filter((_, j) => j !== k))} aria-label={`Remove alternate ${altTitle(a)}`} data-testid="alt-remove">✕</button>}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>

      <Dialog open={altItem != null} onClose={() => setAltFor(null)} title={altItem ? `Alternate for ${songTitle(altItem)}` : "Alternate"} testid="alt-dialog">
        {altItem && (
          <>
            <SongSearch songs={pickable} exclude={[...(altItem.songId ? [altItem.songId] : []), ...(altItem.alts ?? []).map((a) => a.songId)]} onAdd={addAlt} testid="alt-search" />
            <div className="flex justify-end">
              <button type="button" className="btn ghost" data-testid="alt-cancel" onClick={() => setAltFor(null)}>Cancel</button>
            </div>
          </>
        )}
      </Dialog>

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
          <div className="flex items-center gap-3 text-xs text-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-divider" />OR…<span className="h-px flex-1 bg-divider" />
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
