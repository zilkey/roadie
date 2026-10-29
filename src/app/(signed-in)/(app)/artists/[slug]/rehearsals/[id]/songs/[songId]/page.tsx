"use client";
import { BackLink } from "@/components/BackLink";
import Link from "@/lib/artist";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useProfile } from "@/lib/auth";
import { Missing, useMusic, type FileRow } from "@/components/music/common";
import { RecordingRow } from "@/components/music/RecordingRow";
import { fmtLong } from "@/lib/shows";
import { SaveStatus } from "@/components/SaveStatus";
import { useAutosave } from "@/lib/autosave";
import { Upload } from "@/components/music/Upload";
import { DetailCard, DetailPage } from "@/components/booking/DetailCards";
import { AutoGrowTextarea } from "@/components/shows/page/kit";
import { KIND_LABEL } from "@/lib/music";
import type { Rehearsal } from "@/schema";

export default function RehearsalSongPage() {
  const { id, songId } = useParams<{ slug: string; id: string; songId: string }>();
  const m = useMusic();
  const r = m.rehearsals.find((x) => x.id === id);
  if (m.loading) return null;
  if (!r) return <Missing what="rehearsal" />;
  if (!r.songs.some((s) => s.songId === songId)) return <Missing what="song at this rehearsal" />;
  return <RehearsalSong r={r} songId={songId} m={m} />;
}

type Row = Rehearsal & { id: string };

/**
 * One song at one rehearsal: its notes (the rehearsal's per-song note, autosaved through rehearsals.update) and the
 * recordings of it from that rehearsal. Upload a recording sends it to /api/rehearsals/{id}/recording, which puts it in
 * Drive (making the recordings folder if none is chosen) and attaches it to both the song and the rehearsal.
 */
function RehearsalSong({ r, songId, m }: { r: Row; songId: string; m: ReturnType<typeof useMusic> }) {
  const admin = useProfile().role === "admin";
  const song = m.songs.find((s) => s.id === songId);
  const title = song?.title ?? r.songs.find((s) => s.songId === songId)?.title ?? "Song";
  const serverNote = r.songs.find((s) => s.songId === songId)?.note ?? "";
  const [note, setNote] = useState(serverNote);
  const as = useAutosave({ command: "rehearsals.update", id: r.id, rev: r.rev, scope: `song-${songId}`, onUseTheirs: () => setNote(serverNote) });
  // Keep in step with the record when it changes under us (Undo, someone else), unless we have unsaved edits or are typing:
  // while the field has focus what's typed is the truth, so a save landing never rewrites it (it would eat a trailing space).
  const focused = useRef(false);
  useEffect(() => { if (!focused.current && !as.isBusy()) setNote(serverNote); }, [serverNote]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeNote(v: string) {
    setNote(v);
    // The command takes the whole list; every other song keeps its note as the record has it.
    as.patch({ songs: r.songs.map((s) => {
      const n = s.songId === songId ? v.trim() : s.note;
      return { songId: s.songId, ...(n ? { note: n } : {}) };
    }) });
  }

  const files = m.files.filter((f) => f.songId === songId && f.rehearsalId === r.id);
  // The song's charts and lyrics, one tap away mid-rehearsal.
  const docs = (["chart", "lyrics"] as const).map((k) => ({ k, list: m.files.filter((f) => f.songId === songId && f.kind === k).sort((a, b) => (a.key ?? "").localeCompare(b.key ?? "") || a.title.localeCompare(b.title)) })).filter((g) => g.list.length > 0);

  return (
    <DetailPage testid="rehearsal-song-page" back={<BackLink mode="back" href={`/rehearsals/${r.id}`} label={`Rehearsal · ${fmtLong(r.date)}`} />}
      title={title}
      meta={<span>Rehearsal · {fmtLong(r.date)}{song && <> · <Link href={`/songs/${song.id}`} className="underline" data-testid="open-song">Song page</Link></>}</span>}
      more={admin ? <SaveStatus {...as.statusProps} /> : undefined}>
      <DetailCard private title="Notes" testid="reh-song-notes-card">
        {admin ? (
          <AutoGrowTextarea aria-label={`Notes on ${title}`} placeholder="What to fix, who's changing what, the tempo…" value={note}
            onChange={changeNote} onFocus={() => { focused.current = true; }}
            onBlur={() => { focused.current = false; setNote((n) => n.trim()); void as.flush(); }} data-testid="reh-song-notes" />
        ) : note ? <p className="m-0 whitespace-pre-wrap">{note}</p> : <span className="d-muted">No notes.</span>}
      </DetailCard>

      <DetailCard private title="Charts & lyrics" testid="reh-song-docs-card">
        {docs.length === 0 ? <span className="d-muted">No chart or lyrics for this song yet.</span> : (
          <div className="grid" data-testid="reh-song-docs">
            {docs.map(({ k, list }) => (
              <div key={k} data-testid={`reh-song-docs-${k}`}>
                <span className="lbl">{KIND_LABEL[k]}</span>
                {list.map((f: FileRow) => <RecordingRow key={f.id} file={f} />)}
              </div>
            ))}
          </div>
        )}
      </DetailCard>

      <DetailCard private title="Recordings" testid="reh-song-recordings-card">
        {admin && (
          <Upload url={`/api/rehearsals/${encodeURIComponent(r.id)}/recording`} fields={{ songId }} label="Upload a recording" accept="audio/*,video/*"
            testid="reh-song-upload" disabled={false} tooBig="Trim it, or put it in Drive yourself and attach it from the rehearsal." needsFolder={null} />
        )}
        <div className="grid" data-testid="reh-song-files">
          {files.map((f: FileRow) => <RecordingRow key={f.id} file={f} />)}
          {files.length === 0 && <span className="d-muted">No recordings of this song from this rehearsal yet.</span>}
        </div>
      </DetailCard>
    </DetailPage>
  );
}
