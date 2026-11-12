"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { draftPath } from "@/schema/drafts";
import type { StagePlot } from "@/schema";
import { ErrorBox, PageTitle, Select, useCommand } from "@/components/ui";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useCollection } from "@/lib/firestore-hooks";
import { useDraft, useHasDraft } from "@/lib/drafts";
import { useProfile } from "@/lib/auth";
import { newMutationId } from "@/lib/commands";
import { summary } from "@/lib/stagePlots/plot";

const NEW_PATH = draftPath.newIn("stagePlots");
const blank = { name: "", configurationId: "", inputs: "8", copyFrom: "" };

/** Explicit Add: nothing is created until "Add" is pressed. The form's contents are a draft; Cancel discards it. */
function NewPlot({ plots, onClose }: { plots: (StagePlot & { id: string })[]; onClose(): void }) {
  const router = useRouter();
  const lineups = useArtist().doc?.configurations ?? [];
  const { call, error, busy } = useCommand();
  const draft = useDraft(NEW_PATH, blank, { route: "/stage-plots", title: (v) => `New stage plot${v.name.trim() ? ` · ${v.name.trim()}` : ""}` });
  const mutationId = useRef(newMutationId());
  const v = draft.value;
  const set = (p: Partial<typeof blank>) => draft.setValue({ ...v, ...p });
  const n = Number(v.inputs);
  const okCount = Number.isInteger(n) && n >= 0 && n <= 64;
  const copying = !!v.copyFrom && plots.some((p) => p.id === v.copyFrom);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!v.name.trim() || (!copying && !okCount)) return;
    await draft.settle();
    const r = await call("stagePlots.create", {
      name: v.name.trim(),
      ...(v.configurationId ? { configurationId: v.configurationId } : {}),
      ...(copying ? { copyFrom: v.copyFrom } : { inputs: n }),
    }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (r?.id) { await draft.clear(); router.push(`/stage-plots/${r.id}`); }
  }
  async function cancel() { await draft.clear({ reset: true }); onClose(); }

  return (
    <form className="card" onSubmit={add} data-testid="new-plot-form">
      <h2>New stage plot</h2>
      <label className="grid gap-1"><span className="s">Name</span>
        <input className="input" placeholder="Full band" value={v.name} disabled={!draft.ready} onChange={(e) => set({ name: e.target.value })} data-testid="new-plot-name" aria-label="Plot name" /></label>
      {lineups.length > 0 && (
        <label className="grid gap-1"><span className="s">Lineup (optional)</span>
          <Select value={v.configurationId} options={lineups.map((c) => [c.id, c.name] as const)} placeholder="Any lineup" onChange={(x) => set({ configurationId: x })} testid="new-plot-lineup" label="Lineup" /></label>
      )}
      {plots.length > 0 && (
        <label className="grid gap-1"><span className="s">Copy from…</span>
          <Select value={v.copyFrom} options={[...plots].sort((a, b) => a.name.localeCompare(b.name)).map((p) => [p.id, p.name] as const)} placeholder="Start from scratch" onChange={(x) => set({ copyFrom: x })} testid="new-plot-copy" label="Copy from" /></label>
      )}
      {!copying && (
        <label className="grid gap-1"><span className="s">How many inputs?</span>
          <input className="input" type="number" min={0} max={64} inputMode="numeric" value={v.inputs} onChange={(e) => set({ inputs: e.target.value })} data-testid="new-plot-inputs" aria-label="How many inputs?" /></label>
      )}
      <div className="flex gap-2">
        <button className="btn acc" disabled={busy || !draft.ready || !v.name.trim() || (!copying && !okCount)} data-testid="new-plot-add">Create</button>
        <button type="button" className="btn ghost" onClick={cancel} data-testid="new-plot-cancel">Cancel</button>
      </div>
      <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
      <ErrorBox error={error} />
    </form>
  );
}

/** The Stage plots page: title with the lineup filter beside it, (admins) an explicit Add top right, then the plots. */
export function StagePlotsList() {
  const admin = useProfile().role === "admin";
  const lineups = useArtist().doc?.configurations ?? [];
  const col = useCollection<StagePlot>("stagePlots");
  const [lineup, setLineup] = useState("");
  const [adding, setAdding] = useState(false);
  const hasDraft = useHasDraft(NEW_PATH);
  useEffect(() => { if (hasDraft) setAdding(true); }, [hasDraft]);
  const rows = useMemo(() => [...(col.rows ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [col.rows]);
  const shown = rows.filter((p) => !lineup || (lineup === "none" ? !p.configurationId : p.configurationId === lineup));
  const lineupName = (id?: string | null) => lineups.find((c) => c.id === id)?.name;

  return (
    <div className="grid gap-3" data-testid="stage-plots-list">
      <PageTitle
        title="Stage plots"
        center
        pill={lineups.length > 0 && rows.length > 0 && (
          <div className="w-56"><Select value={lineup} options={[...lineups.map((c) => [c.id, c.name] as const), ["none", "No lineup"] as const]} placeholder="All lineups" onChange={setLineup} testid="plot-filter" label="Filter by lineup" /></div>
        )}
        actions={admin && !adding && <button type="button" className="btn acc" onClick={() => setAdding(true)} data-testid="add-plot">+ New stage plot</button>}
      />
      {admin && adding && <NewPlot plots={rows} onClose={() => setAdding(false)} />}
      {!col.loading && rows.length === 0 && <div className="empty"><span>No stage plots yet.</span></div>}
      {!col.loading && rows.length > 0 && shown.length === 0 && <div className="empty"><span>No stage plots for that lineup.</span></div>}
      {shown.map((p) => (
        <Link key={p.id} href={`/stage-plots/${p.id}`} className="card" data-testid={`plot-${p.id}`}>
          <div className="flex items-center justify-between gap-2"><b>{p.name}</b><span className="s font-semibold">Open ›</span></div>
          <span className="s">{lineupName(p.configurationId) ?? "Any lineup"} · v{p.version} · {summary({ inputs: p.inputs ?? [], items: p.items ?? [], monitors: p.monitors ?? [] }).text}</span>
        </Link>
      ))}
    </div>
  );
}
