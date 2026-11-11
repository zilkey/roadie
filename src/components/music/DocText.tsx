"use client";
import { useEffect, useState } from "react";
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
      <div>{open}</div>
    </div>
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
