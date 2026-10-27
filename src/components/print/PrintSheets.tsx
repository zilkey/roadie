"use client";
import { useLayoutEffect, useRef, useState } from "react";
import type { BuildResult, PrintSet, PrintSheet, RowField, SheetRow } from "@/lib/printSheets";
import type { PrintPaper } from "@/schema/print";
import { fitTextSize, PAGE_MARGIN_IN, PAPER, sheetBox } from "@/lib/print";

const FONT_HREF = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&display=swap";
const SET_COLOR = "#3a46c4";

let fontPromise: Promise<void> | null = null;
/** Loads Barlow Condensed once; resolves when it is ready (or after 4 s, so being offline never blocks the print). */
function barlowReady(): Promise<void> {
  fontPromise ??= (async () => {
    if (!document.getElementById("barlow-condensed")) {
      const l = document.createElement("link");
      l.id = "barlow-condensed"; l.rel = "stylesheet"; l.href = FONT_HREF;
      document.head.appendChild(l);
    }
    const loaded = Promise.allSettled([document.fonts.load("600 20px 'Barlow Condensed'"), document.fonts.load("700 20px 'Barlow Condensed'")]).then(() => document.fonts.ready);
    await Promise.race([loaded, new Promise((r) => setTimeout(r, 4000))]);
  })().then(() => undefined);
  return fontPromise;
}

export interface PrintFit { px: number; overflow: boolean; sheetCount: number }

/**
 * The printed sheets: black on white, Barlow Condensed, every size a multiple of the one base size `--print-px`, which is
 * fitted (largest whole px at which every sheet's body fits its box) after the font loads. `scale` shrinks the whole
 * thing for the dialog's preview with a transform, so measuring still happens at full size.
 */
export function PrintSheets({ result, paper, onFit, scale = 1 }: { result: BuildResult; paper: PrintPaper; onFit?: (r: PrintFit) => void; scale?: number }) {
  const root = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<PrintFit | null>(null);
  const [innerH, setInnerH] = useState(0);
  const onFitRef = useRef(onFit);
  onFitRef.current = onFit;
  const box = sheetBox(paper);
  const tableLayout = result.layout === "table";

  useLayoutEffect(() => {
    let cancelled = false;
    void barlowReady().then(() => {
      const el = root.current;
      if (cancelled || !el) return;
      el.classList.remove("ps-grow");
      const bodies = Array.from(el.querySelectorAll<HTMLElement>('[data-testid="print-sheet-body"]'));
      const measure = (px: number) => {
        el.style.setProperty("--print-px", String(px));
        return bodies.every((b) => b.scrollHeight <= b.clientHeight && b.scrollWidth <= b.clientWidth);
      };
      // One sheet with several sets: one column of sets, or one column per set (up to 3), whichever fits larger text.
      const sets = result.sheets[0]?.sets.length ?? 1;
      const options = result.sheets.length === 1 && !tableLayout && sets > 1 && sets <= 3 ? [1, sets] : [1];
      let best = { cols: 1, px: 0 };
      for (const cols of options) {
        el.style.setProperty("--print-cols", String(cols));
        const px = fitTextSize(measure);
        if (px > best.px) best = { cols, px };
      }
      el.style.setProperty("--print-cols", String(best.cols));
      const overflow = !measure(best.px);
      if (overflow) el.classList.add("ps-grow");
      const r = { px: best.px, overflow, sheetCount: result.sheets.length };
      setFit(r);
      setInnerH(inner.current?.offsetHeight ?? 0);
      onFitRef.current?.(r);
    });
    return () => { cancelled = true; };
  }, [result, paper, tableLayout]);

  const pageW = Math.round(PAPER[paper].wIn * 96);
  return (
    <div ref={root} className="ps-root" data-testid="print-sheets" data-layout={result.layout} data-text-px={fit?.px} data-overflow={fit ? String(fit.overflow) : undefined}
      style={{ width: pageW * scale, height: scale === 1 || !innerH ? undefined : innerH * scale, "--ps-w": `${box.w}px`, "--ps-h": `${box.h}px`, "--ps-m": `${PAGE_MARGIN_IN}in` } as React.CSSProperties}>
      <style>{CSS}</style>
      <div ref={inner} className="ps-inner" style={scale === 1 ? undefined : { transform: `scale(${scale})`, transformOrigin: "top left", width: pageW }}>
        {result.sheets.map((s, i) => <Sheet key={i} sheet={s} layout={result.layout} />)}
      </div>
    </div>
  );
}

function Sheet({ sheet, layout }: { sheet: PrintSheet; layout: BuildResult["layout"] }) {
  const lines = sheet.subtitle.split("\n");
  return (
    <div className="ps-page" data-testid="print-sheet">
      <div className="ps-box">
        {sheet.header && (
          <div className="ps-head">
            <div className="ps-title" style={sheet.setHeading ? { color: SET_COLOR, fontSize: "calc(var(--print-px) * 0.9px)" } : undefined}>{sheet.title}</div>
            <div className="ps-sub">{lines.map((l, i) => <div key={i}>{l}</div>)}</div>
          </div>
        )}
        <div className="ps-body" data-testid="print-sheet-body">
          {layout === "table" ? <Table sheet={sheet} /> : (
            <div className="ps-sets">
              {sheet.sets.map((s, i) => (
                <div key={i} className="ps-set">
                  {sheet.sets.length > 1 && <SetHeading set={s} />}
                  {s.rows.map((r, j) => <Row key={j} row={r} layout={layout} />)}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="ps-foot"><span data-testid="print-footer">{sheet.footer}</span><span>myroadie.online</span></div>
      </div>
    </div>
  );
}

const SetHeading = ({ set }: { set: PrintSet }) => (
  <div className="ps-setname"><span>{set.name.toUpperCase()}</span><span>{Math.round(set.lengthSec / 60)} min</span></div>
);

function Row({ row, layout }: { row: SheetRow; layout: BuildResult["layout"] }) {
  if (row.kind === "break") return <div className="ps-break" data-testid="print-break">{row.text}</div>;
  if (layout === "underTitle") {
    return (
      <div className="ps-row ps-under" data-testid="print-row">
        <span className="ps-n">{row.n}</span>
        <div className="ps-stack">
          <span className="ps-t">{row.title}</span>
          {row.fields.length > 0 && <span className="ps-fields">{row.fields.map((f) => f.value).join(" · ")}</span>}
          <Alts row={row} />
        </div>
      </div>
    );
  }
  return (
    <div className="ps-row" data-testid="print-row">
      <span className="ps-n">{row.n}</span>
      <span className="ps-stack">
        <span className="ps-t">
          {row.title}
          {row.key && <span className="ps-key" data-testid="print-key">{row.key}</span>}
          {row.fields.length > 0 && <span className="ps-key" data-testid="print-fields">{row.fields.map(listField).join(" · ")}</span>}
        </span>
        <Alts row={row} />
      </span>
    </div>
  );
}

/** A song's alternates, small on one line under its title. */
const Alts = ({ row }: { row: Extract<SheetRow, { kind: "song" }> }) =>
  row.alts?.length ? <span className="ps-alts" data-testid="print-alts">alt: {row.alts.join(" · ")}</span> : null;

/** A band-copy field after the title: Length is plain ("4:05"); a song field names itself ("Capo 2"). */
const listField = (f: RowField) => (f.id.startsWith("field:") ? `${f.label} ${f.value}` : f.value);

/** My copy, 3+ fields: one grid for the whole sheet so the field columns line up across sets. */
function Table({ sheet }: { sheet: PrintSheet }) {
  return (
    <div className="ps-table" style={{ gridTemplateColumns: `calc(var(--print-px) * 1.4px) minmax(0, 1fr) ${sheet.columns.map(() => "max-content").join(" ")}` }}>
      <span />
      <span className="ps-th">SONG</span>
      {sheet.columns.map((c) => <span key={c.id} className="ps-th">{c.label.toUpperCase()}</span>)}
      {sheet.sets.map((s, i) => (
        <div key={i} className="ps-trow-group">
          {sheet.sets.length > 1 && <div className="ps-setname" style={{ gridColumn: "1 / -1" }}><span>{s.name.toUpperCase()}</span><span>{Math.round(s.lengthSec / 60)} min</span></div>}
          {s.rows.map((r, j) => r.kind === "break"
            ? <div key={j} className="ps-tbreak" data-testid="print-break">{r.text}</div>
            : (
              <div key={j} className="ps-trow" data-testid="print-row">
                <span className="ps-n">{r.n}</span>
                <span className="ps-t">{r.title}</span>
                {r.fields.map((f) => <span key={f.id} className="ps-tf">{f.value}</span>)}
                {r.alts?.length ? <span className="ps-talt"><Alts row={r} /></span> : null}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

// Every size is `--print-px` times a ratio taken from the wireframes (song title = 1).
const CSS = `
.ps-root{--print-px:32;--print-cols:1;--u:calc(var(--print-px) * 1px);font-family:'Barlow Condensed',sans-serif;color:#111;background:transparent}
.ps-inner{display:flex;flex-direction:column;gap:24px}
.ps-page{box-sizing:border-box;width:calc(var(--ps-w) + 2 * var(--ps-m));padding:var(--ps-m);background:#fff;color:#111;box-shadow:0 1px 6px rgba(0,0,0,.25)}
.ps-box{width:var(--ps-w);height:var(--ps-h);display:flex;flex-direction:column;gap:calc(var(--u) * .4);background:#fff;color:#111}
.ps-grow .ps-box{height:auto;min-height:var(--ps-h)}
.ps-head{display:flex;justify-content:space-between;align-items:baseline;gap:16px;border-bottom:2px solid #111;padding-bottom:6px}
.ps-title{font-size:min(calc(var(--u) * .8),40px);font-weight:700;line-height:1.1}
.ps-sub{font-size:min(calc(var(--u) * .62),22px);font-weight:600;text-align:right}
.ps-body{flex:1;min-height:0;overflow:hidden}
.ps-grow .ps-body{flex:none;overflow:visible}
.ps-sets{display:grid;grid-template-columns:repeat(var(--print-cols),minmax(0,1fr));column-gap:40px;align-items:start;row-gap:calc(var(--u) * .3)}
.ps-set{display:flex;flex-direction:column;gap:calc(var(--u) * .19);min-width:0}
.ps-setname{display:flex;justify-content:space-between;font-size:calc(var(--u) * .69);font-weight:700;color:${SET_COLOR};padding-top:calc(var(--u) * .1)}
.ps-row{display:flex;gap:calc(var(--u) * .25);font-size:var(--u);font-weight:700;line-height:1.08}
.ps-n{flex:none;width:calc(var(--u) * 1.05);color:#767676;font-weight:600}
.ps-t{min-width:0;overflow-wrap:anywhere}
.ps-key{margin-left:.4em;font-size:.8em;font-weight:600;color:#767676}
.ps-under .ps-n{line-height:1.05}
.ps-stack{display:flex;flex-direction:column;gap:calc(var(--u) * .07);min-width:0}
.ps-under{margin-bottom:calc(var(--u) * .2)}
.ps-fields{font-size:calc(var(--u) * .43);font-weight:600;line-height:1.2}
.ps-alts{font-size:calc(var(--u) * .5);font-weight:600;font-style:italic;line-height:1.15;color:#555}
.ps-trow > .ps-talt{grid-column:2 / -1;padding-top:0}
.ps-break{margin-top:calc(var(--u) * .1);border:1.5px dashed #767676;border-radius:6px;padding:calc(var(--u) * .19) calc(var(--u) * .31);font-size:calc(var(--u) * .69);font-weight:600;font-style:italic}
.ps-table{display:grid;column-gap:calc(var(--u) * .3);align-content:start}
.ps-table > .ps-th{font-size:calc(var(--u) * .54);font-weight:700;letter-spacing:.06em;color:#555}
.ps-trow-group{display:contents}
.ps-trow{display:contents;font-size:var(--u);font-weight:700;line-height:1.12}
.ps-trow > span{align-self:baseline;padding:calc(var(--u) * .08) 0;border-bottom:1px solid #ddd}
.ps-trow .ps-n{width:auto;font-size:.75em}
.ps-trow .ps-tf{font-size:.83em;font-weight:600;white-space:nowrap}
.ps-tbreak{grid-column:1 / -1;font-size:calc(var(--u) * .75);font-weight:600;font-style:italic;padding:calc(var(--u) * .17) 0 calc(var(--u) * .17) calc(var(--u) * 1.7);border-bottom:1px solid #ddd}
.ps-foot{display:flex;justify-content:space-between;gap:16px;font-size:min(calc(var(--u) * .47),16px);font-weight:600;color:#555;border-top:1px solid #bbb;padding-top:6px}
@media print{.ps-root{width:auto !important;height:auto !important}.ps-inner{transform:none !important;width:auto !important;gap:0}.ps-page{box-shadow:none}.ps-page:not(:last-child){break-after:page}}
`;
