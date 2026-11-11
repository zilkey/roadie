import type { Metadata } from "next";
import { StagePlotSvg } from "@/components/stagePlots/StagePlotSvg";
import { channelRows, mixRows } from "@/lib/stagePlots/sheet";
import { plotByToken } from "@/server/stagePlotShare";
import { sheetContext } from "@/server/stagePlotSheet";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stage plot", robots: { index: false, follow: false } };

/**
 * The engineer's page: public, no login. The token in the URL is the credential, checked against the plot's stored hash.
 * Always the latest version of the plot; the link stops working when the band turns it off.
 */
export default async function EngineerPlotPage({ params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params;
  let ctx;
  try { ctx = await sheetContext(await plotByToken(id, token)); } catch { ctx = null; }
  if (!ctx) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-md content-start gap-4 p-4 pt-10" data-testid="plot-page">
        <div className="card" data-testid="plot-problem"><span>This link is not valid any more. Ask the band for a new one.</span></div>
      </main>
    );
  }
  const { plot, artist, lineupName, names } = ctx;
  const ch = channelRows(plot, names), mx = mixRows(plot, names);
  const pdf = `/api/plot/${encodeURIComponent(id)}/${encodeURIComponent(token)}`;
  return (
    <main className="mx-auto grid min-h-dvh max-w-3xl content-start gap-4 p-4 pt-8" data-testid="plot-page">
      <header className="grid gap-1">
        <h1 className="page-title" data-testid="plot-title">{artist} stage plot</h1>
        <p className="s text-[15px]" data-testid="plot-sub">{plot.name}{lineupName ? ` · ${lineupName}` : ""} · v{plot.version ?? 1}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a className="btn" href={pdf} download data-testid="plot-pdf">Download PDF</a>
          <a className="btn outline" href={`${pdf}?paper=a4`} download data-testid="plot-pdf-a4">A4</a>
        </div>
      </header>

      <div className="card" style={{ background: "#fff", color: "#111", overflowX: "auto" }} data-testid="plot-drawing">
        <StagePlotSvg plot={plot} forPaper />
      </div>

      {ch.length > 0 && (
        <section className="card" data-testid="plot-channels">
          <h2>Channels</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="w-full text-left text-[14px]">
              <thead><tr><th>Ch</th><th>Source</th><th>Mic / DI</th><th>Stand</th><th>48V</th><th>Who</th><th>Note</th></tr></thead>
              <tbody>
                {ch.map((r) => (
                  <tr key={r.n} data-testid="plot-channel">
                    <td className="font-bold">{r.n}</td>
                    <td>{r.source || "-"}{!r.placed && <em className="s"> not placed</em>}</td>
                    <td>{r.gear}</td><td>{r.stand}</td><td>{r.phantom ? "48V" : ""}</td><td>{r.who}</td><td>{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {mx.length > 0 && (
        <section className="card" data-testid="plot-mixes">
          <h2>Monitor mixes</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="w-full text-left text-[14px]">
              <thead><tr><th>Mix</th><th>Type</th><th>Who</th><th>Wants</th></tr></thead>
              <tbody>
                {mx.map((r) => (
                  <tr key={r.n} data-testid="plot-mix"><td className="font-bold">M{r.n}</td><td>{r.kind}{!r.placed && <em className="s"> not placed</em>}</td><td>{r.who}</td><td>{r.wants}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(plot.bring || plot.need) && (
        <section className="card" data-testid="plot-bring-need">
          {plot.bring && <div><h2>We bring</h2><p className="m-0 whitespace-pre-line">{plot.bring}</p></div>}
          {plot.need && <div><h2>We need</h2><p className="m-0 whitespace-pre-line">{plot.need}</p></div>}
        </section>
      )}
    </main>
  );
}
