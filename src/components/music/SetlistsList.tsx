"use client";
import { useRef } from "react";
import { draftPath } from "@/schema/drafts";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { ErrorBox, useCommand } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { fmtDur } from "@/lib/shows";
import { DEFAULT_TRANSITION_SEC, setlistTotal } from "@/lib/music";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { useMusic } from "./common";

/** New setlist template: the name is a draft (device + server) until "Create". */
function NewSetlist() {
  const router = useRouter();
  const { call, error, busy } = useCommand();
  const draft = useDraft(draftPath.newIn("setlistTemplates"), { name: "" }, { route: "/setlists", title: (v) => `New setlist template${v.name.trim() ? ` · ${v.name.trim()}` : ""}` });
  const mutationId = useRef(newMutationId());
  const name = draft.value.name;
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await draft.settle();
    const r = await call("setlistTemplates.create", { name: name.trim() }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (r?.id) { await draft.clear(); router.push(`/setlists/${r.id}`); }
  }
  return (
    <form className="grid gap-1" onSubmit={create}>
      <div className="flex gap-2">
        <input className="input" placeholder="New template name…" value={name} disabled={!draft.ready} onChange={(e) => draft.setValue({ name: e.target.value })} data-testid="new-setlist-name" aria-label="New template name" />
        <button className="btn acc" disabled={busy || !draft.ready} data-testid="new-setlist">Create</button>
      </div>
      <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
      <ErrorBox error={error} />
    </form>
  );
}

/** The Setlist Templates page body: every template with its song count and running time, plus (admins) a create form. */
export function SetlistsList() {
  const admin = useProfile().role === "admin";
  const m = useMusic();
  return (
    <div className="grid gap-2" data-testid="setlists-list">
      {admin && <NewSetlist />}
      {!m.loading && m.templates.length === 0 && <div className="empty"><span>No setlist templates yet.</span></div>}
      {[...m.templates].sort((a, b) => a.name.localeCompare(b.name)).map((s) => (
        <Link key={s.id} href={`/setlists/${s.id}`} className="card" data-testid={`setlist-${s.id}`}>
          <div className="flex items-center justify-between"><b>{s.name}</b><span className="s font-semibold">Open ›</span></div>
          <span className="s">{s.items.filter((i) => i.type === "song").length} songs · {fmtDur(setlistTotal(s.items, DEFAULT_TRANSITION_SEC))}</span>
        </Link>
      ))}
    </div>
  );
}
