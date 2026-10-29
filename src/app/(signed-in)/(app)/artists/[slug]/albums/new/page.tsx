"use client";
import { BackLink } from "@/components/BackLink";
import { draftPath } from "@/schema/drafts";
import { Suspense, useRef } from "react";
import { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { useCollection } from "@/lib/firestore-hooks";
import { parseDollars } from "@/lib/money";
import { ALBUM_KINDS, ALBUM_KIND_LABEL, ALBUM_STATUSES, ALBUM_STATUS_LABEL } from "@/lib/albums";
import type { AlbumKind, AlbumStatus, SetlistTemplate } from "@/schema";

export default function NewAlbum() { return <AdminOnly><Suspense fallback={null}><Form /></Suspense></AdminOnly>; }

type Start = "setlist" | "songs" | "empty";

function Form() {
  const router = useRouter();
  const { call, error, busy, setError } = useCommand();
  const artistDoc = useArtist().doc;
  const hasBandFolder = !!artistDoc?.driveFolderId;
  const templates = (useCollection<SetlistTemplate>("setlistTemplates").rows ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  // New record = draft: typed values persist on this device and the server; "Create album" makes it, Cancel throws it away.
  // `start` and `setlistId` stay "" until picked, so the defaults follow the band's setlists as they load.
  const draft = useDraft(draftPath.newIn("albums"),
    { title: "", kind: "album" as AlbumKind, status: "planning" as AlbumStatus, releaseDate: "", budget: "", start: "" as Start | "", setlistId: "", makeFolder: true },
    { title: (v) => `New album${v.title.trim() ? ` · ${v.title.trim()}` : ""}` });
  const v = draft.value;
  const set = (p: Partial<typeof v>) => draft.setValue({ ...v, ...p });
  const start: Start = v.start === "setlist" && !templates.length ? "songs" : v.start || (templates.length ? "setlist" : "songs");
  const setlistId = templates.some((t) => t.id === v.setlistId) ? v.setlistId : templates[0]?.id ?? "";
  const mutationId = useRef(newMutationId());
  const off = !draft.ready;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const budget = v.budget.trim() ? parseDollars(v.budget) : undefined;
    if (budget === null) { setError("Budget looks like $6,000"); return; }
    await draft.settle();
    const r = await call<{ id: string }>("albums.create", {
      title: v.title.trim(), kind: v.kind, status: v.status,
      ...(v.releaseDate ? { releaseDate: v.releaseDate } : {}), ...(budget !== undefined ? { budget } : {}),
      ...(start === "setlist" && setlistId ? { setlistId } : {}), makeFolder: hasBandFolder && v.makeFolder,
    }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (r?.id) { await draft.clear(); router.replace(`/albums/${r.id}`); }
  }
  async function cancel() { await draft.clear({ reset: true }); router.push("/albums"); }

  return (
    <form className="grid gap-5" onSubmit={save} data-testid="new-album">
      <PageTitle back={<BackLink href="/albums" label="All albums" />} title="New album" />
      <div className="card grid max-w-xl gap-4">
        <label className="grid gap-1"><span className="lbl">Title</span>
          <input className="input" value={v.title} placeholder="Working title is fine" onChange={(e) => set({ title: e.target.value })} required disabled={off} data-testid="album-title" />
        </label>
        <fieldset className="grid gap-1">
          <legend className="lbl mb-1">Kind</legend>
          <div role="radiogroup" className="flex flex-wrap gap-4">
            {ALBUM_KINDS.map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="radio" name="kind" checked={v.kind === k} onChange={() => set({ kind: k })} disabled={off} data-testid={`album-kind-${k}`} />{ALBUM_KIND_LABEL[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1"><span className="lbl">Status</span>
            <select className="select" value={v.status} onChange={(e) => set({ status: e.target.value as AlbumStatus })} disabled={off} data-testid="album-status">
              {ALBUM_STATUSES.map((s) => <option key={s} value={s}>{ALBUM_STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="grid gap-1"><span className="lbl">Target release <span className="s font-normal normal-case">optional</span></span>
            <input className="input" type="date" value={v.releaseDate} onChange={(e) => set({ releaseDate: e.target.value })} disabled={off} data-testid="album-release" />
          </label>
        </div>
        <label className="grid gap-1"><span className="lbl">Budget <span className="s font-normal normal-case">optional · only admins see money</span></span>
          <input className="input" inputMode="decimal" placeholder="$" value={v.budget} onChange={(e) => set({ budget: e.target.value })} disabled={off} data-testid="album-budget" />
        </label>
        <fieldset className="grid gap-2">
          <legend className="lbl mb-1">Start the tracklist</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="start" className="mt-1" checked={start === "setlist"} onChange={() => set({ start: "setlist" })} disabled={off || !templates.length} data-testid="start-setlist" />
            <span><b>From a setlist</b><br /><span className="s">{templates.length ? "Its songs and order become the tracks" : "The band has no setlists yet"}</span></span>
          </label>
          {start === "setlist" && templates.length > 0 && (
            <label className="ml-6 grid gap-1"><span className="lbl">Setlist</span>
              <select className="select" value={setlistId} onChange={(e) => set({ setlistId: e.target.value })} disabled={off} data-testid="start-setlist-select">
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-start gap-2">
            <input type="radio" name="start" className="mt-1" checked={start === "songs"} onChange={() => set({ start: "songs" })} disabled={off} data-testid="start-songs" />
            <span><b>Pick songs</b><br /><span className="s">Choose from Songs after saving</span></span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="start" className="mt-1" checked={start === "empty"} onChange={() => set({ start: "empty" })} disabled={off} data-testid="start-empty" />
            <span><b>Empty</b></span>
          </label>
        </fieldset>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={hasBandFolder && v.makeFolder} onChange={(e) => set({ makeFolder: e.target.checked })} disabled={off || !hasBandFolder} data-testid="album-make-folder" />
          <span>Make an album folder in the band&apos;s Drive folder<br />
            <span className="s">{hasBandFolder ? `Band folder / Albums / ${v.title.trim() || "[title]"}` : "Choose the band folder in Settings › Google first"}</span>
          </span>
        </label>
        <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn outline" onClick={cancel} data-testid="cancel-album">Cancel</button>
          <button className="btn acc" disabled={busy || off || !v.title.trim()} data-testid="create-album">Create album</button>
        </div>
        <ErrorBox error={error} />
      </div>
    </form>
  );
}
