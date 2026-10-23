"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { Seg } from "@/components/booking/common";
import { useProfile } from "@/lib/auth";
import { fmtLen, mimeGroup } from "@/lib/music";
import { fmtDur } from "@/lib/shows";
import { fmtDay, useMusic } from "@/components/music/common";

export default function SongsPage() {
  return <Suspense fallback={<div className="s">Loading…</div>}><Songs /></Suspense>;
}

type SegKey = "active" | "learning" | "idea" | "retired" | "setlists" | "rehearsals";

function Songs() {
  const params = useSearchParams();
  const router = useRouter();
  const p = useProfile();
  const admin = p.role === "admin";
  const m = useMusic();
  const { call, error, busy } = useCommand();
  const [seg, setSeg] = useState<SegKey>("active");
  const [q, setQ] = useState("");
  const [newSetlist, setNewSetlist] = useState("");
  const setlistParam = params.get("setlist");

  // Slice 4 links here as /songs?setlist=ID: go to the real setlist page.
  useEffect(() => { if (setlistParam) router.replace(`/songs/setlists/${setlistParam}`); }, [setlistParam, router]);

  const playable = useMemo(() => new Set(m.files.filter((f) => ["audio", "video"].includes(mimeGroup(f.mimeType))).map((f) => f.songId)), [m.files]);
  const songs = useMemo(() => {
    const t = q.trim().toLowerCase();
    return m.songs.filter((s) => s.status === seg && (!t || s.title.toLowerCase().includes(t) || (s.writers ?? "").toLowerCase().includes(t))).sort((a, b) => a.title.localeCompare(b.title));
  }, [m.songs, seg, q]);

  if (setlistParam) return <div className="s">Opening setlist…</div>;
  const showOf = (id?: string) => m.shows.find((s) => s.id === id);

  return (
    <div className="grid gap-3" data-testid="songs-page">
      <PageTitle title="Songs" sub="Everything we play, with key and length. Tap for charts and recordings." />
      {admin && <Link href="/songs/new" className="btn acc justify-self-start" data-testid="add-song-btn">Add a song</Link>}
      <Seg<SegKey> testid="songs-seg" value={seg} onChange={setSeg} options={[["active", "Playing"], ["learning", "Learning"], ["idea", "Ideas"], ["retired", "Retired"], ["setlists", "Setlists"], ["rehearsals", "Rehearsals"]]} />
      {seg !== "setlists" && seg !== "rehearsals" && (
        <input className="input" placeholder="Search songs…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="songs-filter" aria-label="Filter songs" />
      )}

      {seg === "setlists" ? (
        <div className="grid gap-2" data-testid="setlists-list">
          {admin && (
            <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!newSetlist.trim()) return; const r = await call("setlists.create", { name: newSetlist.trim() }); if (r?.id) router.push(`/songs/setlists/${r.id}`); }}>
              <input className="input" placeholder="New setlist name…" value={newSetlist} onChange={(e) => setNewSetlist(e.target.value)} data-testid="new-setlist-name" aria-label="New setlist name" />
              <button className="btn acc" disabled={busy} data-testid="new-setlist">Create</button>
            </form>
          )}
          {!m.loading && m.setlists.length === 0 && <span className="s">No setlists yet.</span>}
          {[...m.setlists].sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
            const show = showOf(s.showId);
            return (
              <Link key={s.id} href={`/songs/setlists/${s.id}`} className="card" data-testid={`setlist-${s.id}`}>
                <div className="flex items-center justify-between"><b>{s.name}</b><span className="s font-semibold">Open ›</span></div>
                <span className="s">{s.items.filter((i) => i.type === "song").length} songs · {fmtDur(s.totalSec)}{show ? ` · ${fmtDay(show.date)} ${show.venue.name}` : ""}</span>
              </Link>
            );
          })}
        </div>
      ) : seg === "rehearsals" ? (
        <div className="grid gap-2" data-testid="rehearsals-list">
          {admin && <Link href="/songs/rehearsals/new" className="btn acc justify-self-start" data-testid="log-rehearsal">Log a rehearsal</Link>}
          {!m.loading && m.rehearsals.length === 0 && <span className="s">No rehearsals logged yet.</span>}
          {[...m.rehearsals].sort((a, b) => b.date.localeCompare(a.date)).map((r) => (
            <Link key={r.id} href={`/songs/rehearsals/${r.id}`} className="card" data-testid={`rehearsal-${r.id}`}>
              <div className="flex items-center justify-between"><b>{fmtDay(r.date)}{r.place ? ` · ${r.place}` : ""}</b><span className="s font-semibold">Open ›</span></div>
              <span className="s">{r.songs.length} songs run</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="grid gap-2" data-testid="songs-list">
          {!m.loading && songs.length === 0 && <span className="s">{q ? "No songs match." : "Nothing here yet."}</span>}
          {songs.map((s) => (
            <Link key={s.id} href={`/songs/${s.id}`} className="card" data-testid={`song-${s.id}`}>
              <div className="flex items-center justify-between gap-2">
                <b>{s.title}</b>
                {playable.has(s.id) && <span className="chip m" title="Has a recording">♪</span>}
              </div>
              <span className="s">{[s.key, s.lengthSec ? fmtLen(s.lengthSec) : null].filter(Boolean).join(" · ") || "No key or length yet"}</span>
            </Link>
          ))}
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
