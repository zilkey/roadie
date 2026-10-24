"use client";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { todayStr } from "@/lib/booking";
import { fmtLen, move, parseLen, setlistSlack } from "@/lib/music";
import { SaveStatus } from "@/components/SaveStatus";
import { useAutosave } from "@/lib/autosave";
import { BackTo, Missing, fmtDay, useMusic } from "@/components/music/common";
import type { SetlistItem } from "@/schema";
import type { z } from "zod";
import { showName } from "@/lib/shows";

type Item = z.infer<typeof SetlistItem>;

export default function SetlistPage() {
  const { id } = useParams<{ id: string }>();
  const m = useMusic();
  const sl = m.setlists.find((s) => s.id === id);
  if (m.loading) return <div className="s">Loading…</div>;
  if (!sl) return <Missing what="setlist" />;
  return <View sl={sl} m={m} />;
}

/** What the server needs: songs by id (it fills title, length, key), breaks with their own title and length. */
const payload = (items: Item[]) => items.map((i) => (i.type === "song"
  ? { type: "song", songId: i.songId, ...(i.note ? { note: i.note } : {}) }
  : { type: "break", title: i.title, ...(i.lengthSec != null ? { lengthSec: i.lengthSec } : {}), ...(i.note ? { note: i.note } : {}) }));

function View({ sl, m }: { sl: ReturnType<typeof useMusic>["setlists"][number]; m: ReturnType<typeof useMusic> }) {
  const admin = useProfile().role === "admin";
  const router = useRouter();
  const { call, error, busy } = useCommand();
  // Existing record = autosave through setlists.update: the name saves as you type, list changes save at once (status + Undo toast).
  const as = useAutosave({ command: "setlists.update", id: sl.id, rev: sl.rev, title: sl.name });
  const [items, setItems] = useState<Item[]>(sl.items);
  const [drag, setDrag] = useState<number | null>(null);
  const [songId, setSongId] = useState("");
  const [breakTitle, setBreakTitle] = useState("Talk / tune");
  const [breakLen, setBreakLen] = useState("1:00");
  const serverKey = JSON.stringify(sl.items);
  useEffect(() => { setItems(sl.items); }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = todayStr();
  const show = m.shows.find((s) => s.setlistId === sl.id);
  const candidates = m.shows.filter((s) => s.status !== "canceled" && s.status !== "played" && s.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  if (show && !candidates.includes(show)) candidates.unshift(show);
  const slack = setlistSlack(sl.totalSec, show?.times.setLength);
  const over = slack != null && slack < 0;

  const save = async (next: Item[]) => { setItems(next); as.patch({ items: payload(next) }, { now: true }); };
  const reorder = (from: number, to: number) => { const next = move(items, from, to); if (next !== items) save(next); };
  const pickable = m.songs.filter((s) => s.status === "active" || s.status === "learning").sort((a, b) => a.title.localeCompare(b.title));
  const songTitle = (i: Item) => (i.type === "song" ? m.songs.find((s) => s.id === i.songId)?.title ?? i.title : i.title);

  return (
    <div className="grid gap-3" data-testid="setlist-page">
      <BackTo href="/songs" label="Songs" />
      <PageTitle title={sl.name} />
      {admin && (
        <div className="flex items-center gap-2">
          <input className="input" aria-label="Setlist name" data-testid="setlist-name" {...as.bind("name", sl.name, { toPatch: (t) => t.trim() })} />
          <SaveStatus {...as.statusProps} />
        </div>
      )}
      <div className={`card ${over ? "" : slack != null ? "hi" : ""}`} data-testid="setlist-total" data-over={over ? "1" : "0"}>
        <div className="flex items-baseline justify-between gap-2">
          <b className="font-mono text-xl" style={over ? { color: "#C0392B" } : undefined} data-testid="total-time">{fmtLen(sl.totalSec)}{show?.times.setLength ? ` of ${fmtLen(show.times.setLength * 60)}` : ""}</b>
          {slack != null && <span className={`chip ${over ? "" : "g"}`} style={over ? { background: "#C0392B", color: "#fff" } : undefined} data-testid="fit">{over ? `${fmtLen(-slack)} over` : "Fits"}</span>}
        </div>
        <span className="s">{items.filter((i) => i.type === "song").length} songs{show && !show.times.setLength ? " · the show has no set length yet" : ""}{!show ? " · not attached to a show" : ""}</span>
      </div>

      <ol className="grid gap-1.5" data-testid="setlist-items">
        {items.length === 0 && <li className="s">Nothing in this setlist yet.</li>}
        {items.map((it, i) => (
          <li key={`${i}-${it.songId ?? it.title}`} className="flex items-center gap-2 rounded-lg border border-line bg-panel p-2" data-testid={`item-${i}`}
            draggable={admin} onDragStart={() => setDrag(i)} onDragOver={(e) => admin && e.preventDefault()} onDrop={() => { if (admin && drag != null) reorder(drag, i); setDrag(null); }} onDragEnd={() => setDrag(null)}>
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
                <button className="btn danger sm" onClick={() => save(items.filter((_, j) => j !== i))} aria-label={`Remove ${songTitle(it)}`} data-testid="item-remove">✕</button>
              </span>
            )}
          </li>
        ))}
      </ol>

      {admin && (
        <div className="grid gap-2">
          <div className="flex gap-2">
            <select className="select" value={songId} onChange={(e) => setSongId(e.target.value)} aria-label="Song to add" data-testid="add-song-select">
              <option value="">Pick a song…</option>
              {pickable.map((s) => <option key={s.id} value={s.id}>{s.title}{s.key ? ` · ${s.key}` : ""}</option>)}
            </select>
            <button className="btn ghost" disabled={!songId} data-testid="add-song-item" onClick={async () => {
              const s = m.songs.find((x) => x.id === songId)!;
              setSongId("");
              await save([...items, { type: "song", songId: s.id, title: s.title, lengthSec: s.lengthSec, key: s.key }]);
            }}>+ Song</button>
          </div>
          <div className="flex gap-2">
            <input className="input" value={breakTitle} onChange={(e) => setBreakTitle(e.target.value)} aria-label="Break name" data-testid="break-title" />
            <input className="input !w-24" value={breakLen} onChange={(e) => setBreakLen(e.target.value)} aria-label="Break length" data-testid="break-len" />
            <button className="btn ghost" data-testid="add-break" onClick={() => save([...items, { type: "break", title: breakTitle.trim() || "Break", lengthSec: parseLen(breakLen) ?? 60 }])}>+ Break</button>
          </div>
        </div>
      )}

      <div className="grid gap-1" data-testid="setlist-show">
        <span className="lbl">Used for</span>
        {admin ? (
          <select className="select" value={show?.id ?? ""} onChange={(e) => e.target.value ? call("setlists.attach", { showId: e.target.value, setlistId: sl.id }) : show && call("setlists.attach", { showId: show.id, setlistId: null })} data-testid="attach-show" aria-label="Attach to a show">
            <option value="">No show</option>
            {candidates.map((s) => <option key={s.id} value={s.id}>{fmtDay(s.date)} · {showName(s)}{s.times.setLength ? ` · ${s.times.setLength} min` : ""}</option>)}
          </select>
        ) : null}
        {show ? <Link href={`/shows/${show.id}`} className="s font-semibold" data-testid="show-link">{fmtDay(show.date)} · {showName(show)}</Link> : !admin && <span className="s">No show yet.</span>}
      </div>
      {admin && (
        <button className="btn danger justify-self-start" disabled={busy} data-testid="setlist-archive" onClick={async () => { if (confirm(`Archive ${sl.name}?`) && (await call("setlists.remove", { id: sl.id }))) router.push("/songs"); }}>Archive setlist</button>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
