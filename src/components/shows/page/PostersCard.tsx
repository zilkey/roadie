"use client";
import Link, { useArtist } from "@/lib/artist";
import { ErrorBox, useCommand } from "@/components/ui";
import { useCollection } from "@/lib/firestore-hooks";
import { FileIcon, thumbOf } from "@/components/music/common";
import { Upload } from "@/components/music/Upload";
import type { FileDoc } from "@/schema";
import type { ShowRow } from "../common";
import { ShowCard } from "./kit";

/**
 * The show's posters: pictures (or PDFs) anyone in the band uploads. Each goes into the show's Drive folder, "{date} {venue}"
 * inside the Shows folder from Settings > Google, made on the first upload; the folder is linked once it exists. Upload stays
 * off until an admin chooses the Shows folder.
 */
export function PostersCard({ show, admin }: { show: ShowRow; admin: boolean }) {
  const { call, error, busy } = useCommand();
  const artist = useArtist().doc;
  const { rows } = useCollection<FileDoc>("files", { where: [["showId", "==", show.id]] });
  const posters = (rows ?? []).slice().sort((a, b) => a.title.localeCompare(b.title));
  const hasFolder = !!artist?.showsFolderId;

  return (
    <ShowCard title="Posters" testid="posters"
      aside={show.driveFolderId ? <a href={`https://drive.google.com/drive/folders/${show.driveFolderId}`} target="_blank" rel="noreferrer" className="s underline" data-testid="show-folder-link">{show.driveFolderName ?? "Show folder"} ↗</a> : undefined}>
      <div className="grid gap-3" data-testid="posters-view">
        <Upload url={`/api/shows/${encodeURIComponent(show.id)}/posters`} label="Upload a poster" accept="image/*,application/pdf" testid="poster-upload"
          disabled={!hasFolder} tooBig="Put it in Drive yourself and share it with the band."
          needsFolder={admin
            ? <>Choose the Shows folder on <Link href="/admin/google" className="underline">Settings &gt; Google</Link> to upload posters.</>
            : <>An admin has to choose the Shows folder on Settings &gt; Google before posters can be uploaded.</>} />
        {rows && posters.length === 0 && <span className="s" data-testid="posters-none">No posters yet.</span>}
        {posters.length > 0 && (
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2" data-testid="posters-list">
            {posters.map((f) => {
              const thumb = thumbOf(f);
              return (
                <li key={f.id} className="grid gap-2 rounded-lg border border-line p-3" data-testid={`poster-${f.id}`}>
                  <a href={f.url} target="_blank" rel="noreferrer" className="grid gap-2" data-testid="poster-link">
                    {thumb
                      ? <img src={thumb} alt={f.title} className="max-h-72 w-full rounded object-contain bg-soft" loading="lazy" data-testid="poster-thumb" />
                      : <span className="flex items-center gap-2"><FileIcon mime={f.mimeType} kind="poster" /></span>}
                    <span className="truncate font-bold underline" data-testid="poster-title">{f.title}</span>
                  </a>
                  <button type="button" className="btn outline sm justify-self-start" disabled={busy} data-testid="poster-remove"
                    onClick={() => confirm(`Take ${f.title} off this show? The Drive file stays put.`) && call("shows.posters.remove", { id: f.id })}>Remove</button>
                </li>
              );
            })}
          </ul>
        )}
        <ErrorBox error={error} />
      </div>
    </ShowCard>
  );
}
