"use client";
import { draftPath } from "@/schema/drafts";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { Tabs } from "@/components/booking/common";
import { useProfile } from "@/lib/auth";
import { fmtLen, mimeGroup } from "@/lib/music";
import { fmtDur, showName } from "@/lib/shows";
import { fmtDay, useMusic } from "@/components/music/common";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";

export default function SongsPage() {
  return <Suspense fallback={<div className="s">Loading…</div>}><Songs /></Suspense>;
}

type SegKey = "active" | "learning" | "idea" | "retired" | "setlists" | "rehearsals";

/** New setlist: the name is a draft (device + server) until "Create". */
function NewSetlist() {
  const router = useRouter();
  const { call, error, busy } = useCommand();
  const draft = useDraft(draftPath.newIn("setlists"), { name: "" }, { route: "/songs?seg=setlists", title: (v) => `New setlist${v.name.trim() ? ` · ${v.name.trim()}` : ""}` });
  const mutationId = useRef(newMutationId());
  const name = draft.value.name;
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await draft.settle();
    const r = await call("setlists.create", { name: name.trim() }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (r?.id) { await draft.clear(); router.push(`/songs/setlists/${r.id}`); }
  }
  return (
    <form className="grid gap-1" onSubmit={create}>
      <div className="flex gap-2">
        <input className="input" placeholder="New setlist name…" value={name} disabled={!draft.ready} onChange={(e) => draft.setValue({ name: e.target.value })} data-testid="new-setlist-name" aria-label="New setlist name" />
        <button className="btn acc" disabled={busy || !draft.ready} data-testid="new-setlist">Create</button>
      </div>
      <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
      <ErrorBox error={error} />
    </form>
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
  const [seg, setSeg] = useState<SegKey>(segParam === "setlists" || segParam === "rehearsals" ? segParam : "active"); // a restored draft links to ?seg=setlists
  const [q, setQ] = useState("");
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

  // Nothing recorded at all (songs, setlists, rehearsals): only the welcome card, none of the segments, search or lists.
  if (!m.loading && m.songs.length === 0 && m.setlists.length === 0 && m.rehearsals.length === 0) {
    return (
      <WelcomeEmpty section="songs" variant={2} title="Welcome to Songs!"
        body="Everything we play, with its key and length. Charts and recordings, setlists, rehearsals, and the songs we're learning or just thinking about all live here too."
        actions={admin ? <Link href="/songs/new" className="btn acc" data-testid="add-song-btn">Add a song</Link> : undefined}>
        <ErrorBox error={error} />
      </WelcomeEmpty>
    );
  }

  return (
    <div className="grid gap-5" data-testid="songs-page">
      <PageTitle title="Songs" sub="Everything we play, with key and length. Tap for charts and recordings." />
      {admin && <Link href="/songs/new" className="btn acc justify-self-start" data-testid="add-song-btn">Add a song</Link>}
      <Tabs<SegKey> testid="songs-seg" value={seg} onChange={setSeg} options={[["active", "Playing"], ["learning", "Learning"], ["idea", "Ideas"], ["retired", "Retired"], ["setlists", "Setlists"], ["rehearsals", "Rehearsals"]]} />
      {seg !== "setlists" && seg !== "rehearsals" && (
        <input className="input" placeholder="Search songs…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="songs-filter" aria-label="Filter songs" />
      )}

      {seg === "setlists" ? (
        <div className="grid gap-2" data-testid="setlists-list">
          {admin && <NewSetlist />}
          {!m.loading && m.setlists.length === 0 && <div className="empty"><span>No setlists yet.</span></div>}
          {[...m.setlists].sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
            const show = showOf(s.showId);
            return (
              <Link key={s.id} href={`/songs/setlists/${s.id}`} className="card" data-testid={`setlist-${s.id}`}>
                <div className="flex items-center justify-between"><b>{s.name}</b><span className="s font-semibold">Open ›</span></div>
                <span className="s">{s.items.filter((i) => i.type === "song").length} songs · {fmtDur(s.totalSec)}{show ? ` · ${fmtDay(show.date)} ${showName(show)}` : ""}</span>
              </Link>
            );
          })}
        </div>
      ) : seg === "rehearsals" ? (
        <div className="grid gap-2" data-testid="rehearsals-list">
          {admin && <Link href="/songs/rehearsals/new" className="btn acc justify-self-start" data-testid="log-rehearsal">Log a rehearsal</Link>}
          {!m.loading && m.rehearsals.length === 0 && <div className="empty"><span>No rehearsals logged yet.</span></div>}
          {[...m.rehearsals].sort((a, b) => b.date.localeCompare(a.date)).map((r) => (
            <Link key={r.id} href={`/songs/rehearsals/${r.id}`} className="card" data-testid={`rehearsal-${r.id}`}>
              <div className="flex items-center justify-between"><b>{fmtDay(r.date)}{r.location?.name ?? r.location?.address ? ` · ${r.location?.name ?? r.location?.address}` : ""}</b><span className="s font-semibold">Open ›</span></div>
              <span className="s">{r.songs.length} songs run</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="grid gap-2" data-testid="songs-list">
          {!m.loading && songs.length === 0 && <div className="empty"><span>{q ? "No songs match." : "Nothing here yet."}</span></div>}
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
