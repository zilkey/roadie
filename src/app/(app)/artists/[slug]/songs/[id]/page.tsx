"use client";
import { fmtInstant } from "@/lib/timezone";
import { useParams } from "next/navigation";
import { useArtistRouter as useRouter } from "@/lib/artist";
import { useState } from "react";
import { SaveStatus } from "@/components/SaveStatus";
import { useAutosave } from "@/lib/autosave";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { todayStr } from "@/lib/booking";
import { daysAgoLabel, fmtLen, KIND_LABEL, KIND_ORDER, lastRehearsed, parseLen, playerFor } from "@/lib/music";
import { BackTo, FileIcon, Missing, fmtDay, useMusic, type FileRow, type SongRow } from "@/components/music/common";
import { DrivePicker, type Pick } from "@/components/music/DrivePicker";

export default function SongPage() {
  const { id } = useParams<{ id: string }>();
  const m = useMusic();
  const song = m.songs.find((s) => s.id === id);
  if (m.loading) return <div className="s">Loading…</div>;
  if (!song) return <Missing what="song" />;
  return <SongView song={song} m={m} />;
}

function Player({ file }: { file: FileRow }) {
  const pl = playerFor(file);
  if (pl.mode === "audio") return <audio controls preload="none" src={pl.src} className="w-full" data-testid="player-audio" />;
  if (pl.mode === "video") return <video controls preload="none" src={pl.src} className="w-full rounded-lg" data-testid="player-video" />;
  if (pl.mode === "embed") return <iframe src={pl.src} title={file.title} allow="autoplay" className="h-24 w-full rounded-lg border-0" data-testid="player-embed" />;
  return null;
}

function FileLine({ file, m, admin }: { file: FileRow; m: ReturnType<typeof useMusic>; admin: boolean }) {
  const { call, error, busy } = useCommand();
  const [open, setOpen] = useState(false);
  const pl = playerFor(file);
  const inline = pl.mode !== "link";
  const missing = file.sharing === "ok" ? [] : file.sharing.missing;
  const names = missing.map((id) => m.musicians.find((x) => x.id === id)?.name ?? "Someone").sort();
  const label = file.kind === "chart" && file.key ? `Chart in ${file.key}` : file.title;
  const fixIds = { ids: [file.id] };
  return (
    <div className="grid gap-1.5 rounded-lg border border-line p-2" data-testid={`file-${file.id}`}>
      <div className="flex items-center gap-2">
        <FileIcon mime={file.mimeType} />
        <span className="grid min-w-0 flex-1"><b className="truncate text-sm" data-testid="file-label">{label}</b>{label !== file.title && <span className="s truncate">{file.title}</span>}</span>
        {inline && <button className="btn ghost sm" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="file-play">{open ? "Hide" : "Play"}</button>}
        <a className="btn ghost sm" href={file.url} target="_blank" rel="noreferrer" data-testid="file-open">{inline ? "Drive" : "Open in Drive"}</a>
      </div>
      {open && inline && <Player file={file} />}
      {admin && (names.length > 0 || !file.inBandFolder) && (
        <div className="grid gap-1.5" data-testid="file-gap">
          {names.length > 0 && <span className="s" data-testid="cant-open">Can&apos;t open: {names.join(", ")}</span>}
          {!file.inBandFolder && <span className="s">Outside the band folder ({file.ownerEmail}).</span>}
          <div className="flex flex-wrap gap-2">
            {!file.inBandFolder && <button className="btn ghost sm" disabled={busy} onClick={() => call("files.copyToBand", fixIds)} data-testid="fix-copy">Copy to band folder</button>}
            {names.length > 0 && <button className="btn ghost sm" disabled={busy} onClick={() => call("files.shareWithBand", fixIds)} data-testid="fix-share">Share with band</button>}
          </div>
        </div>
      )}
      {admin && names.length === 0 && file.inBandFolder && <span className="s" data-testid="file-ok">Everyone can open this.</span>}
      {admin && <div><button className="btn ghost sm" disabled={busy} onClick={() => confirm(`Remove ${file.title} from this song? The Drive file stays put.`) && call("files.remove", { id: file.id })} data-testid="file-remove">Remove</button></div>}
      <ErrorBox error={error} />
    </div>
  );
}

function SongView({ song, m }: { song: SongRow; m: ReturnType<typeof useMusic> }) {
  const admin = useProfile().role === "admin";
  const router = useRouter();
  const { call, error, busy } = useCommand();
  // Existing record = autosave: each field is a patch through songs.update, "Saved" + Undo toast after.
  const as = useAutosave({ command: "songs.update", id: song.id, rev: song.rev, title: song.title });
  const [len, setLen] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [adding, setAdding] = useState(false);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [checkMsg, setCheckMsg] = useState("");
  const files = m.files.filter((f) => f.songId === song.id);
  const last = lastRehearsed(m.rehearsals)[song.id];
  const today = todayStr();
  const checked = files.map((f) => f.checkedAt as unknown as { toMillis?(): number }).filter((c) => c?.toMillis).map((c) => c.toMillis!());
  const lastCheck = checked.length ? fmtInstant(Math.min(...checked)) : null;

  async function attach() {
    const r = await call<{ ids: string[]; skipped: number }>("files.attach", { songId: song.id, files: picks });
    if (r) { setAdding(false); setPicks([]); }
  }
  async function check() {
    const r = await call<{ checked: number; withGaps: number; outsideBandFolder: number; errors: unknown[] }>("files.check", {});
    if (r) setCheckMsg(`Checked ${r.checked} files: ${r.withGaps} the band can't open, ${r.outsideBandFolder} outside the band folder${r.errors.length ? `, ${r.errors.length} not found in Drive` : ""}.`);
  }

  return (
    <div className="grid gap-3" data-testid="song-page">
      <BackTo href="/songs" label="Songs" />
      <PageTitle title={song.title} sub={[song.key, song.bpm ? `${song.bpm} bpm` : null, song.lengthSec ? fmtLen(song.lengthSec) : null].filter(Boolean).join(" · ") || undefined} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip" data-testid="song-status">{{ active: "Playing", learning: "Learning", idea: "Idea", retired: "Retired" }[song.status]}</span>
        {song.writers && <span className="s">Written by {song.writers}</span>}
        {admin && <button className="btn ghost sm" onClick={() => { void as.flush(); setLen(null); setEdit(!edit); }} data-testid="song-edit">{edit ? "Done" : "Edit"}</button>}
        {admin && edit && <SaveStatus {...as.statusProps} />}
      </div>
      {song.notes && <p className="text-sm">{song.notes}</p>}
      {edit && admin && (
        <div className="card" data-testid="song-form">
          <label className="grid gap-1"><span className="lbl">Title</span><input className="input" required data-testid="edit-title" {...as.bind("title", song.title, { toPatch: (t) => t.trim() })} /></label>
          <div className="grid grid-cols-3 gap-2">
            <label className="grid gap-1"><span className="lbl">Key</span><input className="input" data-testid="edit-key" {...as.bind("key", song.key ?? "", { toPatch: (t) => t.trim() || null })} /></label>
            <label className="grid gap-1"><span className="lbl">BPM</span><input className="input" inputMode="numeric" data-testid="edit-bpm" {...as.bind("bpm", song.bpm != null ? String(song.bpm) : "", { toPatch: (t) => (t.trim() === "" ? null : Number.isFinite(Number(t)) ? Number(t) : t) })} /></label>
            <label className="grid gap-1"><span className="lbl">Length</span>
              <input className="input" placeholder="3:52" data-testid="edit-length" value={len ?? fmtLen(song.lengthSec)}
                onChange={(e) => {
                  const t = e.target.value; setLen(t);
                  const sec = parseLen(t);
                  if (!t.trim()) as.patch({ lengthSec: null });
                  else if (sec === undefined) as.hold("Length looks like 3:52");
                  else as.patch({ lengthSec: sec });
                }}
                onBlur={() => { void as.flush(); if (!len?.trim() || parseLen(len) !== undefined) setLen(null); }} /></label>
          </div>
          <label className="grid gap-1"><span className="lbl">Status</span>
            <select className="select" data-testid="edit-status" {...as.bind("status", song.status, { toPatch: (t) => t })}>
              <option value="active">Playing</option><option value="learning">Learning</option><option value="idea">Idea</option><option value="retired">Retired</option>
            </select></label>
          <label className="grid gap-1"><span className="lbl">Written by</span><input className="input" data-testid="edit-writers" {...as.bind("writers", song.writers ?? "", { toPatch: (t) => t.trim() || null })} /></label>
          <label className="grid gap-1"><span className="lbl">Notes</span><textarea className="input" rows={2} data-testid="edit-notes" {...as.bind("notes", song.notes ?? "", { toPatch: (t) => t.trim() || null })} /></label>
          <div className="flex gap-2">
            <button type="button" className="btn ghost" disabled={busy} data-testid="song-archive" onClick={async () => { if (confirm(`Archive ${song.title}?`) && (await call("songs.remove", { id: song.id }))) router.push("/songs"); }}>Archive song</button>
          </div>
        </div>
      )}

      <div className="card" data-testid="last-rehearsed">
        <span className="lbl">Last rehearsed</span>
        <b>{last ? `${fmtDay(last)} · ${daysAgoLabel(last, today)}` : "Not rehearsed yet"}</b>
      </div>

      {files.length === 0 && <span className="s" data-testid="no-files">No files yet.</span>}
      {KIND_ORDER.map((k) => {
        const list = files.filter((f) => f.kind === k).sort((a, b) => (a.key ?? "").localeCompare(b.key ?? "") || a.title.localeCompare(b.title));
        if (!list.length) return null;
        return (
          <div key={k} className="grid gap-2" data-testid={`files-${k}`}>
            <span className="lbl">{KIND_LABEL[k]}</span>
            {list.map((f) => <FileLine key={f.id} file={f} m={m} admin={admin} />)}
          </div>
        );
      })}

      {admin && (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn ghost" onClick={() => setAdding(!adding)} data-testid="add-from-drive">{adding ? "Cancel" : "+ Add from Drive"}</button>
            <button className="btn ghost" disabled={busy} onClick={check} data-testid="run-sharing-check">Run sharing check</button>
            {lastCheck && <span className="s" data-testid="checked-at">Last checked {lastCheck}</span>}
          </div>
          {checkMsg && <span className="s" data-testid="check-result">{checkMsg}</span>}
          {adding && (
            <div className="card">
              <DrivePicker syncWith={song.title} exclude={files.map((f) => f.driveFileId)} onChange={setPicks} />
              <button className="btn acc" disabled={busy || picks.length === 0} onClick={attach} data-testid="attach-files">Attach {picks.length || ""} file{picks.length === 1 ? "" : "s"}</button>
            </div>
          )}
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
