"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CloseIcon } from "@/components/Sheet";
import { Select } from "@/components/ui";
import { useArtistRouter, useHref } from "@/lib/artist";
import { runCommand } from "@/lib/commands";
import { FIELD_BREAKS, FIELD_KEY, FIELD_LENGTH, PAPER, defaultPrintOptions, printPath, pxToPt, songFieldId } from "@/lib/print";
import type { PrintOptions, PrintPaper } from "@/schema/print";
import { PrintSheets } from "./PrintSheets";
import { usePrintSheets } from "./usePrintSheets";

/** The printer from the wireframe; sits before the label on every Print button. */
export const PrintIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2" /><rect x="6" y="14" width="12" height="7" /></svg>;

type Fit = { px: number; overflow: boolean; sheetCount: number };

/** Same breakpoint the Roadie panel uses for "desktop". */
const useDesktop = () =>
  useSyncExternalStore(
    (cb) => { const m = window.matchMedia("(min-width: 900px)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia("(min-width: 900px)").matches,
    () => true,
  );

/** Preview width of one sheet in the dialog: wider when it is the only one. */
const PREVIEW_W = { one: 260, perSet: 190 };

/**
 * The Print dialog for a setlist (a template id or a show id): options on the left, a live preview of the real sheets on the
 * right. On a phone it is a bottom sheet with a summary line instead of the preview. Render it only while open: it loads the
 * person's saved options on mount. Print saves the options, opens the print route (a new tab on desktop, in place on a phone)
 * and closes.
 */
export function PrintDialog({ setlistId, onClose }: { setlistId: string; onClose: () => void }) {
  const desktop = useDesktop();
  const href = useHref();
  const router = useArtistRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [saved, setSaved] = useState<PrintOptions | null | undefined>(undefined); // undefined = still loading
  const [opts, setOpts] = useState<PrintOptions | null>(null);
  const [fit, setFit] = useState<Fit | null>(null);
  const onFit = useCallback((r: Fit) => setFit((p) => (p && p.px === r.px && p.overflow === r.overflow && p.sheetCount === r.sheetCount ? p : r)), []);

  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  useEffect(() => {
    let live = true;
    runCommand<{ options: PrintOptions | null }>("setlists.printPrefs").then((r) => live && setSaved(r.options), () => live && setSaved(null));
    return () => { live = false; };
  }, []);

  // Until the real options are known, build with the plain defaults so we learn how many sets there are.
  const p = usePrintSheets(setlistId, opts ?? defaultPrintOptions(1));
  const { result, canMine, mineName, songFields } = p;
  useEffect(() => {
    if (opts || saved === undefined || !result) return;
    const o = defaultPrintOptions(result.setCount, saved);
    setOpts(canMine ? o : { ...o, copy: "band" });
  }, [opts, saved, result, canMine]);

  const set = (patch: Partial<PrintOptions>) => setOpts((o) => (o ? { ...o, ...patch } : o));
  const toggleField = (id: string) => opts && set({ fields: opts.fields.includes(id) ? opts.fields.filter((f) => f !== id) : [...opts.fields, id] });

  async function go() {
    if (!opts) return;
    try { await runCommand("setlists.setPrintPrefs", { options: opts }); } catch { /* printing doesn't wait on saving the prefs */ }
    const url = href(printPath(setlistId, opts));
    if (desktop) window.open(url, "_blank");
    else router.push(printPath(setlistId, opts));
    onClose();
  }

  const ready = !p.loading && !p.missing && !!result && !!opts;
  const perSet = opts?.sheets === "perSet";
  const sheetCount = fit?.sheetCount ?? result?.sheets.length ?? 1;
  const sheetLabel = `${sheetCount} ${sheetCount === 1 ? "sheet" : "sheets"}`;
  const ptLabel = fit ? `${pxToPt(fit.px)} pt` : "…";
  const fields: [string, string][] = [[FIELD_KEY, "Key"], [FIELD_LENGTH, "Length"], ...songFields.map((f): [string, string] => [songFieldId(f.id), f.label]), [FIELD_BREAKS, "Breaks"]];
  const scale = opts && result ? (PREVIEW_W[opts.sheets === "perSet" && result.sheets.length > 1 ? "perSet" : "one"]) / (PAPER[opts.paper].wIn * 96) : 1;

  const seg = <T extends string>(label: string, value: T, choices: { v: T; label: string; testid: string; disabled?: boolean }[], onPick: (v: T) => void) => (
    <div className="grid gap-2">
      <div className="lbl">{label}</div>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {choices.map((c) => (
          <button key={c.v} type="button" className="btn outline print-seg" aria-pressed={value === c.v} disabled={c.disabled} data-testid={c.testid} onClick={() => onPick(c.v)}>{c.label}</button>
        ))}
      </div>
    </div>
  );

  const options = opts && result && (
    <>
      {canMine && seg("Copy", opts.copy, [
        { v: "band", label: "Band copy", testid: "print-copy-band" },
        { v: "mine", label: `My copy${mineName ? ` (${mineName})` : ""}`, testid: "print-copy-mine" },
      ], (v) => set({ copy: v }))}
      {seg("Sheets", opts.sheets, [
        { v: "one", label: desktop ? "All sets on one sheet" : "One sheet", testid: "print-sheets-one" },
        { v: "perSet", label: desktop ? "One sheet per set" : "Sheet per set", testid: "print-sheets-perSet", disabled: result.setCount <= 1 },
      ], (v) => set({ sheets: v }))}
      <fieldset className="grid gap-1">
        <legend className="lbl mb-1">Extra fields</legend>
        <div className="grid grid-cols-2 gap-x-3">
          {fields.map(([id, label]) => (
            <label key={id} className="check flex min-h-11 items-center gap-2.5 text-sm">
              <input type="checkbox" checked={opts.fields.includes(id)} onChange={() => toggleField(id)} data-testid="print-field" data-field={id} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className="s">Song fields come from Settings → Custom fields.</p>
      </fieldset>
      <div className="grid gap-1">
        {seg("Long titles", opts.titles, [
          { v: "wrap", label: "Wrap onto two lines", testid: "print-titles-wrap" },
          { v: "short", label: "Use short title", testid: "print-titles-short" },
        ], (v) => set({ titles: v }))}
        <p className="s">Short title is a field on the song. Songs without one always wrap.</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <label className="check flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={opts.header} onChange={(e) => set({ header: e.target.checked })} data-testid="print-header" />
          Show name and date at top
        </label>
        <label className="flex items-center gap-2 text-sm">
          Paper
          <Select<PrintPaper> value={opts.paper} label="Paper" testid="print-paper" onChange={(v) => set({ paper: v })} options={(Object.keys(PAPER) as PrintPaper[]).map((k) => [k, PAPER[k].label] as const)} className="print-paper" />
        </label>
      </div>
    </>
  );

  const overflow = fit?.overflow && (
    <div className="err" role="alert" data-testid="print-overflow">
      These songs don&apos;t fit on one sheet at a readable size.{!perSet && result && result.setCount > 1 ? " Try one sheet per set." : ""}
    </div>
  );

  return (
    <dialog ref={ref} className={`print-dlg${desktop ? "" : " phone"}`} data-testid="print-dialog" aria-labelledby="print-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="print-opts">
        <div className="flex items-center justify-between gap-3">
          <h2 id="print-title" className="text-lg">Print setlist</h2>
          <button type="button" className="icon-btn" aria-label="Close" data-testid="print-close" onClick={onClose}><CloseIcon /></button>
        </div>
        {p.loading || (!p.missing && !ready) ? <div className="s">Loading…</div> : p.missing ? <div className="s">This setlist is gone.</div> : options}
        {ready && !desktop && (
          <>
            <p className="s" data-testid="print-summary">
              {result.songCount} {result.songCount === 1 ? "song" : "songs"} · {sheetLabel} · {PAPER[opts.paper].label} · text {ptLabel}
            </p>
            {overflow}
          </>
        )}
        {ready && !desktop && (
          <button type="button" className="btn acc" data-testid="print-go" onClick={go}><PrintIcon />Print or share PDF</button>
        )}
      </div>
      {desktop && (
        <div className="print-preview-col">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-semibold">Preview · <span data-testid="print-sheet-count">{sheetLabel}</span></div>
            <div className="s" data-testid="print-size">Text size: biggest that fits, {ptLabel}</div>
          </div>
          {overflow}
          <div className="flex flex-1 flex-wrap items-start justify-center gap-3" data-testid="print-preview">
            {ready && <PrintSheets result={result} paper={opts.paper} scale={scale} onFit={onFit} />}
          </div>
          {ready && (
            <div className="flex justify-end">
              <button type="button" className="btn acc" data-testid="print-go" onClick={go}><PrintIcon />Print</button>
            </div>
          )}
        </div>
      )}
      {ready && !desktop && (
        // Off-screen but laid out, so the fit can be measured without a preview.
        <div aria-hidden style={{ position: "fixed", left: -100000, top: 0, pointerEvents: "none" }}>
          <PrintSheets result={result} paper={opts.paper} onFit={onFit} />
        </div>
      )}
    </dialog>
  );
}
