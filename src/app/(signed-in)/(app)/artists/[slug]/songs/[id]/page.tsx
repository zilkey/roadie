"use client";
import { BackLink } from "@/components/BackLink";
import { fmtInstant } from "@/lib/timezone";
import { useParams } from "next/navigation";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { Menu } from "@/components/Menu";
import { useEffect, useRef, useState } from "react";
import { SaveStatus } from "@/components/SaveStatus";
import { InlineValue } from "@/components/InlineValue";
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
import { useCollection } from "@/lib/firestore-hooks";
import { trackHref } from "@/components/releases/common";
import type { Release, ReleaseTrack } from "@/schema";

export default function SongPage() {
  const { id } = useParams<{ id: string }>();
  const m = useMusic();
  const song = m.songs.find((s) => s.id === id);
  if (m.loading) return null;
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
        <FileIcon mime={file.mimeType} kind={file.kind} provider={isDrive ? undefined : provider} />
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
  // The artist's custom fields, in the artist's order. Each value edits in place; the patch is the whole list.
  const artistDoc = useArtist().doc;
  const defs = artistDoc?.songFields ?? [];
  const saved = Object.fromEntries((song.fields ?? []).map((v) => [v.fieldId, v.value]));
  // A saved value shows at once; once the saved song catches up (a new rev), the song's own shows again.
  const [mine, setMine] = useState<Record<string, string>>({});
  useEffect(() => setMine({}), [song.rev]);
  const text = (k: string, v: string | number | null | undefined) => mine[k] ?? (v == null ? "" : String(v));
  const save = (k: string, shown: string, patch: Record<string, unknown>) => {
    setMine((x) => ({ ...x, [k]: shown }));
    as.patch(patch, { now: true });
    return true;
  };
  const saveField = (fid: string, v: string) => {
    const next = { ...saved, ...Object.fromEntries(Object.entries(mine).filter(([k]) => k.startsWith("f:")).map(([k, x]) => [k.slice(2), x])), [fid]: v };
    // A blank value is no value: no entry rather than an empty string.
    return save(`f:${fid}`, v, { fields: defs.filter((d) => next[d.id]?.trim()).map((d) => ({ fieldId: d.id, value: next[d.id]!.trim() })) });
  };
  const fieldVal = (fid: string) => mine[`f:${fid}`] ?? saved[fid] ?? "";
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
        back={<BackLink mode="back" href={song.status === "writing" ? "/songs?seg=writing" : "/songs"} label="All songs" />}
        title={song.title}
        sub={[song.key, song.bpm ? `${song.bpm} bpm` : null, song.lengthSec ? fmtLen(song.lengthSec) : null].filter(Boolean).join(" · ") || undefined}
        actions={admin ? <>
          {/* Conflicts and failed saves still surface here; the plain Saved tick sits beside each value. */}
          <SaveStatus {...as.statusProps} />
          <Menu label="More actions" testid="song" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>}
            items={[{ key: "archive", label: "Archive song", danger: true, disabled: busy, onSelect: async () => { if (confirm(`Archive ${song.title}?`) && (await call("songs.remove", { id: song.id }))) router.push("/songs"); } }]} />
        </> : undefined} />
      <section className="sg-sec" aria-labelledby="song-details-h">
        <h2 id="song-details-h" className="sg-lbl">Details</h2>
        {/* No page-wide Edit: each value is its own control for admins (saved on blur or Enter, Escape reverts); members see plain text. */}
        <dl className="card sg-dl" data-testid="song-fields">
          {/* Status lives with the other facts. Admins pick it here and it saves at once, with the usual Saved + Undo toast. */}
          <div><dt className="lbl">Status</dt><dd>{admin
            ? <select className="select" aria-label="Status" value={status ?? song.status} data-testid="song-status-select"
                onChange={(e) => { setStatus(e.target.value as SongStatus); as.patch({ status: e.target.value }, { now: true }); }}>
                {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            : <span className={`pill${song.status === "active" ? " ok" : ""}`} data-testid="song-status">{STATUS_LABEL[song.status]}</span>}</dd></div>
          {admin && <div><dt className="lbl">Title</dt><dd><InlineValue testid="field-title" label="Title" kind="text" value={text("title", song.title)} canEdit
            validate={(v) => (v ? null : "A song needs a title")} onSave={(v) => save("title", v, { title: v })} error={as.error} /></dd></div>}
          {admin && <div><dt className="lbl">Short title</dt><dd><InlineValue testid="field-short-title" label="Short title" kind="text" value={text("shortTitle", song.shortTitle)} canEdit
            onSave={(v) => save("shortTitle", v, { shortTitle: v || null })} error={as.error} /></dd></div>}
          <div><dt className="lbl">Key</dt><dd><InlineValue testid="field-key" label="Key" kind="text" value={text("key", song.key)} canEdit={admin}
            onSave={(v) => save("key", v, { key: v || null })} error={as.error} /></dd></div>
          <div><dt className="lbl">BPM</dt><dd><InlineValue testid="field-bpm" label="BPM" kind="text" inputMode="numeric" value={text("bpm", song.bpm)} canEdit={admin}
            validate={(v) => (v === "" || Number.isFinite(Number(v)) ? null : "BPM is a number")}
            onSave={(v) => save("bpm", v, { bpm: v === "" ? null : Number(v) })} error={as.error} /></dd></div>
          <div><dt className="lbl">Length</dt><dd><InlineValue testid="field-length" label="Length" kind="text" placeholder="3:52" value={mine.length ?? fmtLen(song.lengthSec)} canEdit={admin}
            validate={(v) => (v === "" || parseLen(v) !== undefined ? null : "Length looks like 3:52")}
            onSave={(v) => save("length", v, { lengthSec: v === "" ? null : parseLen(v) })} error={as.error} /></dd></div>
          <div><dt className="lbl">Written by</dt><dd><InlineValue testid="field-writers" label="Written by" kind="text" value={text("writers", song.writers)} canEdit={admin}
            onSave={(v) => save("writers", v, { writers: v || null })} error={as.error} /></dd></div>
          <div data-testid="last-rehearsed">
            <dt className="lbl">Last rehearsed</dt>
            <dd>{last ? `${fmtDay(last)} · ${daysAgoLabel(last, today)}` : "Not rehearsed yet"}</dd>
          </div>
          {/* The artist's own per-song facts ("Ingrid plays", "Capo"), in the artist's order; an unfilled one still holds its place. */}
          {defs.map((d) => (
            <div key={d.id}>
              <dt className="lbl">{d.label}</dt>
              <dd><InlineValue testid={`field-${d.id}`} label={d.label} kind="text" value={fieldVal(d.id)} canEdit={admin}
                onSave={(v) => saveField(d.id, v)} error={as.error} /></dd>
            </div>
          ))}
          {(admin || song.notes) && <div className="sg-wide"><dt className="lbl">Notes</dt><dd><InlineValue testid="field-notes" label="Notes" kind="textarea" value={text("notes", song.notes)} canEdit={admin}
            className="sg-note" onSave={(v) => save("notes", v, { notes: v || null })} error={as.error} /></dd></div>}
        </dl>
      </section>

      {admin && <OnReleases songId={song.id} />}

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

/** The releases this song is on: one link per track, to the track page. Admins only, like Releases itself. */
function OnReleases({ songId }: { songId: string }) {
  const tracks = useCollection<ReleaseTrack>("tracks", { group: true, where: [["songId", "==", songId]] });
  const releases = useCollection<Release>("releases");
  const rows = (tracks.rows ?? []).flatMap((t) => {
    const a = releases.rows?.find((x) => x.id === t.releaseId);
    return a ? [{ t, a }] : [];
  }).sort((x, y) => (y.a.releaseDate ?? "").localeCompare(x.a.releaseDate ?? "") || x.a.title.localeCompare(y.a.title));
  return (
    <section className="sg-sec" aria-labelledby="song-releases-h" data-testid="on-releases">
      <h2 id="song-releases-h" className="sg-lbl">On releases</h2>
      <div className="card">
        {rows.length === 0
          ? <span className="s">Not on a release yet.</span>
          : rows.map(({ t, a }) => (
            <Link key={t.id} href={trackHref(a.id, t.id)} className="font-semibold" data-testid={`on-release-${a.id}`}>{a.title} · Track {t.position}</Link>
          ))}
      </div>
    </section>
  );
}
