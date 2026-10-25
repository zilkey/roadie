"use client";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PrintSheets, type PrintFit } from "@/components/print/PrintSheets";
import { usePrintSheets } from "@/components/print/usePrintSheets";
import { useArtistRouter } from "@/lib/artist";
import { defaultPrintOptions, PAPER, parsePrintQuery } from "@/lib/print";

/**
 * Just the sheets, black on white, for window.print(). Opened from the Print dialog (and from Roadie's links), it waits
 * for the font and the fit, opens the browser's print dialog once, and goes back to the setlist when that closes.
 * There is no app shell on this route (Shell and ToastHost skip paths ending in /print).
 * The page margin is 0 so the browser has nowhere to print its date, title and URL; each sheet carries the half-inch margin
 * as padding instead (PrintSheets).
 */
export default function PrintPage() {
  const { id } = useParams<{ id: string }>();
  const q = useSearchParams();
  const router = useArtistRouter();
  const options = useMemo(() => parsePrintQuery(new URLSearchParams(q.toString()), defaultPrintOptions(2)), [q]);
  const p = usePrintSheets(id, options);
  const [fit, setFit] = useState<PrintFit | null>(null);
  const printed = useRef(false);
  const back = useRef(p.backPath);
  back.current = p.backPath;

  useEffect(() => {
    if (!fit || printed.current) return;
    printed.current = true;
    // The desktop dialog opened this tab: close it and the setlist is still there. Otherwise (phone, a shared link) go back.
    window.addEventListener("afterprint", () => { if (window.opener) window.close(); else router.push(back.current); }, { once: true });
    window.print();
  }, [fit, router]);

  return (
    <div className="print-page" data-testid="print-page" data-ready={fit ? "true" : undefined}>
      <style>{`@page{size:${PAPER[options.paper].css};margin:0}html,body{background:#fff !important}.print-page{background:#fff;min-height:100dvh;display:flex;justify-content:center;padding:24px 0}@media print{.print-page{padding:0;display:block;min-height:0}}`}</style>
      {p.loading && <div className="s">Loading…</div>}
      {p.missing && <div className="s" data-testid="not-found">That setlist isn&apos;t here any more.</div>}
      {p.result && <PrintSheets result={p.result} paper={options.paper} onFit={setFit} />}
    </div>
  );
}
