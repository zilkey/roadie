"use client";
import { useState } from "react";
import Link from "@/lib/artist";
import { ErrorBox, Select, useCommand } from "@/components/ui";

interface Folder { id: string; name: string; url: string }
interface Fresh { folder: Folder | null; files: { driveFileId: string; name: string; mimeType: string; url: string; createdAt: string }[] }

/**
 * The rehearsal's Drive folder and what landed in it by hand (the Drive app's share sheet, a voice memo shared from
 * the phone): Drive folder makes the folder if needed and links to it; Check Drive folder lists the audio and video
 * in it that isn't attached yet, each with a song to attach it to. Attaching renames the file to the app's
 * "{song} - {date} Rehearsal" convention, shares it with the band and puts it on the song and the rehearsal.
 */
export function NewRecordings({ rehearsalId, songs, hasFolder }: { rehearsalId: string; songs: { id: string; title: string }[]; hasFolder: boolean }) {
  const { call, error, busy } = useCommand();
  const [folder, setFolder] = useState<Folder | null>(null);
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const options = songs.map((s) => [s.id, s.title] as const);

  async function openFolder() {
    const f = await call<Folder>("rehearsals.folder", { id: rehearsalId });
    if (f) setFolder(f);
  }
  async function check() {
    const r = await call<Fresh>("rehearsals.newRecordings", { id: rehearsalId });
    if (r) { setFresh(r); if (r.folder) setFolder(r.folder); }
  }
  async function attach(driveFileId: string) {
    const songId = pick[driveFileId];
    if (!songId) return;
    if (await call("rehearsals.adoptRecording", { id: rehearsalId, songId, driveFileId })) await check();
  }

  if (!hasFolder) {
    return <div className="text-xs s" data-testid="reh-folder-needs-setting">Choose the rehearsal recordings folder on <Link href="/admin/google" className="underline">Settings › Google</Link> to give this rehearsal a Drive folder.</div>;
  }
  return (
    <div className="grid gap-2" data-testid="reh-drive-folder">
      <div className="flex flex-wrap items-center gap-2">
        {folder
          ? <a className="btn ghost sm" href={folder.url} target="_blank" rel="noreferrer" data-testid="reh-folder-open">Open {folder.name} in Drive ↗</a>
          : <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void openFolder()} data-testid="reh-folder">Drive folder</button>}
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void check()} data-testid="reh-check-folder">Check Drive folder</button>
      </div>
      <ErrorBox error={error} />
      {fresh && (
        <div className="grid gap-2" data-testid="reh-new-recordings">
          {!fresh.folder ? <span className="s text-sm" data-testid="reh-new-none">No Drive folder for this rehearsal yet. Press Drive folder to make one, then share recordings into it.</span>
            : fresh.files.length === 0 ? <span className="s text-sm" data-testid="reh-new-none">Nothing new in {fresh.folder.name}. Share a recording into it from the Drive app, then check again.</span>
            : <span className="lbl">New in {fresh.folder.name}</span>}
          {fresh.files.map((f) => (
            <div key={f.driveFileId} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2" data-testid={`reh-new-${f.name}`}>
              <span className="grid min-w-0 flex-1"><b className="truncate text-sm">{f.name}</b><span className="s">{f.mimeType.startsWith("video/") ? "Video" : "Audio"}</span></span>
              <Select value={(pick[f.driveFileId] ?? "") as string} options={options} placeholder="Which song?" onChange={(v) => setPick({ ...pick, [f.driveFileId]: v })} testid="reh-new-song" label={`Song for ${f.name}`} />
              <button type="button" className="btn acc sm" disabled={busy || !pick[f.driveFileId]} onClick={() => void attach(f.driveFileId)} data-testid="reh-new-attach">Attach</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
