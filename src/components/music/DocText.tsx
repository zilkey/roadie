"use client";
import { useEffect, useRef, useState } from "react";
import { runCommandQuiet } from "@/lib/commands";
import { useProfile } from "@/lib/auth";
import { isGoogleDoc } from "@/lib/music";
import { ErrorBox, useCommand } from "@/components/ui";
import { Tabs } from "@/components/booking/common";
import { docContentFromText, type DocBlock, type DocContent, type DocRun } from "@/schema/docContent";
import type { FileRow } from "./common";

type Result = { status: "ok"; content: DocContent; text: string } | { status: "noAccess" } | { status: "error"; message: string };

/** The song's Google Docs (lyrics first, then charts, by title): the ones the song and rehearsal pages show inline. */
export function googleDocsOf(files: FileRow[], songId: string): FileRow[] {
  const rank = (k: string) => (k === "lyrics" ? 0 : k === "chart" ? 1 : 2);
  return files.filter((f) => f.songId === songId && (f.kind === "lyrics" || f.kind === "chart") && isGoogleDoc(f))
    .sort((a, b) => rank(a.kind) - rank(b.kind) || a.title.localeCompare(b.title));
}

/**
 * A Google Doc, inline. The copy cached on the file shows at once (a weak signal at rehearsal still has it); then
 * files.docText asks Drive whether the doc changed and, if so, re-reads it (the file record updates and this follows).
 * Monospace with the doc's own line breaks and spaces, so chords stay over the words; bold and italic kept; tables side by
 * side (stacked on a phone); a doc with tabs gets a tab bar, opening on its first tab.
 */
export function DocText({ file }: { file: FileRow }) {
  const admin = useProfile().role === "admin";
  const fix = useCommand();
  const [res, setRes] = useState<Result | null>(null);
  const [tries, setTries] = useState(0);
  const [full, setFull] = useState(false);
  useEffect(() => {
    let live = true;
    runCommandQuiet<Result>("files.docText", { id: file.id })
      .then((r) => { if (live) setRes(r.result); })
      .catch((e) => { if (live) setRes({ status: "error", message: (e as Error).message }); });
    return () => { live = false; };
  }, [file.id, tries]);
  const content = res?.status === "ok" ? res.content : file.docContent ?? (file.docText !== undefined ? docContentFromText(file.docText) : undefined);
  const open = <a className="btn ghost sm" href={file.url} target="_blank" rel="noreferrer" data-testid="doc-open">Open in Drive</a>;

  if (res?.status === "noAccess") {
    return (
      <div className="grid gap-2" data-testid="doc-no-access">
        <p className="m-0">Roadie can&apos;t read this doc: the band&apos;s Google account doesn&apos;t have access to it.</p>
        <div className="flex flex-wrap items-center gap-2">
          {admin && <button className="btn ghost sm" disabled={fix.busy} data-testid="doc-share"
            onClick={async () => { if (await fix.call("files.shareWithBand", { ids: [file.id] })) setTries((n) => n + 1); }}>Share with band</button>}
          {open}
        </div>
        <ErrorBox error={fix.error} />
      </div>
    );
  }
  if (content === undefined) {
    return res ? (
      <div className="grid gap-2" data-testid="doc-unavailable">
        <p className="m-0">Couldn&apos;t get this doc from Google Drive just now.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn ghost sm" onClick={() => { setRes(null); setTries((n) => n + 1); }} data-testid="doc-retry">Try again</button>
          {open}
        </div>
      </div>
    ) : <span className="d-muted" data-testid="doc-loading">Loading…</span>;
  }
  return (
    <div className="grid gap-2">
      <DocView content={content} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn ghost sm" onClick={() => setFull(true)} data-testid="doc-fullscreen">Full screen</button>
        {open}
      </div>
      <DocFullScreen title={file.title} content={content} open={full} onClose={() => setFull(false)} />
    </div>
  );
}

const SIZES = [1, 1.25, 1.5, 1.75, 2, 2.5, 3]; // rem
const SIZE_KEY = "roadie.docFullScreenSize";

/**
 * The doc over the whole screen, for reading on a stand: bigger text (A− / A+, remembered on this device), the browser's
 * own full screen where it has one (a phone without it still gets the whole window), and the screen kept awake while it's
 * up. Escape, Done, or leaving the browser's full screen closes it.
 */
function DocFullScreen({ title, content, open, onClose }: { title: string; content: DocContent; open: boolean; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [size, setSize] = useState(1);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    try { const i = SIZES.indexOf(Number(window.localStorage.getItem(SIZE_KEY))); if (i >= 0) setSize(i); } catch { /* storage blocked: default size */ }
  }, []);
  const pick = (i: number) => {
    setSize(i);
    try { window.localStorage.setItem(SIZE_KEY, String(SIZES[i])); } catch { /* storage blocked: this visit only */ }
  };

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!open) { if (d.open) d.close(); return; }
    if (!d.open) d.showModal();
    let wake: { release(): Promise<void> } | undefined;
    let wentFull = false;
    const onFs = () => { if (wentFull && !document.fullscreenElement) close.current(); };
    document.addEventListener("fullscreenchange", onFs);
    const root = document.documentElement;
    if (root.requestFullscreen && !document.fullscreenElement) {
      root.requestFullscreen().then(() => { wentFull = true; }).catch(() => { /* not allowed here: the dialog still fills the window */ });
    }
    const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
    nav.wakeLock?.request("screen").then((w) => { wake = w; }).catch(() => { /* no wake lock: the screen may dim */ });
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      if (wentFull && document.fullscreenElement) document.exitFullscreen().catch(() => {});
      wake?.release().catch(() => {});
    };
  }, [open]);

  const bar = "btn ghost sm";
  return (
    <dialog ref={ref} aria-label={title} data-testid="doc-fullscreen-view"
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-[var(--bg)] p-0 text-[var(--ink)] backdrop:bg-[var(--bg)]"
      onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open && (
        <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
          <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-bold" data-testid="doc-fullscreen-title">{title}</span>
            <button type="button" className={bar} aria-label="Smaller text" disabled={size === 0} onClick={() => pick(size - 1)} data-testid="doc-fullscreen-smaller">A−</button>
            <button type="button" className={bar} aria-label="Bigger text" disabled={size === SIZES.length - 1} onClick={() => pick(size + 1)} data-testid="doc-fullscreen-bigger">A+</button>
            <button type="button" className="btn sm" onClick={onClose} data-testid="doc-fullscreen-close" autoFocus>Done</button>
          </div>
          <div className="doc-full overflow-auto px-4 py-4 sm:px-8" style={{ "--doc-size": `${SIZES[size]}rem` } as React.CSSProperties} data-testid="doc-fullscreen-body">
            <DocView content={content} />
          </div>
        </div>
      )}
    </dialog>
  );
}

/** The doc's tabs (a bar only when there are two or more) and the chosen tab's paragraphs and tables. */
export function DocView({ content }: { content: DocContent }) {
  const [picked, setPicked] = useState<string>();
  const tabs = content.tabs;
  const tab = tabs.find((t) => t.id === picked) ?? tabs[0];
  return (
    <div className="grid gap-3">
      {tabs.length > 1 && <Tabs value={tab.id} options={tabs.map((t) => [t.id, t.title || "Untitled tab"])} onChange={setPicked} testid="doc-tabs" />}
      {tab && tab.blocks.some((b) => b.type === "table" || b.runs.length)
        ? <div className="doc-text" data-testid="doc-text" data-tab={tab.title}>{groups(tab.blocks).map((g, i) => g.type === "table"
          ? <DocTable key={i} rows={g.rows} />
          : <pre key={i}>{g.paras.map((runs, j) => <span key={j}>{j > 0 && "\n"}<Runs runs={runs} /></span>)}</pre>)}</div>
        : <span className="d-muted" data-testid="doc-empty">{tabs.length > 1 ? "This tab is empty." : "This doc is empty."}</span>}
    </div>
  );
}

/** Paragraphs in a row become one block, so a blank line between them stays a blank line. */
function groups(blocks: DocBlock[]) {
  const out: ({ type: "p"; paras: DocRun[][] } | Extract<DocBlock, { type: "table" }>)[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (b.type === "table") out.push(b);
    else if (last?.type === "p") last.paras.push(b.runs);
    else out.push({ type: "p", paras: [b.runs] });
  }
  return out;
}

function Runs({ runs }: { runs: DocRun[] }) {
  return <>{runs.map((r, i) => {
    let el: React.ReactNode = r.t;
    if (r.i) el = <em>{el}</em>;
    if (r.b) el = <strong>{el}</strong>;
    return <span key={i}>{el}</span>;
  })}</>;
}

/** A doc table: side by side with the first column right-aligned, like the doc; on a phone each row's cells stack, left-aligned. */
function DocTable({ rows }: { rows: Extract<DocBlock, { type: "table" }>["rows"] }) {
  return (
    <table className="doc-table" data-testid="doc-table">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.cells.map((c, j) => (
              <td key={j}><pre>{c.paras.map((p, k) => <span key={k}>{k > 0 && "\n"}<Runs runs={p.runs} /></span>)}</pre></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
