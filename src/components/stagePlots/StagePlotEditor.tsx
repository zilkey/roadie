"use client";
import { BackLink } from "@/components/BackLink";
import { useEffect, useMemo, useState } from "react";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import type { Musician, StagePlot } from "@/schema";
import type { PlotShape } from "@/schema/stagePlots";
import { ErrorBox, PageTitle, Select } from "@/components/ui";
import { SaveStatus } from "@/components/SaveStatus";
import { useCollection, useDoc, type Row } from "@/lib/firestore-hooks";
import { useProfile } from "@/lib/auth";
import { MAX_INPUTS, MAX_MIXES, STAGE_PRESETS, dropsWork, unplaced, type Move } from "@/lib/stagePlots/plot";
import { downloadPlotPdf } from "@/lib/stagePlots/pdfClient";
import { StageBoard } from "./StageBoard";
import { ChannelList, MixList, type Who } from "./ChannelPanels";
import { useStagePlotSaver } from "./useStagePlotSaver";
import { useRowEdits } from "./useRowEdits";

export function StagePlotEditor({ id }: { id: string }) {
  const { doc, loading } = useDoc<StagePlot>("stagePlots", id);
  if (loading) return <div className="s">Loading…</div>;
  if (!doc) return <div className="card" data-testid="not-found">That stage plot isn&apos;t here any more. <Link href="/stage-plots" className="font-bold">Back to Stage plots</Link></div>;
  return <Editor plot={doc} />;
}

/** A count with − and +: Inputs and Mixes. Typing a number commits on blur or Enter. */
function Counter({ label, value, max, busy, onSet, testid }: { label: string; value: number; max: number; busy: boolean; onSet(n: number): void; testid: string }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => { const n = Number(text); setText(null); if (text !== null && Number.isInteger(n) && n >= 0 && n <= max && n !== value) onSet(n); };
  return (
    <div className="flex items-center gap-2">
      <span className="font-semibold">{label}:</span>
      <button type="button" className="btn outline sm" disabled={busy || value <= 0} onClick={() => onSet(value - 1)} aria-label={`Fewer ${label.toLowerCase()}`} data-testid={`${testid}-minus`}>−</button>
      <input className="input w-16 text-center" type="number" min={0} max={max} inputMode="numeric" aria-label={`${label} count`} data-testid={`${testid}-count`}
        value={text ?? String(value)} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      <button type="button" className="btn outline sm" disabled={busy || value >= max} onClick={() => onSet(value + 1)} aria-label={`More ${label.toLowerCase()}`} data-testid={`${testid}-plus`}>+</button>
    </div>
  );
}

function Editor({ plot }: { plot: Row<StagePlot> }) {
  const admin = useProfile().role === "admin";
  const router = useRouter();
  const configurations = useArtist().doc?.configurations ?? [];
  const musicians = useCollection<Musician>("musicians").rows ?? [];

  const server = useMemo<PlotShape>(() => ({ stage: plot.stage, inputs: plot.inputs ?? [], items: plot.items ?? [], monitors: plot.monitors ?? [] }), [plot]);
  const saver = useStagePlotSaver(plot.id, plot.rev ?? 0, server);
  const view = saver.view;
  const rows = useRowEdits(plot, saver.send);

  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [armedRaw, setArmed] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const waiting = unplaced(view);
  const armed = armedRaw && [...waiting.inputs.map((r) => r.input.id), ...waiting.mixes.map((r) => r.monitor.id)].includes(armedRaw) ? armedRaw : null;
  const highlight = [hover, selected, armed].filter((x): x is string => !!x);

  const lineup = configurations.find((c) => c.id === plot.configurationId);
  const who: Who = useMemo(() => {
    const pool = musicians.filter((m) => (lineup ? lineup.musicianIds.includes(m.id) : m.active && !m.archivedAt));
    const used = new Set([...view.inputs.map((i) => i.musicianId), ...view.monitors.map((m) => m.musicianId)]);
    const extra = musicians.filter((m) => used.has(m.id) && !pool.some((p) => p.id === m.id));
    return [...pool, ...extra].map((m) => [m.id, m.name] as const);
  }, [musicians, lineup, view]);

  const setInputs = (n: number) => {
    const lost = dropsWork(view, n);
    if (lost.length && !confirm(`Lowering to ${n} removes ${lost.length === 1 ? "an input" : `${lost.length} inputs`} that ${lost.length === 1 ? "is" : "are"} placed or filled in. Remove?`)) return;
    void saver.send("stagePlots.setInputCount", { count: n });
  };
  const setMixes = (n: number) => {
    const lost = view.monitors.slice(n).filter((m) => m.x !== undefined || m.musicianId || m.wants);
    if (lost.length && !confirm(`Lowering to ${n} removes ${lost.length === 1 ? "a mix" : `${lost.length} mixes`} that ${lost.length === 1 ? "is" : "are"} placed or filled in. Remove?`)) return;
    void saver.send("stagePlots.setMixCount", { count: n });
  };
  const stageKey = `${plot.stage.widthFt}x${plot.stage.depthFt}`;
  const sizes = STAGE_PRESETS.map((p) => `${p.widthFt}x${p.depthFt}`);
  const sizeOptions = [...(sizes.includes(stageKey) ? [] : [[stageKey, `${plot.stage.widthFt} × ${plot.stage.depthFt} ft`] as const]), ...STAGE_PRESETS.map((p) => [`${p.widthFt}x${p.depthFt}`, `${p.widthFt} × ${p.depthFt} ft`] as const)];

  const ctl = {
    admin, who, selected, armed, onHover: setHover,
    onNumber: (rid: string, placed: boolean) => { if (placed) setSelected(rid); else setArmed(armed === rid ? null : rid); },
  };
  const onMove = (moves: Move[]) => { void saver.commitMoves(moves); };

  async function done() { rows.flush(); await saver.settle(); router.push("/stage-plots"); }
  async function pdf() { setPdfError(null); try { await downloadPlotPdf(plot.id); } catch (e) { setPdfError((e as Error).message); } }

  // The page title follows the saved name.
  const name = rows.edits.t.name ?? plot.name;
  useEffect(() => { if (!admin) setSelected(null); }, [admin]);

  return (
    <div className="grid gap-5" data-testid="stage-plot-page">
      <PageTitle
        back={<BackLink href="/stage-plots" label="All stage plots" />}
        title={plot.name}
        sub={`${lineup?.name ?? "Any lineup"} · v${plot.version}`}
        actions={<>
          <button type="button" className="btn outline" onClick={pdf} data-testid="plot-pdf">Download PDF</button>
          {admin ? <button type="button" className="btn acc" onClick={done} data-testid="plot-done">Done</button> : <Link href="/stage-plots" className="btn acc" data-testid="plot-done">Done</Link>}
        </>} />
      {pdfError && <div className="err" role="alert">{pdfError}</div>}

      {admin && (
        <div className="card">
          <div className="flex flex-wrap items-center gap-2">
            <input className="input min-w-48 flex-1" aria-label="Plot name" data-testid="plot-name" value={name}
              onChange={(e) => rows.editText({ name: e.target.value })} onBlur={() => { if (!name.trim()) rows.revertText("name"); else rows.flush(); }} />
            {configurations.length > 0 && <div className="w-56"><Select value={plot.configurationId ?? ""} options={configurations.map((c) => [c.id, c.name] as const)} placeholder="Any lineup" testid="plot-lineup" label="Lineup"
              onChange={(v) => void saver.send("stagePlots.rename", { configurationId: v || null })} /></div>}
            <SaveStatus status={saver.status} error={saver.error} />
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Counter label="Inputs" value={view.inputs.length} max={MAX_INPUTS} busy={saver.busy} onSet={setInputs} testid="inputs" />
            <Counter label="Mixes" value={view.monitors.length} max={MAX_MIXES} busy={saver.busy} onSet={setMixes} testid="mixes" />
            <label className="flex items-center gap-2"><span className="font-semibold">Stage:</span>
              <div className="w-36"><Select value={stageKey} options={sizeOptions} testid="plot-stage-size" label="Stage size"
                onChange={(v) => { const [w, d] = v.split("x").map(Number); void saver.send("stagePlots.setStage", { widthFt: w, depthFt: d }); }} /></div></label>
          </div>
        </div>
      )}

      <StageBoard plot={view} admin={admin} highlight={highlight} armed={armed} onArm={setArmed} onSelect={setSelected}
        onMove={onMove}
        onAddItems={(items) => void saver.send("stagePlots.addItems", { items })}
        onRemoveItems={(ids) => void saver.send("stagePlots.removeItems", { ids })} />

      <section className="grid gap-2"><h2 className="text-lg font-bold">Channel list</h2>
        <ChannelList inputs={view.inputs} edits={rows.edits.i} onEdit={rows.editInput} onReorder={(o) => void saver.commitOrder(o)} ctl={ctl} /></section>
      <section className="grid gap-2"><h2 className="text-lg font-bold">Monitor mixes</h2>
        <MixList monitors={view.monitors} edits={rows.edits.m} onEdit={rows.editMix} ctl={ctl} /></section>

      <section className="grid gap-3 md:grid-cols-2">
        {(["bring", "need"] as const).map((k) => (
          <label key={k} className="grid gap-1"><span className="text-lg font-bold">{k === "bring" ? "We bring" : "We need"}</span>
            {admin
              ? <textarea className="input min-h-24" data-testid={`plot-${k}`} value={rows.edits.t[k] ?? plot[k] ?? ""} placeholder={k === "bring" ? "Our own kick mic, in-ear packs…" : "Four monitor wedges, a drum riser…"}
                  onChange={(e) => rows.editText({ [k]: e.target.value })} onBlur={() => rows.flush()} />
              : <p className="whitespace-pre-wrap" data-testid={`plot-${k}`}>{plot[k] || <span className="s">Nothing listed.</span>}</p>}
          </label>
        ))}
      </section>
      <ErrorBox error={saver.status === "error" ? saver.error : null} />
    </div>
  );
}
