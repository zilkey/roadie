"use client";
import { useState } from "react";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";

interface Result { url: string; name: string; folder: { name: string; url: string }; pages: { title: string; tab?: string; alt?: boolean }[]; skipped: { title: string; reason: string; alt?: boolean }[] }

/**
 * "Download PDF" on a setlist: setlists.pdf exports each song's chart from Google Docs into one PDF saved in Drive (Charts / Setlists),
 * then this shows the link to open it, and which songs had no chart to include. Give exactly one of setlistId (a template) or showId.
 */
export function SetlistPdfButton({ setlistId, showId }: { setlistId?: string; showId?: string }) {
  const { call, error, busy, setError } = useCommand();
  const [result, setResult] = useState<Result | null>(null);
  const [open, setOpen] = useState(false);
  async function make() {
    setResult(null); setOpen(true);
    const r = await call<Result>("setlists.pdf", setlistId ? { setlistId } : { showId });
    if (r) setResult(r);
  }
  const close = () => { setOpen(false); setError(null); };
  const songs = result ? new Set(result.pages.map((p) => `${p.alt ? "alt:" : ""}${p.title}`)).size : 0;
  return (
    <>
      <button type="button" className="btn outline" data-testid="setlist-pdf" disabled={busy} onClick={() => void make()}>Download PDF</button>
      <Dialog open={open} onClose={close} title="Setlist PDF" testid="setlist-pdf-dialog">
        {busy && <p className="s" data-testid="setlist-pdf-working">Reading each chart from Google Docs. This can take a minute.</p>}
        <ErrorBox error={error} />
        {result && (
          <>
            <p data-testid="setlist-pdf-done">
              <b>{result.name}</b> is in <a className="underline" href={result.folder.url} target="_blank" rel="noreferrer">{result.folder.name}</a> in Drive:
              {" "}{result.pages.length} {result.pages.length === 1 ? "page" : "pages"} for {songs} {songs === 1 ? "song" : "songs"}.
            </p>
            {result.skipped.length > 0 && (
              <div className="grid gap-1" data-testid="setlist-pdf-skipped">
                <span className="lbl">Left out</span>
                <ul className="grid gap-0.5 text-sm">
                  {result.skipped.map((s, i) => <li key={i}>{s.title}{s.alt ? " (alternate)" : ""}: {s.reason}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn ghost" data-testid="setlist-pdf-close" onClick={close}>Close</button>
          {result && <a className="btn acc" data-testid="setlist-pdf-open" href={result.url} target="_blank" rel="noreferrer">Open PDF</a>}
        </div>
      </Dialog>
    </>
  );
}
