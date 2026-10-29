"use client";
import { BackLink } from "@/components/BackLink";
import { draftPath } from "@/schema/drafts";
import { Suspense, useRef } from "react";
import { useArtistRouter as useRouter } from "@/lib/artist";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { RELEASE_KINDS, RELEASE_KIND_LABEL } from "@/lib/releases";
import { FolderPicker, type PickedFolder } from "@/components/google/FolderPicker";
import type { ReleaseKind } from "@/schema";

export default function NewRelease() { return <AdminOnly><Suspense fallback={null}><Form /></Suspense></AdminOnly>; }

function Form() {
  const router = useRouter();
  const { call, error, busy } = useCommand();
  // New record = draft: typed values persist on this device and the server; "Create release" makes it, Cancel throws it away.
  // The tracklist always comes after: the release page's "+ Add tracks" takes a setlist or picked songs.
  const draft = useDraft(draftPath.newIn("releases"),
    { title: "", kind: "album" as ReleaseKind, releaseDate: "", folder: null as PickedFolder | null },
    { title: (v) => `New release${v.title.trim() ? ` · ${v.title.trim()}` : ""}` });
  const v = draft.value;
  const set = (p: Partial<typeof v>) => draft.setValue({ ...v, ...p });
  const mutationId = useRef(newMutationId());
  const off = !draft.ready;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await draft.settle();
    const r = await call<{ id: string }>("releases.create", {
      title: v.title.trim(), kind: v.kind, ...(v.releaseDate ? { releaseDate: v.releaseDate } : {}), ...(v.folder ? { driveFolderId: v.folder.id } : {}),
    }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (r?.id) { await draft.clear(); router.replace(`/releases/${r.id}`); }
  }
  async function cancel() { await draft.clear({ reset: true }); router.push("/releases"); }

  return (
    <form className="grid gap-5" onSubmit={save} data-testid="new-release">
      <PageTitle back={<BackLink href="/releases" label="All releases" />} title="New release" />
      <div className="card grid max-w-xl gap-4">
        <label className="grid gap-1"><span className="lbl">Title</span>
          <input className="input" value={v.title} placeholder="Working title is fine" onChange={(e) => set({ title: e.target.value })} required disabled={off} data-testid="release-title" />
        </label>
        <fieldset className="grid gap-1">
          <legend className="lbl mb-1">Kind</legend>
          <div role="radiogroup" className="flex flex-wrap gap-4">
            {RELEASE_KINDS.map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="radio" name="kind" checked={v.kind === k} onChange={() => set({ kind: k })} disabled={off} data-testid={`release-kind-${k}`} />{RELEASE_KIND_LABEL[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="grid gap-1"><span className="lbl">Target release <span className="s font-normal normal-case">optional</span></span>
          <input className="input" type="date" value={v.releaseDate} onChange={(e) => set({ releaseDate: e.target.value })} disabled={off} data-testid="release-release" />
        </label>
        <div className="grid gap-1">
          <span className="lbl">Release folder <span className="s font-normal normal-case">optional · anywhere in Drive</span></span>
          <span className="s">Mixes, masters, artwork and uploads for this release go here. Without one, the release page can make Band folder / Releases / {v.title.trim() || "[title]"} later.</span>
          <FolderPicker value={v.folder} onChange={(folder) => set({ folder })} disabled={off} testid="release-folder" />
        </div>
        <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn outline" onClick={cancel} data-testid="cancel-release">Cancel</button>
          <button className="btn acc" disabled={busy || off || !v.title.trim()} data-testid="create-release">Create release</button>
        </div>
        <ErrorBox error={error} />
      </div>
    </form>
  );
}
