"use client";
import { BackLink } from "@/components/BackLink";
import { fmtInstant } from "@/lib/timezone";
import { useParams } from "next/navigation";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { Menu } from "@/components/Menu";
import { useEffect, useRef, useState } from "react";
import { SaveStatus } from "@/components/SaveStatus";
import { celebrateSong } from "@/components/Celebrate";
import { useAutosave } from "@/lib/autosave";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { todayStr } from "@/lib/booking";
import { daysAgoLabel, fmtLen, STATUS_LABEL, KIND_LABEL, KIND_ORDER, lastRehearsed, parseLen, playerFor, playsInline, PROVIDER_LABEL, providerFor, STATUS_ORDER, type SongStatus } from "@/lib/music";
import { FileIcon, Missing, fmtDay, useMusic, type FileRow, type SongRow } from "@/components/music/common";
import { DrivePicker, NoBandFolder, NoChartsFolder, type Pick } from "@/components/music/DrivePicker";
import { Upload } from "@/components/music/Upload";
import { AudioPanel, PlayToggle } from "@/components/music/AudioPlayer";

export default function SongPage() {
  const { id } = useParams<{ id: string }>();
  const m = useMusic();
  const song = m.songs.find((s) => s.id === id);
  if (m.loading) return <div className="s">Loading…</div>;
  if (!song) return <Missing what="song" />;
  return <SongView song={song} m={m} />;
}

function Player({ file }: { file: FileRow }) {
  if (playsInline(file)) return <AudioPanel file={file} />;
  const pl = playerFor(file);
  if (pl.mode === "video") return <video controls preload="none" src={pl.src} className="w-full rounded-lg" data-testid="player-video" />;
  if (pl.mode === "embed") return <iframe src={pl.src} title={file.title} allow="autoplay" className="h-24 w-full rounded-lg border-0" data-testid="player-embed" />;
  return null;
}

function FileLine({ file, m, admin }: { file: FileRow; m: ReturnType<typeof useMusic>; admin: boolean }) {
  const { call, error, busy } = useCommand();
  const [open, setOpen] = useState(false);
  const audio = playsInline(file);
  const inline = audio || playerFor(file).mode !== "link";
  // Sharing and band-folder checks are Drive facts: a Spotify/YouTube/web link has neither, so it never shows (or lies about) them.
  const isDrive = !!file.driveFileId;
  // A Drive file imported from the song-list sheet has never been looked up in Drive, so inBandFolder and sharing are
  // unset. That is "not checked yet", not "outside the folder" -- reading undefined as false would claim a check that
  // never ran, and offer to fix a problem nobody has found.
  const checked = isDrive && file.inBandFolder !== undefined;
  const provider = file.provider ?? providerFor(file.url);
  const where = PROVIDER_LABEL[provider];
  const missing = !file.sharing || file.sharing === "ok" ? [] : file.sharing.missing;
  const names = missing.map((id) => m.musicians.find((x) => x.id === id)?.name ?? "Someone").sort();
  const label = file.kind === "chart" && file.key ? `Chart in ${file.key}` : file.title;
  const fixIds = { ids: [file.id] };
  // No band folder chosen: being outside it means nothing yet, and Copy to band folder can't run.
  const artistDoc = useArtist().doc;
  const hasFolder = !!artistDoc?.driveFolderId;
  // Copy to band folder copies into the Charts folder; until it's chosen the row says so instead of offering the button.
  const hasCharts = !!artistDoc?.chartsFolderId;
  const outside = checked && hasFolder && !file.inBandFolder;
  return (
    <div className="sg-row" data-testid={`file-${file.id}`}>
      <div className="sg-rowh">
        <FileIcon mime={file.mimeType} provider={isDrive ? undefined : provider} />
        <span className="sg-rowt">
          <b className="truncate" data-testid="file-label">{label}</b>
          {label !== file.title && <span className="s truncate">{file.title}</span>}
          {/* The sharing state reads under the name: unchecked is a warning, a real gap lists who is locked out. */}
          {admin && isDrive && !checked && <span className="sg-warn" data-testid="file-unchecked">Not checked yet — run the sharing check.</span>}
          {admin && checked && names.length > 0 && <span className="sg-warn" data-testid="cant-open">Can&apos;t open: {names.join(", ")}</span>}
          {admin && outside && <span className="sg-warn">Outside the band folder ({file.ownerEmail}).</span>}
          {admin && checked && names.length === 0 && !outside && <span className="s" data-testid="file-ok">Everyone can open this.</span>}
        </span>
        <span className="sg-rowa">
          {audio ? <PlayToggle file={file} open={open} onOpen={setOpen} />
            : inline && <button className="btn ghost sm" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="file-play">{open ? "Hide" : "Play"}</button>}
          <a className="btn ghost sm" href={file.url} target="_blank" rel="noreferrer" data-testid="file-open">{inline && !audio ? where : provider === "web" ? "Open link" : `Open in ${where}`}</a>
          {admin && <button className="btn danger sm" disabled={busy} onClick={() => confirm(`Remove ${file.title} from this song? ${isDrive ? "The Drive file stays put." : "The link itself is untouched."}`) && call("files.remove", { id: file.id })} data-testid="file-remove">Remove</button>}
        </span>
      </div>
      {open && inline && <Player file={file} />}
      {admin && checked && (names.length > 0 || outside || !hasFolder) && (
        <div className="flex flex-wrap items-center gap-2" data-testid="file-gap">
          {(outside || !hasFolder) && (hasCharts
            ? <button className="btn ghost sm" disabled={busy} onClick={() => call("files.copyToBand", fixIds)} data-testid="fix-copy">Copy to band folder</button>
            : <NoChartsFolder />)}
          {names.length > 0 && <button className="btn ghost sm" disabled={busy} onClick={() => call("files.shareWithBand", fixIds)} data-testid="fix-share">Share with band</button>}
        </div>
      )}
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
  // The picked status shows at once; once the saved song catches up, it shows the song's again.
  const [status, setStatus] = useState<SongStatus | null>(null);
  useEffect(() => setStatus(null), [song.status]);
  // Celebrate when the saved status leaves Writing (into anything but Retired), whoever changed it while this page is open.
  const was = useRef({ id: song.id, status: song.status });
  useEffect(() => {
    const prev = was.current;
    was.current = { id: song.id, status: song.status };
    if (prev.id === song.id && prev.status === "writing" && song.status !== "writing" && song.status !== "retired") celebrateSong(song.title, STATUS_LABEL[song.status]);
  }, [song.id, song.status, song.title]);
  // The artist's custom fields, in the artist's order. Typed values live here until saved (the patch is the whole list).
  const artistDoc = useArtist().doc;
  const defs = artistDoc?.songFields ?? [];
  const [vals, setVals] = useState<Record<string, string> | null>(null);
  const saved = Object.fromEntries((song.fields ?? []).map((v) => [v.fieldId, v.value]));
  const valueOf = (fid: string) => (vals ?? saved)[fid] ?? "";
  const setField = (fid: string, v: string) => {
    const next = { ...(vals ?? saved), [fid]: v };
    setVals(next);
    // A blank value is no value: no entry rather than an empty string.
    as.patch({ fields: defs.filter((d) => next[d.id]?.trim()).map((d) => ({ fieldId: d.id, value: next[d.id]!.trim() })) });
  };
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
    const r = await call<{ checked: number; withGaps: number; outsideBandFolder: number | null; errors: unknown[] }>("files.check", {});
    if (r) setCheckMsg(`Checked ${r.checked} files: ${r.withGaps} the band can't open${r.outsideBandFolder === null ? "" : `, ${r.outsideBandFolder} outside the band folder`}${r.errors.length ? `, ${r.errors.length} not found in Drive` : ""}.`);
  }

  return (
    <div className="sg-page" data-testid="song-page">
      <PageTitle
        back={<BackLink href={song.status === "writing" ? "/songs?seg=writing" : "/songs"} label="All songs" />}
        title={song.title}
        pill={admin ? undefined : <span className={`pill${song.status === "active" ? " ok" : ""}`} data-testid="song-status">{STATUS_LABEL[song.status]}</span>}
        sub={[song.key, song.bpm ? `${song.bpm} bpm` : null, song.lengthSec ? fmtLen(song.lengthSec) : null].filter(Boolean).join(" · ") || undefined}
        actions={admin ? <>
          {edit && <SaveStatus {...as.statusProps} />}
          {/* Admins change the status here, outside Edit: it saves at once, with the usual Saved + Undo toast. */}
          <select className="select" aria-label="Status" value={status ?? song.status} data-testid="song-status-select"
            onChange={(e) => { setStatus(e.target.value as SongStatus); as.patch({ status: e.target.value }, { now: true }); }}>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <button className="btn ghost" onClick={() => { void as.flush(); setLen(null); setVals(null); setEdit(!edit); }} data-testid="song-edit">{edit ? "Done" : "Edit"}</button>
          <Menu label="More actions" testid="song" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>}
            items={[{ key: "archive", label: "Archive song", danger: true, disabled: busy, onSelect: async () => { if (confirm(`Archive ${song.title}?`) && (await call("songs.remove", { id: song.id }))) router.push("/songs"); } }]} />
        </> : undefined} />
      {edit && admin && (
        <div className="card" data-testid="song-form">
          <label className="grid gap-1"><span className="lbl">Title</span><input className="input" required data-testid="edit-title" {...as.bind("title", song.title, { toPatch: (t) => t.trim() })} /></label>
          <label className="grid gap-1"><span className="lbl">Short title</span><input className="input" data-testid="edit-short-title" {...as.bind("shortTitle", song.shortTitle ?? "", { toPatch: (t) => t.trim() || null })} /></label>
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
          <label className="grid gap-1"><span className="lbl">Written by</span><input className="input" data-testid="edit-writers" {...as.bind("writers", song.writers ?? "", { toPatch: (t) => t.trim() || null })} /></label>
          <label className="grid gap-1"><span className="lbl">Notes</span><textarea className="input" rows={2} data-testid="edit-notes" {...as.bind("notes", song.notes ?? "", { toPatch: (t) => t.trim() || null })} /></label>
          {defs.map((d) => (
            <label key={d.id} className="grid gap-1"><span className="lbl">{d.label}</span>
              <input className="input" data-testid={`edit-field-${d.id}`} value={valueOf(d.id)} onChange={(e) => setField(d.id, e.target.value)} onBlur={() => void as.flush()} /></label>
          ))}
        </div>
      )}

      {!edit && (
        <section className="sg-sec" aria-labelledby="song-details-h">
          <h2 id="song-details-h" className="sg-lbl">Details</h2>
          <dl className="card sg-dl" data-testid="song-fields">
            <div><dt className="lbl">Written by</dt><dd data-testid="field-writers">{song.writers || <span className="d-muted">—</span>}</dd></div>
            <div data-testid="last-rehearsed">
              <dt className="lbl">Last rehearsed</dt>
              <dd>{last ? `${fmtDay(last)} · ${daysAgoLabel(last, today)}` : "Not rehearsed yet"}</dd>
            </div>
            {/* The artist's own per-song facts ("Ingrid plays", "Capo"), in the artist's order; an unfilled one still holds its place. */}
            {defs.map((d) => (
              <div key={d.id}>
                <dt className="lbl">{d.label}</dt>
                <dd data-testid={`field-${d.id}`}>{saved[d.id]?.trim() || <span className="d-muted">—</span>}</dd>
              </div>
            ))}
            {song.notes && <div className="sg-wide"><dt className="lbl">Notes</dt><dd><p className="sg-note">{song.notes}</p></dd></div>}
          </dl>
        </section>
      )}

      <section className="sg-sec" aria-labelledby="song-files-h">
        <div className="sg-sech">
          <h2 id="song-files-h" className="sg-lbl">Charts &amp; recordings</h2>
          {admin && (
            <div className="flex flex-wrap items-start gap-2">
              {/* A Writing song's audio goes to the Songwriting folder; the route picks the folder from the song's status. */}
              {song.status === "writing"
                ? <Upload key="writing" url={`/api/songs/${encodeURIComponent(song.id)}/demo`} label="Upload audio" accept="audio/*" testid="song-upload-demo"
                  disabled={!artistDoc?.songwritingFolderId} tooBig="Trim it, or put it in Drive yourself and add it from Drive."
                  needsFolder={<>Choose the Songwriting folder on <Link href="/admin/google" className="underline">Settings &gt; Google</Link> to upload.</>} />
                : <Upload key="demo" url={`/api/songs/${encodeURIComponent(song.id)}/demo`} label="Upload a demo" accept="audio/*" testid="song-upload-demo"
                  disabled={!artistDoc?.demosFolderId} tooBig="Trim it, or put it in Drive yourself and add it from Drive."
                  needsFolder={<>Choose the Demos folder on <Link href="/admin/google" className="underline">Settings &gt; Google</Link> to upload.</>} />}
              <button className="btn acc" onClick={() => setAdding(!adding)} data-testid="add-from-drive">{adding ? "Cancel" : "+ Add from Drive"}</button>
            </div>
          )}
        </div>

        {admin && (
          <>
            <div className="sg-strip">
              <span className="sg-strip-t">
                <b>Sharing check</b>
                <span className="s" data-testid="checked-at">{lastCheck ? `Last checked ${lastCheck}` : "Never checked"}</span>
              </span>
              <button className="btn outline" disabled={busy} onClick={check} data-testid="run-sharing-check">Run sharing check</button>
            </div>
            {checkMsg && <span className="s" data-testid="check-result">{checkMsg}</span>}
            {!artistDoc?.driveFolderId && files.some((f) => f.driveFileId) && <NoBandFolder />}
            {adding && (
              <div className="card">
                <DrivePicker syncWith={song.title} exclude={files.flatMap((f) => f.driveFileId ?? [])} onChange={setPicks} />
                <button className="btn acc" disabled={busy || picks.length === 0} onClick={attach} data-testid="attach-files">Attach {picks.length || ""} file{picks.length === 1 ? "" : "s"}</button>
              </div>
            )}
          </>
        )}

        {files.length === 0 && <div className="empty" data-testid="no-files"><span>No files yet.</span></div>}
        {KIND_ORDER.map((k) => {
          const list = files.filter((f) => f.kind === k).sort((a, b) => (a.key ?? "").localeCompare(b.key ?? "") || a.title.localeCompare(b.title));
          if (!list.length) return null;
          return (
            <div key={k} className="sg-files" data-testid={`files-${k}`}>
              <h3>{KIND_LABEL[k]}</h3>
              {list.map((f) => <FileLine key={f.id} file={f} m={m} admin={admin} />)}
            </div>
          );
        })}
      </section>
      <ErrorBox error={error} />
    </div>
  );
}
