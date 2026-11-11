"use client";
import { useState } from "react";
import Link, { useArtist } from "@/lib/artist";
import { ErrorBox, useCommand } from "@/components/ui";
import { FileIcon } from "@/components/music/common";
import { DrivePicker, type Pick } from "@/components/music/DrivePicker";
import { Upload } from "@/components/music/Upload";
import { RELEASE_FILE_GROUPS, RELEASE_FILE_KINDS } from "@/lib/releases";
import { MIME_GDOC, PROVIDER_LABEL, providerFor, type FileKind } from "@/lib/music";
import { trackHref, type ReleaseData, type FileRow } from "./common";

/** What sort of file it is, for the meta line: "Image", "Google Doc", "PDF", "Spotify"... */
export function fileTypeLabel(f: { mimeType?: string; driveFileId?: string; url: string; provider?: string }): string {
  const m = f.mimeType;
  if (!f.driveFileId) return PROVIDER_LABEL[(f.provider as keyof typeof PROVIDER_LABEL) ?? providerFor(f.url)] ?? "Link";
  if (!m) return "File";
  if (m.startsWith("image/")) return "Image";
  if (m.startsWith("audio/")) return "Audio";
  if (m.startsWith("video/")) return "Video";
  if (m === MIME_GDOC) return "Google Doc";
  if (m === "application/vnd.google-apps.folder") return "Folder";
  if (m === "application/vnd.google-apps.spreadsheet") return "Google Sheet";
  if (m === "application/pdf") return "PDF";
  if (m.includes("zip")) return "Zip";
  if (m.includes("photoshop")) return "Photoshop";
  if (m.includes("word")) return "Word";
  return "File";
}
const localPart = (email?: string) => (email ? email.split("@")[0] : "");
/** A checked Drive file with a sharing gap: someone in the band can't open it, or it sits outside the band and release folders. */
export const missingOf = (f: FileRow) => (!f.sharing || f.sharing === "ok" ? [] : f.sharing.missing);
export const hasGap = (f: FileRow) => !!f.driveFileId && f.inBandFolder !== undefined && (missingOf(f).length > 0 || f.inBandFolder === false);

/** The release's own files (artwork, release masters, liner notes, promo), with sharing fixes, and a way to every track's files. */
export function ReleaseFiles({ data }: { data: ReleaseData }) {
  const { call, error, busy } = useCommand();
  const release = data.release;
  if (!release) return null;
  const files = data.files.filter((f) => !f.releaseTrackId);
  const gaps = files.filter(hasGap);
  const outsideOwners = [...new Set(gaps.filter((f) => f.inBandFolder === false).map((f) => localPart(f.ownerEmail)).filter(Boolean))];

  return (
    <div className="grid gap-5" data-testid="release-files">
      {data.admin && gaps.length > 0 && (
        <div className="sg-strip" data-testid="files-gap">
          <span className="sg-strip-t">
            <b>{gaps.length} file{gaps.length === 1 ? "" : "s"} band members can&apos;t open</b>
            {outsideOwners.length > 0 && <span className="s">They&apos;re in {outsideOwners.join(" and ")}&apos;s Drive, outside the release folder.</span>}
          </span>
          <span className="flex flex-wrap gap-2">
            {gaps.some((f) => missingOf(f).length > 0) && (
              <button type="button" className="btn outline sm" disabled={busy} data-testid="fix-share"
                onClick={() => call("files.shareWithBand", { ids: gaps.filter((f) => missingOf(f).length > 0).map((f) => f.id) })}>Share with band</button>
            )}
            {gaps.some((f) => f.inBandFolder === false) && (
              <button type="button" className="btn outline sm" disabled={busy} data-testid="fix-copy"
                onClick={() => call("releases.files.copyToFolder", { releaseId: release.id, ids: gaps.filter((f) => f.inBandFolder === false).map((f) => f.id) })}>Copy into release folder</button>
            )}
          </span>
        </div>
      )}
      <ErrorBox error={error} />

      {RELEASE_FILE_GROUPS.map((g) => (
        <FileGroup key={g.kind} releaseId={release.id} hasFolder={!!release.driveFolderId} kind={g.kind} label={g.label} hint={g.hint} admin={data.admin}
          files={files.filter((f) => f.kind === g.kind)} exclude={files.flatMap((f) => f.driveFileId ?? [])} />
      ))}

      <section className="card" data-testid="track-files-list" aria-labelledby="track-files-h">
        <h2 id="track-files-h" className="card-h">Track files</h2>
        <span className="s">Mixes, masters, stems and session files live on each track.</span>
        {data.tracks.length === 0 && <span className="s">No tracks yet.</span>}
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {data.tracks.map((t) => {
            const n = data.files.filter((f) => f.releaseTrackId === t.id).length;
            return (
              <Link key={t.id} href={trackHref(release.id, t.id)} className="font-semibold" data-testid={`track-files-${t.id}`}>
                {t.position} · {t.title} <span className="s">· {n} file{n === 1 ? "" : "s"}</span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function FileGroup({ releaseId, hasFolder, kind, label, hint, admin, files, exclude }: {
  releaseId: string; hasFolder: boolean; kind: FileKind; label: string; hint: string; admin: boolean; files: FileRow[]; exclude: string[];
}) {
  const { call, error, busy } = useCommand();
  const artistDoc = useArtist().doc;
  const [adding, setAdding] = useState(false);
  const [picks, setPicks] = useState<Pick[]>([]);
  const sorted = [...files].sort((a, b) => a.title.localeCompare(b.title));

  async function attach() {
    const r = await call("releases.files.attach", { releaseId, files: picks.map((p) => ({ driveFileId: p.driveFileId, kind: p.kind })) });
    if (r) { setAdding(false); setPicks([]); }
  }

  return (
    <section className="sg-files" data-testid={`files-group-${kind}`} aria-labelledby={`files-h-${kind}`}>
      <div className="sg-sech px-5 pb-2.5 pt-3.5">
        <span className="grid gap-0.5">
          <h3 id={`files-h-${kind}`} className="text-base font-extrabold">{label}</h3>
          <span className="s">{hint}</span>
        </span>
        {admin && (
          <div className="flex flex-wrap items-start gap-2">
            <Upload url={`/api/releases/${encodeURIComponent(releaseId)}/files`} fields={{ kind }} label="Upload" accept={kind === "artwork" ? "image/*" : "*/*"}
              testid={`release-upload-${kind}`} disabled={!hasFolder && !artistDoc?.driveFolderId} tooBig="Put it in Drive yourself and add it from Drive."
              needsFolder={<>Make the release folder (under Tracks) or choose the band folder on <Link href="/admin/google" className="underline">Settings &gt; Google</Link> to upload.</>} />
            <button type="button" className="btn acc" onClick={() => setAdding(!adding)} aria-expanded={adding} data-testid={`add-from-drive-${kind}`}>{adding ? "Cancel" : "+ Add from Drive"}</button>
          </div>
        )}
      </div>
      {admin && adding && (
        <div className="grid gap-2 border-t border-line px-5 py-3">
          <DrivePicker all kinds={RELEASE_FILE_KINDS} defaultKind={kind} placeholder="Search Drive…" exclude={exclude} onChange={setPicks} testid={`picker-${kind}`} />
          <button type="button" className="btn acc justify-self-start" disabled={busy || picks.length === 0} onClick={attach} data-testid={`attach-${kind}`}>
            Attach {picks.length || ""} file{picks.length === 1 ? "" : "s"}
          </button>
        </div>
      )}
      {sorted.length === 0 && <div className="sg-row"><span className="s">Nothing here yet.</span></div>}
      {sorted.map((f) => {
        const tag = f.inBandFolder ? <span className="chip g">Release folder</span> : missingOf(f).length > 0 ? <span className="chip y">Not shared</span> : null;
        return (
          <div key={f.id} className="sg-row" data-testid={`file-${f.id}`}>
            <div className="sg-rowh">
              <FileIcon mime={f.mimeType} kind={f.kind} provider={f.driveFileId ? undefined : f.provider ?? providerFor(f.url)} />
              <span className="sg-rowt">
                <a href={f.url} target="_blank" rel="noreferrer" className="truncate font-bold" data-testid="file-label">{f.title}</a>
                <span className="s">{[fileTypeLabel(f), f.ownerEmail ? `added by ${localPart(f.ownerEmail)}` : null].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="sg-rowa items-center">
                {tag}
                {admin && <button type="button" className="btn danger sm" disabled={busy} data-testid="file-remove"
                  onClick={() => confirm(`Remove ${f.title} from this release? ${f.driveFileId ? "The Drive file stays put." : "The link itself is untouched."}`) && call("files.remove", { id: f.id })}>Remove</button>}
              </span>
            </div>
          </div>
        );
      })}
      <ErrorBox error={error} />
    </section>
  );
}
