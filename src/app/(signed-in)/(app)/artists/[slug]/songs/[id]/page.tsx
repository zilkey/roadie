"use client";
import { Metronome } from "@/components/music/Metronome";
import { BackLink } from "@/components/BackLink";
import { fmtInstant } from "@/lib/timezone";
import { useParams } from "next/navigation";
import Link, { useArtist, useArtistRouter as useRouter, useZone } from "@/lib/artist";
import { Menu } from "@/components/Menu";
import { useEffect, useRef, useState } from "react";
import { SaveStatus } from "@/components/SaveStatus";
import { InlineValue } from "@/components/InlineValue";
import { celebrateSong } from "@/components/Celebrate";
import { useAutosave } from "@/lib/autosave";
import { Dialog, ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { todayStr } from "@/lib/booking";
import { daysAgoLabel, driveIdFromUrl, fmtLen, linkName, refsLabel, songRefs, STATUS_LABEL, KIND_LABEL, KIND_ORDER, LINK_KINDS, lastRehearsed, parseLen, playerFor, playsInline, PROVIDER_LABEL, providerFor, STATUS_ORDER, type FileKind, type SongStatus } from "@/lib/music";
import { FileIcon, Missing, fmtDay, useMusic, type FileRow, type SongRow } from "@/components/music/common";
import { DrivePicker, NoBandFolder, NoChartsFolder, type Pick } from "@/components/music/DrivePicker";
import { UploadMenu, type UploadChoice } from "@/components/music/Upload";
import { DocText, googleDocsOf } from "@/components/music/DocText";
import { AudioPanel, PlayToggle } from "@/components/music/AudioPlayer";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import { trackHref } from "@/components/releases/common";
import { ChecklistSidebar } from "@/components/shows/checklists/ChecklistSidebar";
import type { Artist, Release, ReleaseTrack, Song } from "@/schema";

export default function SongPage() {
  const { id } = useParams<{ id: string }>();
  const m = useMusic();
  const router = useRouter();
  const song = m.songs.find((s) => s.id === id);
  // A song that was merged into another one is archived with a pointer: its old address goes to the song that was kept.
  const old = useDoc<Song>("songs", id, { includeDeleted: true }).doc;
  const mergedInto = old?.deletedAt ? old.mergedInto : undefined;
  useEffect(() => { if (mergedInto) router.replace(`/songs/${mergedInto}`); }, [mergedInto, router]);
  if (mergedInto) return <div className="card" data-testid="merged-redirect">This song was merged into another one. Taking you there…</div>;
  if (m.loading) return null;
  if (!song) return <Missing what="song" />;
  return <SongView song={song} m={m} />;
}

function Player({ file }: { file: FileRow }) {
  if (playsInline(file)) return <AudioPanel file={file} />;
  const pl = playerFor(file);
  if (pl.mode === "video") return <video controls preload="none" src={pl.src} className="w-full rounded-lg" data-testid="player-video" />;
  if (pl.mode === "embed") return <iframe src={pl.src} title={file.title} allow="autoplay; encrypted-media; clipboard-write; picture-in-picture; fullscreen" allowFullScreen loading="lazy"
    className={`w-full rounded-lg border-0 ${pl.wide ? "aspect-video" : "h-[152px]"}`} data-testid="player-embed" />;
  return null;
}

function FileLine({ file, m, admin }: { file: FileRow; m: ReturnType<typeof useMusic>; admin: boolean }) {
  const { call, error, busy } = useCommand();
  const [open, setOpen] = useState(false);
  const [describing, setDescribing] = useState(false);
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
  // The kind is guessed when a file is added; an admin corrects it from the row's menu. A link is a reference, demo or
  // recording; a Drive file any song kind (a Google Doc reads inline at the bottom only as Lyrics or Charts).
  const choices = isDrive ? KIND_ORDER : LINK_KINDS;
  const kinds = choices.includes(file.kind) ? choices : [...choices, file.kind];
  const describe = !isDrive && (describing || !!file.description);
  return (
    <div className="sg-row" data-testid={`file-${file.id}`}>
      <div className="sg-rowh">
        <FileIcon mime={file.mimeType} kind={file.kind} provider={isDrive ? undefined : provider} />
        <span className="sg-rowt">
          {/* The name opens the file (Drive, Spotify, YouTube or the page) in a new tab. */}
          <a href={file.url} target="_blank" rel="noreferrer" className="sg-name truncate" title={provider === "web" ? "Open link" : `Open in ${where}`} data-testid="file-open">
            <span data-testid="file-label">{label}</span>
          </a>
          {label !== file.title && <span className="s truncate">{file.title}</span>}
          {/* Only a problem reads under the name: unchecked is a warning, a real gap lists who is locked out. */}
          {admin && isDrive && !checked && <span className="sg-warn" data-testid="file-unchecked">Not checked yet — run the sharing check (More).</span>}
          {admin && checked && names.length > 0 && <span className="sg-warn" data-testid="cant-open">Can&apos;t open: {names.join(", ")}</span>}
          {admin && outside && <span className="sg-warn">Outside the band folder ({file.ownerEmail}).</span>}
          {/* A link's description (a reference track and what to listen for): click to edit, blank clears it. */}
          {describe && (
            <InlineValue testid="link-description" label={`Description of ${file.title}`} kind="textarea" value={file.description ?? ""} canEdit={admin} autoStart={describing && !file.description}
              emptyLabel="Add a description…" placeholder="What is it? (a reference track, what to listen for…)" className="sf-note s"
              onSave={async (v) => { const ok = v.trim() === (file.description ?? "") || !!(await call("files.update", { id: file.id, patch: { description: v.trim() || null } })); if (ok) setDescribing(false); return ok; }} error={error} />
          )}
        </span>
        <span className="sg-rowa">
          {audio ? <PlayToggle file={file} open={open} onOpen={setOpen} />
            : inline && <button className="btn ghost sm" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="file-play">{open ? "Hide" : "Play"}</button>}
          {admin && (
            <Menu label={`More for ${file.title}`} testid="file" items={[
              ...kinds.map((k) => ({ key: `kind-${k}`, label: KIND_LABEL[k], checked: file.kind === k, onSelect: () => { if (k !== file.kind) call("files.update", { id: file.id, patch: { kind: k } }); } })),
              ...(!isDrive ? [{ key: "describe", label: file.description ? "Edit description" : "Add description", divider: true, onSelect: () => setDescribing(true) }] : []),
              { key: "remove", label: "Remove…", danger: true, divider: true, disabled: busy, testid: "file-remove",
                onSelect: () => { if (confirm(`Remove ${file.title} from this song? ${isDrive ? "The Drive file stays put." : "The link itself is untouched."}`)) call("files.remove", { id: file.id }); } },
            ]} />
          )}
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
  const shown = status ?? song.status;
  const setStatusTo = (s: SongStatus) => { if (s === shown) return; setStatus(s); as.patch({ status: s }, { now: true }); };
  const [archiving, setArchiving] = useState(false);
  // Celebrate when the saved status leaves Writing (into anything but Retired), whoever changed it while this page is open.
  const was = useRef({ id: song.id, status: song.status });
  useEffect(() => {
    const prev = was.current;
    was.current = { id: song.id, status: song.status };
    if (prev.id === song.id && prev.status === "writing" && song.status !== "writing" && song.status !== "retired") celebrateSong(song.title, STATUS_LABEL[song.status]);
  }, [song.id, song.status, song.title]);
  // The artist's custom fields, in the artist's order. Each value edits in place; the patch is the whole list.
  const { doc: artistDoc, artistId } = useArtist();
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
  const [linking, setLinking] = useState(false);
  // Drive files and Spotify/YouTube/web links list together, grouped by kind (Charts, Demos, References...).
  const all = m.files.filter((f) => f.songId === song.id);
  const files = all.filter((f) => f.driveFileId);
  const last = lastRehearsed(m.rehearsals)[song.id];
  const zone = useZone();
  const today = todayStr(zone);
  const checked = files.map((f) => f.checkedAt as unknown as { toMillis?(): number }).filter((c) => c?.toMillis).map((c) => c.toMillis!());
  const lastCheck = checked.length ? fmtInstant(Math.min(...checked), zone) : null;

  async function attach() {
    const r = await call<{ ids: string[]; skipped: number }>("files.attach", { songId: song.id, files: picks });
    if (r) { setAdding(false); setPicks([]); }
  }
  async function check() {
    const r = await call<{ checked: number; withGaps: number; outsideBandFolder: number | null; errors: unknown[] }>("files.check", {});
    if (r) setCheckMsg(`Checked ${r.checked} files: ${r.withGaps} the band can't open${r.outsideBandFolder === null ? "" : `, ${r.outsideBandFolder} outside the band folder`}${r.errors.length ? `, ${r.errors.length} not found in Drive` : ""}.`);
  }

  const meta = [song.key, song.bpm ? `${song.bpm} bpm` : null, song.lengthSec ? fmtLen(song.lengthSec) : null].filter(Boolean).join(" · ");
  return (
    <div className="sg-page !max-w-none" data-testid="song-page">
      <PageTitle
        back={<BackLink mode="back" href={song.status === "writing" ? "/songs?seg=writing" : "/songs"} label="All songs" />}
        title={song.title}
        pill={<>
          {/* The status reads beside the title for everyone; admins change it from More. */}
          <span className={`pill${shown === "active" ? " ok" : ""}`} data-testid="song-status">{STATUS_LABEL[shown]}</span>
          <Metronome id={song.id} bpm={song.bpm} title={song.title} />
        </>}
        // Key · bpm · length, then the releases it's on (admins, like Releases itself): one small link per track.
        sub={meta || admin ? <>{meta}{admin && <ReleaseLinks songId={song.id} lead={!!meta} />}</> : undefined}
        actions={admin ? <>
          {/* Conflicts and failed saves still surface here; the plain Saved tick sits beside each value. */}
          <SaveStatus {...as.statusProps} />
          <Menu label="More actions" testid="song" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>}
            items={[
              // The status is a choice in the menu: picking one saves at once, with the usual Saved + Undo toast.
              ...STATUS_ORDER.map((s) => ({ key: `status-${s}`, label: STATUS_LABEL[s], checked: shown === s, onSelect: () => setStatusTo(s) })),
              // The band-wide Drive sharing check (every song's files), with when it last ran.
              { key: "sharing-check", label: "Run sharing check", sub: lastCheck ? `Last checked ${lastCheck}` : "Never checked", divider: true, disabled: busy, testid: "run-sharing-check", onSelect: check },
              { key: "archive", label: "Archive song…", danger: true, divider: true, disabled: busy, onSelect: () => setArchiving(true) },
            ]} />
          {archiving && <ArchiveSongDialog song={song} m={m} onClose={() => setArchiving(false)} onRetire={() => { setArchiving(false); setStatusTo("retired"); }} />}
        </> : undefined} />
      <div className="show-cols">
      <div className="show-main">
      <section className="sg-sec" aria-labelledby="song-details-h">
        <h2 id="song-details-h" className="sg-lbl">Details</h2>
        {/* No page-wide Edit: each value is its own control for admins (saved on blur or Enter, Escape reverts); members see plain text. */}
        {/* One compact box of label | value rows in two columns (the song, then its history), then the artist's own fields, then the free text. */}
        <div className="sf-grid sf-tight" data-testid="song-fields">
          <dl className="card sf-box sf-wide sf-cols">
            {admin && <div className="sf-row"><dt className="lbl">Title</dt><dd><InlineValue testid="field-title" label="Title" kind="text" value={text("title", song.title)} canEdit
              validate={(v) => (v ? null : "A song needs a title")} onSave={(v) => save("title", v, { title: v })} error={as.error} /></dd></div>}
            {admin && <div className="sf-row"><dt className="lbl">Short title</dt><dd><InlineValue testid="field-short-title" label="Short title" kind="text" value={text("shortTitle", song.shortTitle)} canEdit
              onSave={(v) => save("shortTitle", v, { shortTitle: v || null })} error={as.error} /></dd></div>}
            <div className="sf-row"><dt className="lbl">BPM</dt><dd><InlineValue testid="field-bpm" label="BPM" kind="text" inputMode="numeric" value={text("bpm", song.bpm)} canEdit={admin}
              validate={(v) => (v === "" || Number.isFinite(Number(v)) ? null : "BPM is a number")}
              onSave={(v) => save("bpm", v, { bpm: v === "" ? null : Number(v) })} error={as.error} /></dd></div>
            <div className="sf-row"><dt className="lbl">Key</dt><dd><InlineValue testid="field-key" label="Key" kind="text" value={text("key", song.key)} canEdit={admin}
              onSave={(v) => save("key", v, { key: v || null })} error={as.error} /></dd></div>
            <div className="sf-row"><dt className="lbl">Length</dt><dd><InlineValue testid="field-length" label="Length" kind="text" placeholder="3:52" value={mine.length ?? fmtLen(song.lengthSec)} canEdit={admin}
              validate={(v) => (v === "" || parseLen(v) !== undefined ? null : "Length looks like 3:52")}
              onSave={(v) => save("length", v, { lengthSec: v === "" ? null : parseLen(v) })} error={as.error} /></dd></div>
            <div className="sf-row"><dt className="lbl">Written by</dt><dd><InlineValue testid="field-writers" label="Written by" kind="text" value={text("writers", song.writers)} canEdit={admin}
              onSave={(v) => save("writers", v, { writers: v || null })} error={as.error} /></dd></div>
            <div className="sf-row" data-testid="last-rehearsed">
              <dt className="lbl">Last rehearsed</dt>
              <dd>{last ? `${fmtDay(last)} · ${daysAgoLabel(last, today)}` : "Not rehearsed yet"}</dd>
            </div>
          </dl>
          {/* The artist's own per-song facts ("Nora plays", "Capo"), in the artist's order, flowing into two columns; an unfilled one still holds its place. */}
          {defs.length > 0 && <dl className="card sf-box sf-wide sf-cols" data-testid="song-custom-fields">
            {defs.map((d) => (
              <div key={d.id} className="sf-row">
                <dt className="lbl">{d.label}</dt>
                <dd><InlineValue testid={`field-${d.id}`} label={d.label} kind="text" value={fieldVal(d.id)} canEdit={admin}
                  onSave={(v) => saveField(d.id, v)} error={as.error} />
                  {d.description && <p className="s sf-help" data-testid={`field-help-${d.id}`}>{d.description}</p>}</dd>
              </div>
            ))}
          </dl>}
          {/* Free text: the song's notes and its default transition (what it brings to a setlist's transition note). */}
          {(admin || song.notes || song.defaultTransition) && <dl className="card sf-box sf-wide">
            {(admin || song.notes) && <div className="sf-row"><dt className="lbl">Notes</dt><dd><InlineValue testid="field-notes" label="Notes" kind="textarea" value={text("notes", song.notes)} canEdit={admin}
              className="sf-note" onSave={(v) => save("notes", v, { notes: v || null })} error={as.error} /></dd></div>}
            {(admin || song.defaultTransition) && <div className="sf-row"><dt className="lbl">Default transition</dt><dd><InlineValue testid="field-default-transition" label="Default transition" kind="textarea" value={text("defaultTransition", song.defaultTransition)} canEdit={admin}
              className="sf-note" onSave={(v) => save("defaultTransition", v, { defaultTransition: v.trim() || null })} error={as.error} />
              <p className="s sf-help">Added to this song's transition note when it's put on a setlist by hand. Set it from a setlist with Make default transition.</p></dd></div>}
          </dl>}
        </div>
      </section>

      <section className="sg-sec sg-tight" aria-labelledby="song-files-h" data-testid="song-files">
        <div className="sg-sech">
          <h2 id="song-files-h" className="sg-lbl">Files &amp; links</h2>
          {admin && (
            <div className="flex flex-wrap items-start gap-2">
              {/* Upload ▾ Demo or Chart: a demo goes to the Demos folder, a chart to the Charts folder, and a Writing song's
                  uploads both to the Songwriting folder. The route picks the folder from the kind and the song's status. */}
              <UploadMenu key={song.status === "writing" ? "writing" : "song"} url={`/api/songs/${encodeURIComponent(song.id)}/upload`} testid="song-upload"
                tooBig="Trim it, or put it in Drive yourself and add it from Drive." choices={uploadChoices(song.status === "writing", artistDoc)} />
              <button className="btn outline" onClick={() => { setAdding(!adding); setLinking(false); }} data-testid="add-from-drive">{adding ? "Cancel" : "+ From Drive"}</button>
              <button className="btn outline" onClick={() => { setLinking(!linking); setAdding(false); }} data-testid="add-link">{linking ? "Cancel" : "+ Link"}</button>
            </div>
          )}
        </div>

        {admin && (
          <>
            {checkMsg && <span className="s" data-testid="check-result">{checkMsg}</span>}
            {!artistDoc?.driveFolderId && files.some((f) => f.driveFileId) && <NoBandFolder />}
            {adding && (
              <div className="card">
                <DrivePicker noKey syncWith={song.title} exclude={files.flatMap((f) => f.driveFileId ?? [])} onChange={setPicks} />
                <button className="btn acc" disabled={busy || picks.length === 0} onClick={attach} data-testid="attach-files">Attach {picks.length || ""} file{picks.length === 1 ? "" : "s"}</button>
              </div>
            )}
            {linking && <AddLinkForm songId={song.id} onDone={() => setLinking(false)} />}
          </>
        )}

        {all.length === 0 && <div className="empty" data-testid="no-files"><span>No files or links yet.</span></div>}
        {KIND_ORDER.concat(Array.from(new Set(all.map((f) => f.kind))).filter((k) => !KIND_ORDER.includes(k))).map((k) => {
          // Drive files first (charts by key), then links, each by name.
          const list = all.filter((f) => f.kind === k).sort((a, b) => Number(!a.driveFileId) - Number(!b.driveFileId) || (a.key ?? "").localeCompare(b.key ?? "") || a.title.localeCompare(b.title));
          if (!list.length) return null;
          return (
            <div key={k} className="sg-files" data-testid={`files-${k}`}>
              <h3>{KIND_LABEL[k]}</h3>
              {list.map((f) => <FileLine key={f.id} file={f} m={m} admin={admin} />)}
            </div>
          );
        })}
      </section>
      </div>

      {/* The song's to-dos: named lists like a show's (song templates), in the right-hand column like a show's checklists. Members tick and add items; lists are admins'. */}
      <aside className="show-side" aria-label="To dos" data-testid="song-todos">
        <ChecklistSidebar host={{ kind: "song", id: song.id, artistId, checklists: song.checklists ?? [] }} admin={admin} title="To dos" />
      </aside>

      {/* Each attached Google Doc (lyrics, then charts) read inline, at the bottom of the page. Word and PDF files stay links above. */}
      <div className="show-main show-after">
      {googleDocsOf(files, song.id).map((f) => (
        <section key={f.id} className="sg-sec" aria-labelledby={`doc-${f.id}-h`} data-testid="doc-card">
          <h2 id={`doc-${f.id}-h`} className="sg-lbl" data-testid="doc-title">{f.title}</h2>
          <div className="card"><DocText file={f} /></div>
        </section>
      ))}
      <ErrorBox error={error} />
      </div>
      </div>
    </div>
  );
}

/** A chart is any document: PDF, Word, Pages, OpenDocument, RTF, plain text, or a photo of one. */
const CHART_ACCEPT = [".pdf", ".doc", ".docx", ".odt", ".rtf", ".txt", ".pages", "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/*"].join(",");

/** Upload ▾'s Demo and Chart, each off until its folder is chosen (a Writing song's both wait on the Songwriting folder). */
function uploadChoices(writing: boolean, artist: Partial<Artist> | null | undefined): UploadChoice[] {
  const choice = (key: "demo" | "chart", label: string, accept: string, folder: string, set: boolean): UploadChoice => ({
    key, label, accept, fields: { kind: key }, disabled: !set, hint: `Choose the ${folder} folder on Settings > Google`,
    needsFolder: <>Choose the {folder} folder on <Link href="/admin/google" className="underline">Settings &gt; Google</Link> to upload a {key}.</>,
  });
  const sw = !!artist?.songwritingFolderId;
  return [
    choice("demo", "Demo", "audio/*", writing ? "Songwriting" : "Demos", writing ? sw : !!artist?.demosFolderId),
    choice("chart", "Chart", CHART_ACCEPT, writing ? "Songwriting" : "Charts", writing ? sw : !!artist?.chartsFolderId),
  ];
}

/**
 * Add link: a Spotify, YouTube or any web page, pasted in by an admin, as a Reference, Demo or Recording. YouTube and
 * Spotify play on the page; every link opens in a new tab. A pasted Drive link is attached as the Drive file it is.
 */
function AddLinkForm({ songId, onDone }: { songId: string; onDone(): void }) {
  const { call, error, busy } = useCommand();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<FileKind>("reference");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState("");
  async function add(e: React.FormEvent) {
    e.preventDefault();
    let u = url.trim();
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    const driveFileId = driveIdFromUrl(u);
    // A blank name reads as where the link goes: "Spotify", "YouTube", "SoundCloud", or the site's own host.
    const name = title.trim() || linkName(u);
    const r = await call<{ ids: string[]; skipped: number }>("files.attach", { songId, files: [driveFileId ? { driveFileId, ...(title.trim() ? { title: title.trim() } : {}) } : { url: u, title: name, kind, ...(description.trim() ? { description: description.trim() } : {}) }] });
    if (!r) return;
    if (r.skipped) { setMsg("That link is already on this song."); return; }
    onDone();
  }
  const valid = (() => { try { const u = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`); return u.hostname.includes("."); } catch { return false; } })();
  return (
    <form className="card grid gap-2" onSubmit={add} data-testid="add-link-form">
      <input className="input" inputMode="url" autoFocus placeholder="Paste a Spotify, YouTube or web link" aria-label="Link" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="link-url" />
      <div className="flex flex-wrap gap-2">
        <input className="input min-w-0 flex-1" placeholder="Name (optional)" aria-label="Name" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="link-title" />
        <select className="select !w-auto" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as FileKind)} data-testid="link-kind">
          {LINK_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k].replace(/s$/, "")}</option>)}
        </select>
      </div>
      <textarea className="input" rows={2} placeholder="Description (optional): a reference track, what to listen for…" aria-label="Description" value={description}
        onChange={(e) => setDescription(e.target.value)} data-testid="link-description-new" />
      <div><button className="btn acc" type="submit" disabled={busy || !valid} data-testid="link-save">Add</button></div>
      {msg && <span className="s" data-testid="link-msg">{msg}</span>}
      <ErrorBox error={error} />
    </form>
  );
}

/**
 * Archive, said plainly before it happens. Archiving hides the song: it leaves the Songs list and every song picker, and
 * its page stops opening. Nothing that already names it changes: setlists and templates keep it under its saved title,
 * rehearsals and releases keep it, its files stay attached and Drive is untouched. Activity can undo it. Retired is the
 * gentler choice for a song the band just doesn't play any more, so it's offered here too.
 */
function ArchiveSongDialog({ song, m, onClose, onRetire }: { song: SongRow; m: ReturnType<typeof useMusic>; onClose(): void; onRetire(): void }) {
  const router = useRouter();
  const { call, error, busy } = useCommand();
  const tracks = useCollection<ReleaseTrack>("tracks", { group: true, where: [["songId", "==", song.id]] });
  const refs = songRefs(song.id, { files: m.files, lists: [...m.setlists, ...m.templates], rehearsals: m.rehearsals, tracks: tracks.rows ?? [] });
  const used = refs.setlists + refs.rehearsals + refs.releases + refs.files > 0;
  async function archive() {
    if (await call("songs.remove", { id: song.id })) router.push("/songs");
  }
  return (
    <Dialog open onClose={onClose} title={`Archive ${song.title}?`} testid="archive-song-dialog">
      <div className="grid gap-2 text-sm" data-testid="archive-what">
        <p>Archiving hides the song. It disappears from the Songs list and from the song pickers on setlists and rehearsals, and its page won&apos;t open.</p>
        <p><b>Nothing it&apos;s already on changes.</b> Setlists and templates keep it under its name, rehearsals and releases keep it, and its files stay attached (nothing is deleted from Drive).</p>
        <p className="s" data-testid="archive-refs">{tracks.loading ? "Counting…" : used ? `It's on: ${refsLabel(refs)}.` : "Nothing is attached to it yet."}</p>
        <p className="s">Changed your mind later? Undo it from Artist settings &gt; Activity.</p>
        {song.status !== "retired" && <p className="s">If the band just doesn&apos;t play it any more, mark it <b>Retired</b> instead: it stays in the Songs list and can still be added to a setlist.</p>}
      </div>
      <ErrorBox error={error} />
      <div className="flex flex-wrap gap-2">
        <button className="btn danger" disabled={busy} onClick={archive} data-testid="archive-confirm">Archive</button>
        {song.status !== "retired" && <button className="btn outline" disabled={busy} onClick={onRetire} data-testid="archive-retire">Mark Retired instead</button>}
        <button className="btn ghost" onClick={onClose} data-testid="archive-cancel">Cancel</button>
      </div>
    </Dialog>
  );
}

/** The releases this song is on, as small links after the page's key · bpm · length: "Album · Track 3", one per track. Nothing when it's on none. */
function ReleaseLinks({ songId, lead }: { songId: string; lead: boolean }) {
  const tracks = useCollection<ReleaseTrack>("tracks", { group: true, where: [["songId", "==", songId]] });
  const releases = useCollection<Release>("releases");
  const rows = (tracks.rows ?? []).flatMap((t) => {
    const a = releases.rows?.find((x) => x.id === t.releaseId);
    return a ? [{ t, a }] : [];
  }).sort((x, y) => (y.a.releaseDate ?? "").localeCompare(x.a.releaseDate ?? "") || x.a.title.localeCompare(y.a.title));
  if (!rows.length) return null;
  return (
    <span data-testid="on-releases">
      {lead && " · "}On{" "}
      {rows.map(({ t, a }, i) => (
        <span key={t.id}>{i > 0 && ", "}<Link href={trackHref(a.id, t.id)} className="underline" data-testid={`on-release-${a.id}`}>{a.title} · Track {t.position}</Link></span>
      ))}
    </span>
  );
}
