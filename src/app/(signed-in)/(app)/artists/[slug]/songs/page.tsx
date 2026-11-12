"use client";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Dialog, ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { Tabs } from "@/components/booking/common";
import { useProfile } from "@/lib/auth";
import { defaultKeep, fmtLen, mimeGroup, refsLabel, songRefs, STATUS_LABEL, type SongStatus } from "@/lib/music";
import { useMusic, type SongRow } from "@/components/music/common";
import { useCollection } from "@/lib/firestore-hooks";
import type { ReleaseTrack } from "@/schema";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";

export default function SongsPage() {
  return <Suspense fallback={null}><Songs /></Suspense>;
}

type SegKey = "active" | "learning" | "retired" | "unlinked" | "writing";
// Unlinked cuts across statuses: every song with no Drive file yet (a Spotify/YouTube/web link doesn't count), to work through by hand.
// Writing (songs still being written) is last, and a song there is never "unlinked": it isn't finished enough to need files.
const SEGS: [SegKey, string][] = [["active", "Playing"], ["learning", "Learning"], ["retired", "Retired"], ["unlinked", "Unlinked"], ["writing", "Writing"]];
const isSeg = (k: string | null): k is SegKey => SEGS.some(([s]) => s === k);
/** `linked`: ids of songs with a Drive file. */
const inSeg = (s: { id: string; status: string }, k: SegKey, linked: Set<string | undefined>) => (k === "unlinked" ? s.status !== "writing" && !linked.has(s.id) : s.status === k);

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
  // The artist's song fields ticked "In table" (Admin > Custom fields), in the artist's order, between Time and Lyrics.
  const cols = (useArtist().doc?.songFields ?? []).filter((f) => f.inTable);
  const { call, error, busy } = useCommand();
  const segParam = params.get("seg");
  const [seg, setSeg] = useState<SegKey>(isSeg(segParam) ? segParam : "active");
  const [q, setQ] = useState("");
  const setlistParam = params.get("setlist");
  // Admins tick songs to merge duplicates. The ticks live apart from the search and the tabs, so filtering never clears them.
  const [ticked, setTicked] = useState<string[]>([]);
  const [merging, setMerging] = useState(false);

  // Slice 4 links here as /songs?setlist=ID: go to the real setlist page.
  useEffect(() => { if (setlistParam) router.replace(`/setlists/${setlistParam}`); }, [setlistParam, router]);

  const playable = useMemo(() => new Set(m.files.filter((f) => ["audio", "video"].includes(mimeGroup(f.mimeType))).map((f) => f.songId)), [m.files]);
  const linked = useMemo(() => new Set(m.files.filter((f) => f.driveFileId).map((f) => f.songId)), [m.files]);
  const songs = useMemo(() => {
    const t = q.trim().toLowerCase();
    return m.songs.filter((s) => inSeg(s, seg, linked) && (!t || s.title.toLowerCase().includes(t) || (s.writers ?? "").toLowerCase().includes(t))).sort((a, b) => a.title.localeCompare(b.title));
  }, [m.songs, linked, seg, q]);
  const picked = useMemo(() => m.songs.filter((x) => ticked.includes(x.id)), [m.songs, ticked]);
  const toggle = (id: string) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const count = (k: SegKey) => m.songs.filter((s) => inSeg(s, k, linked)).length;

  if (setlistParam) return <div className="s">Opening setlist…</div>;

  // No songs at all: only the welcome card, none of the segments or search.
  if (!m.loading && m.songs.length === 0) {
    return (
      <WelcomeEmpty section="songs" variant={2} title="Welcome to Songs!"
        body="Everything we play, with its key and length. Charts and recordings, and the songs we're learning or just thinking about, all live here too."
        actions={admin ? <Link href="/songs/new" className="btn acc" data-testid="add-song-btn">+ New song</Link> : undefined}>
        <ErrorBox error={error} />
      </WelcomeEmpty>
    );
  }

  return (
    <div className="grid gap-5" data-testid="songs-page">
      <PageTitle title="Songs" center
        actions={admin ? <Link href={seg === "writing" ? "/songs/new?status=writing" : "/songs/new"} className="btn acc" data-testid="add-song-btn">+ New song</Link> : undefined} />
      <Tabs<SegKey> testid="songs-seg" value={seg} onChange={setSeg}
        options={SEGS.map(([k, label]) => [k, <>{label} <span className="chip a ml-1">{count(k)}</span></>])} />
      <input className="input" placeholder="Search songs…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="songs-filter" aria-label="Filter songs" />
      {admin && picked.length >= 2 && (
        <div className="card hi flex flex-wrap items-center gap-3" data-testid="songs-selection">
          <b>{picked.length} songs selected</b>
          <button className="btn acc" onClick={() => setMerging(true)} data-testid="songs-merge">Merge</button>
          <button className="btn ghost" onClick={() => setTicked([])} data-testid="songs-clear">Clear</button>
        </div>
      )}
      {!m.loading && songs.length === 0
        ? <div className="empty" data-testid="songs-list"><span>{q ? "No songs match." : "Nothing here yet."}</span></div>
        : (
          <div className="song-tw" data-testid="songs-list">
            <table className="song-table">
              <thead>
                <tr>
                  {admin && <th scope="col" className="sel"><span className="sr-only">Select</span></th>}
                  <th scope="col">Title</th>
                  <th scope="col" className="key">Key</th>
                  <th scope="col" className="bpm">BPM</th>
                  <th scope="col" className="len">Time</th>
                  {cols.map((f) => <th key={f.id} scope="col" className="cf" data-testid={`songs-col-${f.id}`} title={f.description}>{f.label}</th>)}
                  <th scope="col" className="lyr">Lyrics</th>
                </tr>
              </thead>
              <tbody>
                {songs.map((s) => (
                  <tr key={s.id} data-testid={`song-${s.id}`}>
                    {admin && <td className="sel"><input type="checkbox" checked={ticked.includes(s.id)} onChange={() => toggle(s.id)} aria-label={`Select ${s.title}`} data-testid={`song-pick-${s.id}`} /></td>}
                    <td>
                      <Link href={`/songs/${s.id}`} className="nm">{s.title}</Link>
                      {playable.has(s.id) && <span className="chip m ml-2" title="Has a recording">♪</span>}
                    </td>
                    <td className="key">{s.key || <span className="dash">—</span>}</td>
                    <td className="bpm">{s.bpm ?? <span className="dash">—</span>}</td>
                    <td className="len">{s.lengthSec ? fmtLen(s.lengthSec) : <span className="dash">—</span>}</td>
                    {cols.map((f) => <td key={f.id} className="cf">{s.fields?.find((v) => v.fieldId === f.id)?.value || <span className="dash">—</span>}</td>)}
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
      {admin && merging && <MergeSongs picked={picked} onClose={() => setMerging(false)} onDone={(id) => { setMerging(false); setTicked([]); router.push(`/songs/${id}`); }} />}
    </div>
  );
}

/** "Merge {n} songs into one": pick the song to keep (default: the one with the most hanging off it); the others fold into it. */
function MergeSongs({ picked, onClose, onDone }: { picked: SongRow[]; onClose(): void; onDone(keepId: string): void }) {
  const m = useMusic();
  const tracks = useCollection<ReleaseTrack>("tracks", { group: true });
  const { call, error, busy, setError } = useCommand();
  const refs = (id: string) => songRefs(id, { files: m.files, lists: [...m.setlists, ...m.templates], rehearsals: m.rehearsals, tracks: tracks.rows ?? [] });
  const loaded = !m.loading && !tracks.loading;
  // Until the person picks one, the song with the most references is kept. No default while the references are still
  // being counted: with every count at zero the first song was ticked, then the tick jumped to another once they loaded.
  const [chosen, setChosen] = useState<string | null>(null);
  const keepId = chosen ?? (loaded ? defaultKeep(picked, refs).id : null);
  async function merge() {
    if (!keepId) return;
    const r = await call("songs.merge", { keepId, mergeIds: picked.filter((x) => x.id !== keepId).map((x) => x.id) });
    if (r) onDone(keepId);
  }
  return (
    <Dialog open onClose={onClose} title={`Merge ${picked.length} songs into one`} testid="merge-songs-dialog">
      <fieldset className="grid gap-2" data-testid="merge-keep">
        <legend className="lbl">Keep</legend>
        {picked.map((x) => (
          <label key={x.id} className="opt" data-testid={`merge-keep-${x.id}`}>
            <input type="radio" name="merge-keep" checked={keepId === x.id} onChange={() => setChosen(x.id)} data-testid={`merge-keep-radio-${x.id}`} />
            <span className="grid"><b>{x.title}</b><span className="s">{STATUS_LABEL[x.status as SongStatus]} · {loaded ? refsLabel(refs(x.id)) : "Counting…"}</span></span>
          </label>
        ))}
      </fieldset>
      <p className="s" data-testid="merge-what">
        The kept song keeps its title, key, BPM, length, writers and status; anything it has blank is filled in from the others. Notes and custom fields are combined, and the kept song&apos;s value wins where both have one.
        Files, setlists, rehearsals and releases move to it, and the other {picked.length === 2 ? "song is" : "songs are"} archived. You can undo it from History.
      </p>
      <ErrorBox error={error} />
      <div className="flex flex-wrap gap-2">
        <button className="btn acc" disabled={busy || !loaded} onClick={merge} data-testid="merge-confirm">Merge</button>
        <button className="btn ghost" onClick={() => { setError(null); onClose(); }} data-testid="merge-cancel">Cancel</button>
      </div>
    </Dialog>
  );
}
