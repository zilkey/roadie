"use client";
import { useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { StagePlotSvg } from "@/components/stagePlots/StagePlotSvg";
import { useArtist } from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import { downloadPlotPdf, sharePlotPdf } from "@/lib/stagePlots/pdfClient";
import { runCommand } from "@/lib/commands";
import type { StagePlot } from "@/schema";
import type { ShowRow } from "../common";
import { ShowCard } from "./kit";

/**
 * Stage plot: the plot this show uses, picked by hand (never a lineup default). Admins pick, change and clear it and switch the engineer
 * link; everyone downloads or shares the PDF and copies the engineer link. Members see nothing until a plot is picked.
 */
export function StagePlotCard({ show, admin }: { show: ShowRow; admin: boolean }) {
  const { artistId } = useArtist();
  const { rows } = useCollection<StagePlot>("stagePlots", { where: [["artistId", "==", artistId]] });
  const { call, error, busy, setError } = useCommand();
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const plot = show.stagePlotId ? rows?.find((p) => p.id === show.stagePlotId) : undefined;

  if (rows === null) return null;
  if (!show.stagePlotId && !admin) return null;
  if (show.stagePlotId && !plot && !admin) return null;

  const pick = async (id: string) => { if (id && (await call("shows.setStagePlot", { showId: show.id, stagePlotId: id }))) setChanging(false); };
  const sorted = [...rows].sort((a, b) => Number(b.configurationId === show.billedAs) - Number(a.configurationId === show.billedAs) || a.name.localeCompare(b.name));
  const mine = show.billedAs ? sorted.filter((p) => p.configurationId === show.billedAs) : [];
  const others = sorted.filter((p) => !mine.includes(p));
  const opt = (p: Row) => <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>;
  type Row = (typeof sorted)[number];
  const picker = (
    <select className="select" value="" disabled={busy} aria-label="Stage plot" data-testid="plot-pick" onChange={(e) => void pick(e.target.value)}>
      <option value="">{rows.length ? "Choose a stage plot…" : "No stage plots yet"}</option>
      {mine.length > 0 && <optgroup label="This lineup">{mine.map(opt)}</optgroup>}
      {others.length > 0 && <optgroup label={mine.length ? "Other plots" : "Stage plots"}>{others.map(opt)}</optgroup>}
    </select>
  );

  async function guard(fn: () => Promise<unknown>) {
    setError(null); setNote(null);
    try { await fn(); } catch (e) { setError((e as Error).message); }
  }
  async function copyLink() {
    const r = await runCommand<{ on: boolean; url: string | null }>("stagePlots.engineerLink", { id: plot!.id });
    if (!r.url) throw new Error("The engineer link is off");
    await navigator.clipboard.writeText(r.url);
    setNote("Link copied");
  }

  if (!plot) {
    return (
      <ShowCard title="Stage plot" testid="stage-plot">
        {show.stagePlotId ? <p className="s m-0">The picked stage plot was archived.</p> : <p className="s m-0">Pick a stage plot</p>}
        {picker}
        <ErrorBox error={error} />
      </ShowCard>
    );
  }
  const on = !!plot.share?.on;
  return (
    <ShowCard title="Stage plot" testid="stage-plot">
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-40 shrink-0 overflow-hidden rounded-lg border border-[var(--border)]" data-testid="plot-thumb">
          <StagePlotSvg plot={plot} />
        </div>
        <div className="grid min-w-0 flex-1 content-start gap-2">
          <div className="flex flex-wrap items-baseline gap-2"><strong data-testid="plot-name">{plot.name}</strong><span className="s" data-testid="plot-version">v{plot.version}</span></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn outline" disabled={busy} data-testid="plot-download" onClick={() => void guard(() => downloadPlotPdf(plot.id))}>Download PDF</button>
            <button type="button" className="btn outline" disabled={busy} data-testid="plot-share" onClick={() => void guard(async () => { if ((await sharePlotPdf(plot.id)) === "downloaded") setNote("Downloaded the PDF"); })}>Share PDF</button>
            {on && <button type="button" className="btn outline" data-testid="plot-copy-link" onClick={() => void guard(copyLink)}>Copy engineer link</button>}
            {admin && !on && <button type="button" className="btn outline" disabled={busy} data-testid="plot-link-on" onClick={() => void call("stagePlots.shareLink", { id: plot.id })}>Turn on engineer link</button>}
            {admin && on && <button type="button" className="btn ghost" disabled={busy} data-testid="plot-link-off" onClick={() => void call("stagePlots.shareOff", { id: plot.id })}>Turn off</button>}
          </div>
          {note && <span className="s" role="status" data-testid="plot-note">{note}</span>}
          {admin && (changing
            ? <div className="flex flex-wrap items-center gap-2">{picker}<button type="button" className="btn ghost" onClick={() => setChanging(false)}>Cancel</button></div>
            : <div className="flex gap-2">
                <button type="button" className="btn ghost" disabled={busy} data-testid="plot-change" onClick={() => setChanging(true)}>Change</button>
                <button type="button" className="btn ghost" disabled={busy} data-testid="plot-clear" onClick={() => void call("shows.setStagePlot", { showId: show.id, stagePlotId: null })}>Clear</button>
              </div>)}
        </div>
      </div>
      <ErrorBox error={error} />
    </ShowCard>
  );
}
