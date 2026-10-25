"use client";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { Tabs } from "@/components/booking/common";
import { useProfile } from "@/lib/auth";
import { fmtLen, mimeGroup } from "@/lib/music";
import { useMusic } from "@/components/music/common";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";

export default function SongsPage() {
  return <Suspense fallback={<div className="s">Loading…</div>}><Songs /></Suspense>;
}

type SegKey = "active" | "learning" | "idea" | "retired";
const SEGS: [SegKey, string][] = [["active", "Playing"], ["learning", "Learning"], ["idea", "Ideas"], ["retired", "Retired"]];

function DocIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}

function Songs() {
  const params = useSearchParams();
  const router = useRouter();
  const p = useProfile();
  const admin = p.role === "admin";
  const m = useMusic();
  const { call, error, busy } = useCommand();
  const segParam = params.get("seg");
  const [seg, setSeg] = useState<SegKey>(segParam === "learning" || segParam === "idea" || segParam === "retired" ? segParam : "active");
  const [q, setQ] = useState("");
  const setlistParam = params.get("setlist");

  // Slice 4 links here as /songs?setlist=ID: go to the real setlist page.
  useEffect(() => { if (setlistParam) router.replace(`/setlists/${setlistParam}`); }, [setlistParam, router]);

  const playable = useMemo(() => new Set(m.files.filter((f) => ["audio", "video"].includes(mimeGroup(f.mimeType))).map((f) => f.songId)), [m.files]);
  const songs = useMemo(() => {
    const t = q.trim().toLowerCase();
    return m.songs.filter((s) => s.status === seg && (!t || s.title.toLowerCase().includes(t) || (s.writers ?? "").toLowerCase().includes(t))).sort((a, b) => a.title.localeCompare(b.title));
  }, [m.songs, seg, q]);
  const count = (k: SegKey) => m.songs.filter((s) => s.status === k).length;

  if (setlistParam) return <div className="s">Opening setlist…</div>;

  // No songs at all: only the welcome card, none of the segments or search.
  if (!m.loading && m.songs.length === 0) {
    return (
      <WelcomeEmpty section="songs" variant={2} title="Welcome to Songs!"
        body="Everything we play, with its key and length. Charts and recordings, and the songs we're learning or just thinking about, all live here too."
        actions={admin ? <Link href="/songs/new" className="btn acc" data-testid="add-song-btn">Add a song</Link> : undefined}>
        <ErrorBox error={error} />
      </WelcomeEmpty>
    );
  }

  return (
    <div className="grid gap-5" data-testid="songs-page">
      <PageTitle title="Songs" center
        actions={admin ? <Link href="/songs/new" className="btn acc" data-testid="add-song-btn">Add a song</Link> : undefined} />
      <Tabs<SegKey> testid="songs-seg" value={seg} onChange={setSeg}
        options={SEGS.map(([k, label]) => [k, <>{label} <span className="chip a ml-1">{count(k)}</span></>])} />
      <input className="input" placeholder="Search songs…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="songs-filter" aria-label="Filter songs" />
      {!m.loading && songs.length === 0
        ? <div className="empty" data-testid="songs-list"><span>{q ? "No songs match." : "Nothing here yet."}</span></div>
        : (
          <div className="song-tw" data-testid="songs-list">
            <table className="song-table">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col" className="key">Key</th>
                  <th scope="col" className="len">Time</th>
                  <th scope="col" className="lyr">Lyrics</th>
                </tr>
              </thead>
              <tbody>
                {songs.map((s) => (
                  <tr key={s.id} data-testid={`song-${s.id}`}>
                    <td>
                      <Link href={`/songs/${s.id}`} className="nm">{s.title}</Link>
                      {playable.has(s.id) && <span className="chip m ml-2" title="Has a recording">♪</span>}
                    </td>
                    <td className="key">{s.key || <span className="dash">—</span>}</td>
                    <td className="len">{s.lengthSec ? fmtLen(s.lengthSec) : <span className="dash">—</span>}</td>
                    <td className="lyr">
                      {s.lyricsDoc
                        ? <a href={s.lyricsDoc.url} target="_blank" rel="noreferrer" aria-label={`Lyrics for ${s.title} (opens doc)`}><DocIcon />Lyrics</a>
                        : <span className="dash">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <ErrorBox error={error} />
    </div>
  );
}
