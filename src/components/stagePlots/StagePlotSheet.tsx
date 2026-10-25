import { StagePlotSvg } from "./StagePlotSvg";
import { PAPER_PT, channelRows, mixRows, sheetDate, type Paper, type SheetPlot } from "@/lib/stagePlots/sheet";

/**
 * The one-page stage plot sheet: black on white, Figtree, Letter or A4. Server-renderable (no hooks). The plot on top, then the channel
 * table, the monitor mixes, and We bring / We need. The PDF (src/server/stagePlotPdf.ts) draws the same content with pdfkit.
 */
export function StagePlotSheet({ plot, artist, lineupName, paper = "letter", names, date }: {
  plot: SheetPlot; artist: string; lineupName?: string; paper?: Paper; names?: Record<string, string>; date?: Date;
}) {
  const { w, h } = PAPER_PT[paper];
  const ch = channelRows(plot, names), mx = mixRows(plot, names);
  const th = { textAlign: "left", fontWeight: 700, fontSize: 8, textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1.5px solid #111", padding: "2px 4px" } as const;
  const td = { fontSize: 9.5, padding: "2px 4px", borderBottom: "1px solid #ddd", verticalAlign: "top" } as const;
  return (
    <section data-testid="plot-sheet" style={{ width: `${w}pt`, height: `${h}pt`, boxSizing: "border-box", padding: "30pt 32pt", background: "#fff", color: "#111", fontFamily: "Figtree, Arial, sans-serif", display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "2px solid #111", paddingBottom: 4 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.1 }}>{artist}</div>
          <div style={{ fontSize: 11, fontWeight: 600 }}>Stage plot{plot.name ? ` · ${plot.name}` : ""}{lineupName ? ` · ${lineupName}` : ""}</div>
        </div>
        <div style={{ fontSize: 10, textAlign: "right" }}>v{plot.version ?? 1} · {sheetDate(date)}</div>
      </header>
      <div style={{ display: "flex", justifyContent: "center", maxHeight: "34%" }}>
        <StagePlotSvg plot={plot} forPaper className="" />
      </div>
      {ch.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="sheet-channels">
          <thead><tr>{["Ch", "Source", "Mic / DI", "Stand", "48V", "Who", "Note"].map((x) => <th key={x} style={th}>{x}</th>)}</tr></thead>
          <tbody>
            {ch.map((r) => (
              <tr key={r.n}>
                <td style={{ ...td, fontWeight: 700 }}>{r.n}</td>
                <td style={td}>{r.source}{!r.placed && <em style={{ color: "#555" }}> not placed</em>}</td>
                <td style={td}>{r.gear}</td><td style={td}>{r.stand}</td><td style={td}>{r.phantom ? "48V" : ""}</td><td style={td}>{r.who}</td><td style={td}>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {mx.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="sheet-mixes">
          <thead><tr>{["Mix", "Type", "Who", "Wants"].map((x) => <th key={x} style={th}>{x}</th>)}</tr></thead>
          <tbody>
            {mx.map((r) => (
              <tr key={r.n}><td style={{ ...td, fontWeight: 700 }}>M{r.n}</td><td style={td}>{r.kind}{!r.placed && <em style={{ color: "#555" }}> not placed</em>}</td><td style={td}>{r.who}</td><td style={td}>{r.wants}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {(plot.bring || plot.need) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 9.5, marginTop: "auto" }}>
          {([["We bring", plot.bring], ["We need", plot.need]] as const).map(([t, v]) => (
            <div key={t}><div style={{ ...th, border: 0, borderBottom: "1.5px solid #111" }}>{t}</div><div style={{ whiteSpace: "pre-line", paddingTop: 2 }}>{v || "-"}</div></div>
          ))}
        </div>
      )}
    </section>
  );
}
