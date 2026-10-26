"use client";
import Link, { useArtist } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useProfile } from "@/lib/auth";
import { FileIcon, Missing, useMusic, type FileRow } from "@/components/music/common";
import { playerFor } from "@/lib/music";
import { fmtLong } from "@/lib/shows";
import { SaveStatus } from "@/components/SaveStatus";
import { useAutosave } from "@/lib/autosave";
import { Upload } from "@/components/music/Upload";
import { DetailCard, DetailPage } from "@/components/booking/DetailCards";
import type { Rehearsal } from "@/schema";

export default function RehearsalSongPage() {
  const { id, songId } = useParams<{ slug: string; id: string; songId: string }>();
  const m = useMusic();
  const r = m.rehearsals.find((x) => x.id === id);
  if (m.loading) return <div className="s">Loading…</div>;
  if (!r) return <Missing what="rehearsal" />;
  if (!r.songs.some((s) => s.songId === songId)) return <Missing what="song at this rehearsal" />;
  return <RehearsalSong r={r} songId={songId} m={m} />;
}

type Row = Rehearsal & { id: string };

/**
 * One song at one rehearsal: its notes (the rehearsal's per-song note, autosaved through rehearsals.update) and the
 * recordings of it from that rehearsal. Upload a recording sends it to /api/rehearsals/{id}/recording, which puts it in
 * Drive and attaches it to both the song and the rehearsal.
 */
function RehearsalSong({ r, songId, m }: { r: Row; songId: string; m: ReturnType<typeof useMusic> }) {
  const admin = useProfile().role === "admin";
  const hasFolder = !!useArtist().doc?.rehearsalFolderId;
  const song = m.songs.find((s) => s.id === songId);
  const title = song?.title ?? r.songs.find((s) => s.songId === songId)?.title ?? "Song";
  const serverNote = r.songs.find((s) => s.songId === songId)?.note ?? "";
  const [note, setNote] = useState(serverNote);
  const as = useAutosave({ command: "rehearsals.update", id: r.id, rev: r.rev, scope: `song-${songId}`, onUseTheirs: () => setNote(serverNote) });
  // Keep in step with the record when it changes under us (Undo, someone else), unless we have unsaved edits.
  useEffect(() => { if (!as.isBusy()) setNote(serverNote); }, [serverNote]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeNote(v: string) {
    setNote(v);
    // The command takes the whole list; every other song keeps its note as the record has it.
    as.patch({ songs: r.songs.map((s) => {
      const n = s.songId === songId ? v.trim() : s.note;
      return { songId: s.songId, ...(n ? { note: n } : {}) };
    }) });
  }

  const files = m.files.filter((f) => f.songId === songId && f.rehearsalId === r.id);

  return (
    <DetailPage testid="rehearsal-song-page" back={<Link href={`/rehearsals/${r.id}`} className="back-link" data-testid="back">← Rehearsal · {fmtLong(r.date)}</Link>}
      title={title}
      meta={<span>Rehearsal · {fmtLong(r.date)}{song && <> · <Link href={`/songs/${song.id}`} className="underline" data-testid="open-song">Song page</Link></>}</span>}
      more={admin ? <SaveStatus {...as.statusProps} /> : undefined}>
      <DetailCard private title="Notes" testid="reh-song-notes-card">
        {admin ? (
          <textarea className="input" rows={6} aria-label={`Notes on ${title}`} placeholder="What to fix, who's changing what, the tempo…" value={note}
            onChange={(e) => changeNote(e.target.value)} onBlur={() => void as.flush()} data-testid="reh-song-notes" />
        ) : note ? <p className="m-0 whitespace-pre-wrap">{note}</p> : <span className="d-muted">No notes.</span>}
      </DetailCard>

      <DetailCard private title="Recordings" testid="reh-song-recordings-card">
        {admin && (
          <Upload url={`/api/rehearsals/${encodeURIComponent(r.id)}/recording`} fields={{ songId }} label="Upload a recording" accept="audio/*,video/*"
            testid="reh-song-upload" disabled={!hasFolder} tooBig="Trim it, or put it in Drive yourself and attach it from the rehearsal."
            needsFolder={<>Choose the rehearsal recordings folder on <Link href="/admin/google" className="underline">Settings &gt; Google</Link> to upload.</>} />
        )}
        <div className="grid" data-testid="reh-song-files">
          {files.map((f: FileRow) => (
            <div key={f.id} className="d-row !flex-nowrap" data-testid={`file-${f.id}`}>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <FileIcon mime={f.mimeType} />
                <span className="min-w-0 truncate font-semibold">{f.title}</span>
              </span>
              {playerFor(f).mode === "audio" && <audio controls preload="none" src={f.url} className="h-8 max-w-[160px]" />}
              <a className="text-sm font-semibold" href={f.url} target="_blank" rel="noreferrer" data-testid="file-open">Open in Drive</a>
            </div>
          ))}
          {files.length === 0 && <span className="d-muted">No recordings of this song from this rehearsal yet.</span>}
        </div>
      </DetailCard>
    </DetailPage>
  );
}
