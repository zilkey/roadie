"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import Link, { useArtist } from "@/lib/artist";
import { BackLink } from "@/components/BackLink";
import { AdminOnly } from "@/components/Guard";
import { InlineValue } from "@/components/InlineValue";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { FileIcon } from "@/components/music/common";
import { DrivePicker, type Pick } from "@/components/music/DrivePicker";
import { Upload } from "@/components/music/Upload";
import { AudioPanel, PlayToggle } from "@/components/music/AudioPlayer";
import { ReleaseMissing, releaseHref, trackHref, useRelease, type ReleaseData, type FileRow, type TrackRow } from "@/components/releases/common";
import { useCollection } from "@/lib/firestore-hooks";
import { TRACK_FILE_KINDS, TRACK_STATUS_LABEL, fmtVersion, trackReached } from "@/lib/releases";
import { CATEGORY_LABEL, PAYOUT_KIND_LABEL, formatCents } from "@/lib/money";
import { fmtLen, playsInline, providerFor, type FileKind } from "@/lib/music";
import { fmtInstant } from "@/lib/timezone";
import type { Expense, FileDoc, Payout, TrackStatus } from "@/schema";

/** The steps the stepper shows; "mixing" reads as the current label on the Mixed step. */
const STEPS: TrackStatus[] = ["tracking", "overdubs", "mixed", "mastered"];
const localPart = (email?: string) => (email ? email.split("@")[0] : "");
const byVersion = (a: FileRow, b: FileRow) => (b.version ?? 0) - (a.version ?? 0) || a.title.localeCompare(b.title);
/** "Oct 20": when the file was attached / last checked in Drive. */
function fileDate(f: FileRow) {
  const c = f.checkedAt as unknown as { toMillis?(): number } | Date | undefined;
  const ms = c instanceof Date ? c.getTime() : c?.toMillis?.();
  return ms ? fmtInstant(ms, { month: "short", day: "numeric" }) : null;
}

export default function TrackPage() { return <AdminOnly><Track /></AdminOnly>; }

function Track() {
  const { id, trackId } = useParams<{ id: string; trackId: string }>();
  const d = useRelease(id);
  if (d.loading) return null;
  const track = d.tracks.find((t) => t.id === trackId);
  if (!d.release || !track) return <ReleaseMissing />;
  return <TrackView d={d} track={track} />;
}

function TrackView({ d, track }: { d: ReleaseData; track: TrackRow }) {
  const release = d.release!;
  const admin = d.admin;
  const { call, error, busy } = useCommand();
  const song = d.songs.find((s) => s.id === track.songId);
  const i = d.tracks.findIndex((t) => t.id === track.id);
  const prev = d.tracks[i - 1], next = d.tracks[i + 1];
  const files = d.files.filter((f) => f.releaseTrackId === track.id);
  const mixes = files.filter((f) => f.kind === "mix").sort(byVersion);
  const masters = files.filter((f) => f.kind === "master").sort(byVersion);
  const extras = files.filter((f) => f.kind === "stems" || f.kind === "session" || f.kind === "other").sort((a, b) => a.title.localeCompare(b.title));
  const approvedMix = mixes.find((f) => f.approved);
  const update = async (patch: Record<string, unknown>) => !!(await call("releases.tracks.update", { releaseId: release.id, id: track.id, patch }));

  const sub = [track.lengthSec ? `${fmtLen(track.lengthSec)} on the release` : null, song?.key, song?.bpm ? `${song.bpm} bpm` : null].filter(Boolean).join(" · ");

  return (
    <div className="sg-page" data-testid="track-page">
      <PageTitle
        back={
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <BackLink mode="parent" href={`/releases/${release.id}`} label={release.title} />
            <span className="flex gap-3 text-sm font-semibold">
              {prev && <Link href={trackHref(release.id, prev.id)} data-testid="track-prev">‹ Track {prev.position}</Link>}
              {next && <Link href={trackHref(release.id, next.id)} data-testid="track-next">Track {next.position} ›</Link>}
            </span>
          </div>
        }
        title={<>
          <span className="lbl block" data-testid="track-pos">Track {track.position} of {d.tracks.length}{track.side ? ` · Side ${track.side}` : ""}</span>
          {admin
            ? <InlineValue testid="field-title" label="Title" kind="text" value={track.title} canEdit error={error}
                validate={(v) => (v.trim() ? null : "A track needs a title")} onSave={(v) => update({ title: v.trim() })} />
            : track.title}
        </>}
        sub={sub || undefined}
        actions={<Link href={`/songs/${track.songId}`} className="btn outline" data-testid="open-song">Open song</Link>} />
      <ErrorBox error={error} />

      <section className="card" aria-label="Track status" data-testid="track-status">
        <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
          {STEPS.map((step) => {
            const current = step === track.status || (step === "mixed" && track.status === "mixing");
            const reached = trackReached(track.status, step);
            const label = step === "mixed" && track.status === "mixing" ? TRACK_STATUS_LABEL.mixing
              : step === "mixed" && approvedMix ? `Mixed · ${fmtVersion(approvedMix.version) || approvedMix.title} approved` : TRACK_STATUS_LABEL[step];
            const text = <>{label}{reached && " ✓"}</>;
            const cls = `pill${reached ? " ok" : ""}`;
            const style = current ? { outline: "2px solid var(--accent)", outlineOffset: 1 } : undefined;
            return (
              <li key={step} aria-current={current ? "step" : undefined}>
                {admin
                  ? <button type="button" className={`${cls} cursor-pointer border-0`} style={style} disabled={busy || step === track.status}
                      onClick={() => void update({ status: step })} data-testid={`track-step-${step}`}>{text}</button>
                  : <span className={cls} style={style} data-testid={`track-step-${step}`}>{text}</span>}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="sg-files" data-testid="mixes" aria-labelledby="mixes-h">
        <CardHead id="mixes-h" title="Mixes" note="Newest first. Approving one marks the track mixed." />
        {admin && (
          <AddFiles releaseId={release.id} trackId={track.id} name="mix" kind="mix" label="+ Add mix from Drive" exclude={files.flatMap((f) => f.driveFileId ?? [])}
            upload={{ testid: "track-upload-mix", accept: "audio/*" }} />
        )}
        {mixes.length === 0 && <div className="sg-row"><span className="s">No mixes yet.</span></div>}
        {mixes.map((f) => <VersionRow key={f.id} file={f} what="Mix" admin={admin} notes />)}
      </section>

      <div className="grid gap-5 sm:grid-cols-2">
        <section className="sg-files content-start" data-testid="masters" aria-labelledby="masters-h">
          <CardHead id="masters-h" title="Master" />
          {admin && (
            <AddFiles releaseId={release.id} trackId={track.id} name="master" kind="master" label="+ Add master from Drive" exclude={files.flatMap((f) => f.driveFileId ?? [])}
              upload={{ testid: "track-upload-master", accept: "audio/*" }} />
          )}
          {masters.length === 0 && <div className="sg-row"><span className="s">No master yet. Add one for streaming, and another for vinyl if it differs.</span></div>}
          {masters.map((f) => <VersionRow key={f.id} file={f} what="Master" admin={admin} />)}
        </section>
        <section className="sg-files content-start" data-testid="stems-session" aria-labelledby="stems-h">
          <CardHead id="stems-h" title="Stems and session" />
          {admin && <AddFiles releaseId={release.id} trackId={track.id} name="stems" kind="stems" label="+ Add from Drive" exclude={files.flatMap((f) => f.driveFileId ?? [])} />}
          {extras.length === 0 && <div className="sg-row"><span className="s">Nothing here yet.</span></div>}
          {extras.map((f) => <LinkRow key={f.id} file={f} admin={admin} />)}
        </section>
      </div>

      <Credits d={d} track={track} />

      <div className="grid gap-5 sm:grid-cols-2">
        <section className="grid content-start gap-2.5" aria-labelledby="release-h">
          <h2 id="release-h" className="sg-lbl">Release details</h2>
          <dl className="card sg-dl" data-testid="release-details">
            <div><dt className="lbl">ISRC</dt><dd>
              <InlineValue testid="field-isrc" label="ISRC" kind="text" value={track.isrc ?? ""} emptyLabel="Not yet" canEdit={admin} error={error}
                onSave={(v) => update({ isrc: v.trim() || null })} />
            </dd></div>
            <div><dt className="lbl">Explicit</dt><dd>{admin
              ? <select className="select" aria-label="Explicit" value={track.explicit ? "yes" : "no"} data-testid="field-explicit"
                  onChange={(e) => void update({ explicit: e.target.value === "yes" })}>
                  <option value="no">No</option><option value="yes">Yes</option>
                </select>
              : <span data-testid="field-explicit">{track.explicit ? "Yes" : "No"}</span>}</dd></div>
            <div><dt className="lbl">Writers</dt><dd data-testid="field-writers">{song?.writers || "—"}</dd></div>
            <div><dt className="lbl">Lyrics</dt><dd data-testid="field-lyrics">
              {song?.lyricsDoc?.url ? <a href={song.lyricsDoc.url} target="_blank" rel="noreferrer" className="underline">From the song</a> : "—"}
            </dd></div>
          </dl>
        </section>
        {admin && <TrackCosts releaseId={release.id} trackId={track.id} />}
      </div>

      <FromSong songId={track.songId} />
    </div>
  );
}

function CardHead({ id, title, note, children }: { id: string; title: string; note?: string; children?: React.ReactNode }) {
  return (
    <div className="sg-sech px-5 pb-2.5 pt-3.5">
      <span className="grid gap-0.5">
        <h2 id={id} className="text-base font-extrabold">{title}</h2>
        {note && <span className="s">{note}</span>}
      </span>
      {children}
    </div>
  );
}

/** "+ Add … from Drive" (a picker, then Attach) and, for mixes and masters, Upload into the release folder. */
function AddFiles({ releaseId, trackId, name, kind, label, exclude, upload }: {
  releaseId: string; trackId: string; name: string; kind: FileKind; label: string; exclude: string[]; upload?: { testid: string; accept: string };
}) {
  const { call, error, busy } = useCommand();
  const artistDoc = useArtist().doc;
  const [adding, setAdding] = useState(false);
  const [picks, setPicks] = useState<Pick[]>([]);
  async function attach() {
    const r = await call("releases.files.attach", { releaseId, trackId, files: picks.map((p) => ({ driveFileId: p.driveFileId, kind: p.kind })) });
    if (r) { setAdding(false); setPicks([]); }
  }
  return (
    <div className="grid gap-2 px-5 pb-3">
      <div className="flex flex-wrap items-start gap-2">
        <button type="button" className="btn acc" onClick={() => setAdding(!adding)} aria-expanded={adding} data-testid={`add-${name}-from-drive`}>{adding ? "Cancel" : label}</button>
        {upload && (
          <Upload url={`/api/releases/${encodeURIComponent(releaseId)}/files`} fields={{ trackId, kind }} label="Upload" accept={upload.accept} testid={upload.testid}
            disabled={!artistDoc?.driveFolderId} tooBig="Put it in Drive yourself and add it from Drive."
            needsFolder={<>Choose the band folder on <Link href="/admin/google" className="underline">Settings &gt; Google</Link> to upload.</>} />
        )}
      </div>
      {adding && (
        <>
          <DrivePicker all kinds={TRACK_FILE_KINDS} defaultKind={kind} placeholder="Search Drive…" exclude={exclude} onChange={setPicks} testid={`picker-${name}`} />
          <button type="button" className="btn acc justify-self-start" disabled={busy || picks.length === 0} onClick={attach} data-testid={`attach-${name}`}>
            Attach {picks.length || ""} file{picks.length === 1 ? "" : "s"}
          </button>
        </>
      )}
      <ErrorBox error={error} />
    </div>
  );
}

/** A mix or master: play it, open it, approve it; a mix also carries the band's notes. */
function VersionRow({ file, what, admin, notes }: { file: FileRow; what: string; admin: boolean; notes?: boolean }) {
  const { call, error, busy } = useCommand();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const audio = playsInline(file);
  const label = [file.version ? `${what} ${fmtVersion(file.version)}` : what, file.title].join(" · ");
  const when = fileDate(file);
  async function note() {
    if (!body.trim()) return;
    if (await call("releases.files.note", { id: file.id, body: body.trim() })) setBody("");
  }
  return (
    <div className="sg-row" data-testid={`file-${file.id}`}>
      <div className="sg-rowh">
        <FileIcon mime={file.mimeType} kind={file.kind} provider={file.driveFileId ? undefined : file.provider ?? providerFor(file.url)} />
        <span className="sg-rowt">
          <a href={file.url} target="_blank" rel="noreferrer" className="truncate font-bold" data-testid="file-label">{label}</a>
          <span className="s">{[when, file.ownerEmail ? `from ${localPart(file.ownerEmail)}` : null].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="sg-rowa items-center">
          {audio && <PlayToggle file={file} open={open} onOpen={setOpen} />}
          {file.approved
            ? <span className="chip g" data-testid={`approved-${file.id}`}>Approved</span>
            : admin && <button type="button" className="btn outline sm" disabled={busy} onClick={() => call("releases.files.approve", { id: file.id, approved: true })} data-testid={`approve-${file.id}`}>Approve</button>}
          {admin && <button type="button" className="btn danger sm" disabled={busy} data-testid="file-remove"
            onClick={() => confirm(`Remove ${file.title} from this track? ${file.driveFileId ? "The Drive file stays put." : "The link itself is untouched."}`) && call("files.remove", { id: file.id })}>Remove</button>}
        </span>
      </div>
      {open && audio && <AudioPanel file={file} />}
      {notes && (file.notes?.length ?? 0) > 0 && (
        <ul className="m-0 grid list-none gap-1 p-0">
          {file.notes!.map((n) => <li key={n.id} className="text-sm" data-testid={`note-${n.id}`}><b>{n.name || "Someone"}</b> {n.body}</li>)}
        </ul>
      )}
      {notes && admin && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void note(); }}>
          <input className="input" placeholder="Add a note…" aria-label={`Add a note to ${label}`} value={body} onChange={(e) => setBody(e.target.value)} data-testid={`note-input-${file.id}`} />
          <button type="submit" className="btn ghost" disabled={busy || !body.trim()} data-testid={`note-submit-${file.id}`}>Add</button>
        </form>
      )}
      <ErrorBox error={error} />
    </div>
  );
}

/** A stems / session / other file: a link with its kind. */
function LinkRow({ file, admin }: { file: FileRow; admin: boolean }) {
  const { call, error, busy } = useCommand();
  return (
    <div className="sg-row" data-testid={`file-${file.id}`}>
      <div className="sg-rowh">
        <a href={file.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 font-semibold" data-testid="file-label">{file.title} <span className="s">· {file.kind}</span></a>
        {admin && <button type="button" className="btn danger sm" disabled={busy} data-testid="file-remove"
          onClick={() => confirm(`Remove ${file.title} from this track?`) && call("files.remove", { id: file.id })}>Remove</button>}
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

function Credits({ d, track }: { d: ReleaseData; track: TrackRow }) {
  const { call, error, busy } = useCommand();
  const [who, setWho] = useState("");
  const [role, setRole] = useState("");
  const credits = track.credits ?? [];
  const save = (next: typeof credits) => call("releases.tracks.update", { releaseId: track.releaseId, id: track.id, patch: { credits: next } });
  async function add() {
    if (!who.trim() || !role.trim()) return;
    if (await save([...credits, { who: who.trim(), role: role.trim() }])) { setWho(""); setRole(""); }
  }
  const names = [...new Set(d.musicians.filter((m) => m.active).map((m) => m.name))].sort();
  return (
    <section className="card" data-testid="credits" aria-labelledby="credits-h">
      <span className="grid gap-0.5">
        <h2 id="credits-h" className="card-h">Credits</h2>
        <span className="s">Players start from the band&apos;s people; guests can be added</span>
      </span>
      {credits.length === 0 && <span className="s">No credits yet.</span>}
      {credits.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <tbody>
            {credits.map((c, i) => (
              <tr key={`${c.who}-${i}`} className="border-t border-line first:border-t-0" data-testid={`credit-${i}`}>
                <th scope="row" className="py-2 pr-4 text-left font-bold">{c.who}</th>
                <td className="py-2">{c.role}</td>
                {d.admin && <td className="py-2 text-right"><button type="button" className="btn ghost sm" disabled={busy} aria-label={`Remove ${c.who}`}
                  onClick={() => void save(credits.filter((_, j) => j !== i))} data-testid={`credit-remove-${i}`}>Remove</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.admin && (
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <input className="input !w-auto min-w-0 flex-1" placeholder="Who" aria-label="Who" list={`credit-people-${track.id}`} value={who} onChange={(e) => setWho(e.target.value)} data-testid="credit-who" />
          <datalist id={`credit-people-${track.id}`}>{names.map((n) => <option key={n} value={n} />)}</datalist>
          <input className="input !w-auto min-w-0 flex-[2]" placeholder="Role, e.g. Electric guitar" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} data-testid="credit-role" />
          <button type="submit" className="btn acc" disabled={busy || !who.trim() || !role.trim()} data-testid="credit-add">Add</button>
        </form>
      )}
      <ErrorBox error={error} />
    </section>
  );
}

/** Money out pinned to this track: expenses and payouts (a session player's pay), newest first. */
function TrackCosts({ releaseId, trackId }: { releaseId: string; trackId: string }) {
  const expenses = useCollection<Expense>("expenses");
  const payouts = useCollection<Payout>("payouts");
  const mine = [
    ...(expenses.rows ?? []).filter((x) => x.releaseTrackId === trackId).map((x) => ({ id: x.id, date: x.date, label: `${CATEGORY_LABEL[x.category] ?? x.category} · ${x.what}`, amount: x.amount })),
    ...(payouts.rows ?? []).filter((p) => p.releaseTrackId === trackId).map((p) => ({ id: p.id, date: p.paidAt ?? p.dueDate ?? "", label: `${PAYOUT_KIND_LABEL[p.kind] ?? p.kind} · ${p.to.name}${p.what ? ` · ${p.what}` : ""}`, amount: p.amount })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = mine.reduce((n, x) => n + x.amount, 0);
  return (
    <section className="grid content-start gap-2.5" aria-labelledby="costs-h">
      <h2 id="costs-h" className="sg-lbl">Costs on this track</h2>
      <div className="card" data-testid="track-costs">
        {mine.length === 0 && <span className="s">Nothing spent on this track yet.</span>}
        {mine.map((x) => (
          <div key={x.id} className="flex justify-between gap-3 text-sm" data-testid={`cost-${x.id}`}>
            <span>{x.label}</span><span className="font-mono">{formatCents(x.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t border-line pt-2 font-bold">
          <span>Total</span><span className="font-mono" data-testid="track-costs-total">{formatCents(total)}</span>
        </div>
        <Link href={releaseHref(releaseId, "money")} className="text-sm font-semibold" data-testid="release-money-link">All release money →</Link>
      </div>
    </section>
  );
}

/** The song's own files (charts, demos...): they live on the song and show wherever it is used. */
function FromSong({ songId }: { songId: string }) {
  const files = useCollection<FileDoc>("files", { where: [["songId", "==", songId]] });
  const rows = [...(files.rows ?? [])].sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
  return (
    <section className="card" data-testid="from-song" aria-labelledby="from-song-h">
      <div className="sg-sech">
        <span className="grid gap-0.5">
          <h2 id="from-song-h" className="card-h">From the song</h2>
          <span className="s">These live on the song and show on every release and setlist that uses it.</span>
        </span>
        <Link href={`/songs/${songId}`} className="text-sm font-semibold" data-testid="from-song-open">Open song →</Link>
      </div>
      {files.rows && rows.length === 0 && <span className="s">The song has no files yet.</span>}
      {rows.map((f) => (
        <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="font-semibold" data-testid={`song-file-${f.id}`}>
          {f.kind === "chart" && f.key ? `Chart in ${f.key}` : f.title} <span className="s">· {f.kind}</span>
        </a>
      ))}
    </section>
  );
}

