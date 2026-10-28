"use client";
import { draftPath } from "@/schema/drafts";
import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { DrivePicker, type Pick } from "@/components/music/DrivePicker";
import { parseLen } from "@/lib/music";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";

export default function NewSong() { return <AdminOnly><Suspense fallback={<div className="s">Loading…</div>}><Form /></Suspense></AdminOnly>; }

function Form() {
  const router = useRouter();
  // "Add a song" on the Writing tab links here with ?status=writing: the song starts in the Writing phase.
  const writing = useSearchParams().get("status") === "writing";
  const { call, error, busy, setError } = useCommand();
  // New record = draft: typed values persist on this device and the server; "Add song" creates it. Drive picks come
  // from a live search, so they are re-picked after a restore (the title restores and re-runs the search).
  const draft = useDraft(draftPath.newIn("songs"), { title: "", key: "", len: "" }, { title: (v) => `New song${v.title.trim() ? ` · ${v.title.trim()}` : ""}` });
  const { title, key, len } = draft.value;
  const set = (p: Partial<typeof draft.value>) => draft.setValue({ ...draft.value, ...p });
  const [picks, setPicks] = useState<Pick[]>([]);
  const mutationId = useRef(newMutationId());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const lengthSec = parseLen(len);
    if (len.trim() && lengthSec === undefined) { setError("Length looks like 3:52"); return; }
    await draft.settle();
    const r = await call("songs.create", {
      title: title.trim(), status: writing ? "writing" : "active", ...(key.trim() ? { key: key.trim() } : {}), ...(lengthSec !== undefined ? { lengthSec } : {}), files: picks,
    }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (r?.id) { await draft.clear(); router.replace(`/songs/${r.id}`); }
  }

  return (
    <form className="grid gap-5" onSubmit={save} data-testid="add-song">
      <PageTitle back={<Link href={writing ? "/songs?seg=writing" : "/songs"} className="back-link" data-testid="back">← All songs</Link>} title="Add a song" sub="Type the title and the app searches Drive for audio, video and docs." />
      <div className="card">
      <label className="grid gap-1"><span className="lbl">Title</span>
        <input className="input" value={title} onChange={(e) => set({ title: e.target.value })} required disabled={!draft.ready} data-testid="song-title" />
      </label>
      <DrivePicker syncWith={title} onChange={setPicks} />
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1"><span className="lbl">Key</span><input className="input" value={key} onChange={(e) => set({ key: e.target.value })} disabled={!draft.ready} data-testid="song-key" /></label>
        <label className="grid gap-1"><span className="lbl">Length</span><input className="input" placeholder="3:52" value={len} onChange={(e) => set({ len: e.target.value })} disabled={!draft.ready} data-testid="song-length" /></label>
      </div>
      <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
      <button className="btn acc" disabled={busy || !draft.ready || !title.trim()} data-testid="save-song">Add song{picks.length ? ` with ${picks.length} file${picks.length === 1 ? "" : "s"}` : ""}</button>
      <ErrorBox error={error} />
      </div>
    </form>
  );
}
