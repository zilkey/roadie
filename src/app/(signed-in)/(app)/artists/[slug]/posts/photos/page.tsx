"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { AdminOnly } from "@/components/Guard";
import { useCollection } from "@/lib/firestore-hooks";
import { runCommand } from "@/lib/commands";
import { Upload } from "@/components/music/Upload";
import { PostsTabs } from "@/components/posts/PostsTabs";
import { PhotoGrid, type GridPhoto } from "@/components/posts/PhotoGrid";
import { AddToDraftDialog } from "@/components/posts/AddToDraftDialog";
import { dayLabels, groupByDay, type LabelRehearsal, type LabelShow } from "@/lib/photoDays";
import { PHOTO_TYPES, PHOTOS_ONLY, photoType } from "@/lib/photos";

interface Folder { id: string; name: string; parentId: string; count: number }
interface Photos { folders: Folder[]; photos: GridPhoto[]; capped: boolean }

/** Posts › Photos is admins-only, like the rest of Posts. */
export default function PhotosPage() { return <AdminOnly><Suspense fallback={null}><PhotosTab /></Suspense></AdminOnly>; }

/**
 * Posts › Photos: the Socials inbox (every folder under Socials except Posts/), grouped by the day each photo was taken and
 * labelled with that day's shows and rehearsals. A rail picks a folder; photos are picked in order, and Add to carousel draft
 * makes a draft of them (or adds them to one). Opened from the editor's Add photos (`?draft=<id>`), the bar adds to that draft.
 */
function PhotosTab() {
  const artist = useArtist().doc;
  const setUp = !!artist?.postFoldersId;
  const [folder, setFolder] = useState<string | null>(null);
  const [data, setData] = useState<Photos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const shows = useCollection<LabelShow>("shows");
  const rehearsals = useCollection<LabelRehearsal>("rehearsals");
  const router = useRouter();
  const draftId = useSearchParams().get("draft");
  const [draft, setDraft] = useState<{ title?: string } | null>(null);
  const [dialog, setDialog] = useState(false);
  const add = useCommand();
  useEffect(() => {
    if (!draftId) { setDraft(null); return; }
    runCommand<{ drafts: { id: string; title?: string }[] }>("posts.list", {}).then((r) => setDraft(r.drafts.find((d) => d.id === draftId) ?? null), () => setDraft(null));
  }, [draftId]);
  const toEditor = (id: string) => router.push(`/posts/${id}`);
  async function addToOpenDraft() {
    if (!draftId) return;
    if (await add.call<{ count: number }>("posts.addToDraft", { id: draftId, driveFileIds: selected })) toEditor(draftId);
  }

  const load = useCallback(() => {
    setError(null);
    runCommand<Photos>("posts.photos", folder ? { folder } : {}).then(setData, (e: Error) => { setData(null); setError(e.message); });
  }, [folder]);
  useEffect(load, [load]);

  const days = useMemo(() => groupByDay(data?.photos ?? [], dayLabels(shows.rows ?? [], rehearsals.rows ?? [])), [data, shows.rows, rehearsals.rows]);
  const socialsId = artist?.postsFolderId as string | undefined;

  return (
    <div className="grid gap-5 pb-20">
      <PageTitle title="Social Media" />
      <PostsTabs at="photos" />
      <ErrorBox error={error} />
      {!data ? (!error && <p className="s" data-testid="photos-loading">Loading…</p>) : (
        <div className="grid gap-5 md:grid-cols-[14rem_1fr]">
          <FolderRail folders={data.folders} socialsId={socialsId} at={folder} onPick={(f) => { setFolder(f); setData(null); }} />
          <div className="grid content-start gap-4">
            <div className="flex flex-wrap items-start gap-3">
              <Upload<{ driveFileId: string }> url="/api/posts/upload" label="Upload" accept={[...PHOTO_TYPES, ".heic", ".heif"].join(",")} testid="photos-upload" disabled={!setUp}
                tooBig="Put it in the Socials folder in Drive instead."
                needsFolder={<Link href="/admin/google" className="underline">Set up the Socials folder in Settings › Google</Link>}
                check={(f) => (photoType(f.name, f.type) ? null : PHOTOS_ONLY)}
                onUploaded={load} />
            </div>
            {data.capped && <p className="s m-0" data-testid="photos-capped">Showing the 2,000 most recently added.</p>}
            {data.photos.length === 0
              ? <p className="s m-0" data-testid="photos-none">No photos here yet. Add them to the Socials folder in Drive, or upload one.</p>
              : <PhotoGrid days={days} selected={selected} onChange={setSelected} />}
          </div>
        </div>
      )}
      {selected.length > 0 && (
        <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-3 border-t border-line bg-surface px-4 py-3 shadow-lg" role="region" aria-label="Picked photos" data-testid="photos-bar">
          <b data-testid="photos-picked">{selected.length} picked</b>
          {!setUp && <span className="s" data-testid="photos-not-set-up"><Link href="/admin/google" className="underline">Set up the Socials folder in Settings › Google</Link></span>}
          {add.error && <span className="err" role="alert" data-testid="photos-add-error">{add.error}</span>}
          <button type="button" className="btn ghost sm ml-auto" onClick={() => setSelected([])} data-testid="photos-clear">Clear</button>
          {draftId ? (
            <button type="button" className="btn sm" disabled={!setUp || add.busy} onClick={() => void addToOpenDraft()} data-testid="photos-add">
              {add.busy ? "Moving…" : `Add to ${draft?.title ?? "the draft"}`}
            </button>
          ) : (
            <button type="button" className="btn sm" disabled={!setUp} onClick={() => setDialog(true)} data-testid="photos-add">Add to carousel draft</button>
          )}
        </div>
      )}
      <AddToDraftDialog open={dialog} onClose={() => setDialog(false)} driveFileIds={selected} onDone={(id) => { setDialog(false); toEditor(id); }} />
    </div>
  );
}

/**
 * Socials (everything), then its folders nested under their parents with how many photos each holds, and a link to Posts.
 * Long names wrap inside the rail (grid-cols-1 is minmax(0,1fr), so a name can't widen its column past the rail).
 */
function FolderRail({ folders, socialsId, at, onPick }: { folders: Folder[]; socialsId?: string; at: string | null; onPick(id: string | null): void }) {
  const kids = (parent: string) => folders.filter((f) => f.parentId === parent).sort((a, b) => a.name.localeCompare(b.name));
  const tops = folders.filter((f) => !folders.some((p) => p.id === f.parentId));
  const item = (id: string | null, label: string, count?: number) => (
    <button type="button" aria-current={at === id ? "true" : undefined} onClick={() => onPick(id)}
      className={`flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left ${at === id ? "bg-soft font-bold" : ""}`} data-testid={`photos-folder-${id ?? "all"}`}>
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{label}</span>
      {count !== undefined && <span className="s shrink-0">{count}</span>}
    </button>
  );
  const tree = (fs: Folder[]): React.ReactNode => fs.length > 0 && (
    <ul className="m-0 grid min-w-0 list-none grid-cols-1 gap-0.5 pl-3">
      {fs.map((f) => <li key={f.id}>{item(f.id, f.name, f.count)}{tree(kids(f.id))}</li>)}
    </ul>
  );
  return (
    <nav aria-label="Folders" className="grid min-w-0 grid-cols-1 content-start gap-1" data-testid="photos-rail">
      {item(null, "Socials")}
      {tree(socialsId ? kids(socialsId) : tops)}
      <Link href="/posts" className="s px-2 py-1.5 underline" data-testid="photos-rail-posts">Posts ›</Link>
    </nav>
  );
}
