"use client";
import { useMemo, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useCollection } from "@/lib/firestore-hooks";
import { useArtist } from "@/lib/artist";
import type { FieldDiff, History, User } from "@/schema";

export default function HistoryPage() { return <AdminOnly><HistoryView /></AdminOnly>; }

const PAGE = 100;
const RUN_LIMIT = 500;
type Row = History & { id: string };
interface UndoItem { kind: string; id: string; op: string; as?: string; reason?: string }
interface UndoReport { undoRunId: string; reverted: UndoItem[]; unchanged: UndoItem[]; needsManualCorrection: UndoItem[]; failed: UndoItem[] }

const ms = (r: Row) => (r.createdAt as unknown as { toMillis(): number })?.toMillis?.() ?? 0;

/** Firestore timestamps and plain values to short text. */
function show(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object" && typeof (v as { toDate?: unknown }).toDate === "function") return (v as { toDate(): Date }).toDate().toISOString().replace("T", " ").slice(0, 16);
  if (typeof v === "string") return v;
  return JSON.stringify(v, (_k, x) => (x && typeof x === "object" && typeof x.toDate === "function" ? x.toDate().toISOString() : x));
}

/** One table row per changed field, or per changed item for id-keyed lists. */
function diffRows(f: string, d: FieldDiff): { key: string; label: string; before: unknown; after: unknown }[] {
  if (!("byId" in d)) return [{ key: f, label: f, before: d.before, after: d.after }];
  const rows = Object.entries(d.byId).map(([id, c]) => ({ key: `${f}.${id}`, label: `${f} · ${id.slice(0, 6)}`, before: c.before, after: c.after }));
  if (d.order) rows.push({ key: `${f}.order`, label: `${f} · order`, before: d.order.before.map((x) => x.slice(0, 6)).join(", "), after: d.order.after.map((x) => x.slice(0, 6)).join(", ") });
  return rows;
}

function HistoryView() {
  const [runId, setRunId] = useState("");
  const [via, setVia] = useState("");
  const [kind, setKind] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [report, setReport] = useState<UndoReport | null>(null);
  const { call, error, busy } = useCommand();

  // Every record keeps its own history/{rev} subcollection: one collection-group listener, newest first, the server does the limit.
  // A run id is looked up alone (it is rare); the other filters are applied here for that case.
  const { artistId } = useArtist();
  const where = useMemo(() => {
    const w: [string, "==", unknown][] = [];
    if (runId.trim()) w.push(["runId", "==", runId.trim()]);
    else {
      if (via) w.push(["actor.via", "==", via]);
      if (kind.trim()) w.push(["entity.kind", "==", kind.trim()]);
    }
    return w;
  }, [runId, via, kind]);
  // Each entry carries the artist of its record: this artist's own, and the ones that belong to no one artist (null). The rules only
  // let a query through that names one of the two, so it is two listeners, merged by time.
  const opts = { group: true, includeDeleted: true, order: ["createdAt", "desc"] as ["createdAt", "desc"], limit: runId.trim() ? RUN_LIMIT : shown };
  const own = useCollection<History>("history", { ...opts, where: [["artistId", "==", artistId], ...where] });
  const shared = useCollection<History>("history", { ...opts, where: [["artistId", "==", null], ...where] });
  const hist = { loading: own.loading || shared.loading, error: own.error ?? shared.error };
  const users = useCollection<User>("users");
  const who = (uid: string) => users.rows?.find((u) => u.id === uid)?.name ?? uid;
  const rows = useMemo(() => [...(own.rows ?? []), ...(shared.rows ?? [])]
    .filter((r) => !runId.trim() || ((!via || r.actor.via === via) && (!kind.trim() || r.entity.kind === kind.trim())))
    .sort((a, b) => ms(b) - ms(a) || (b.seq ?? 0) - (a.seq ?? 0))
    .slice(0, runId.trim() ? RUN_LIMIT : shown), [own.rows, shared.rows, runId, via, kind, shown]);
  const runRows = runId.trim() ? rows : [];

  async function undo(id: string) {
    if (!confirm(`Undo every change in run ${id.slice(0, 8)}?`)) return;
    const r = await call<UndoReport>("history.undoRun", { runId: id });
    if (r) setReport(r);
  }

  return (
    <div className="grid gap-5">
      <PageTitle title="History" sub="Who changed what, human or AI. Undo a whole run in one step." />
      <ErrorBox error={error} />
      <div className="card" data-testid="history-filters">
        <span className="lbl">Filter</span>
        <div className="grid gap-2 sm:grid-cols-3">
          <input className="input" placeholder="Run id" value={runId} onChange={(e) => { setRunId(e.target.value); setShown(PAGE); }} data-testid="filter-run" />
          <select className="select" value={via} onChange={(e) => { setVia(e.target.value); setShown(PAGE); }} data-testid="filter-via" aria-label="Via">
            <option value="">Any source</option><option value="app">App</option><option value="mcp">AI (MCP)</option><option value="import">Import</option><option value="assistant">Roadie</option>
          </select>
          <input className="input" placeholder="Record type, e.g. venues" value={kind} onChange={(e) => { setKind(e.target.value); setShown(PAGE); }} data-testid="filter-entity" />
        </div>
      </div>

      {runId.trim() && runRows.length > 0 && (
        <div className="card hi" data-testid="run-card">
          <b>Run {runId.trim().slice(0, 8)}: {runRows.length} change{runRows.length === 1 ? "" : "s"} by {who(runRows[0].actor.uid)} via {runRows[0].actor.via}</b>
          <div><button className="btn acc" disabled={busy} onClick={() => undo(runId.trim())} data-testid="undo-run">Undo this run</button></div>
        </div>
      )}

      {report && (
        <div className="card" data-testid="undo-report">
          <b>Undone as run {report.undoRunId.slice(0, 8)}</b>
          <span className="s" data-testid="undo-counts">{report.reverted.length} put back · {report.unchanged.length} already as before · {report.needsManualCorrection.length} need a manual correction · {report.failed.length} failed</span>
          {report.needsManualCorrection.length > 0 && (
            <div data-testid="undo-manual">
              <span className="lbl">Money records are never edited. Add a correction in Money for:</span>
              <ul className="s">{report.needsManualCorrection.map((x, i) => <li key={i}>{x.kind}/{x.id} ({x.op})</li>)}</ul>
            </div>
          )}
          {report.failed.length > 0 && <ul className="s">{report.failed.map((x, i) => <li key={i}>{x.kind}/{x.id}: {x.reason}</li>)}</ul>}
          <button className="btn ghost sm" onClick={() => { setRunId(report.undoRunId); setReport(null); }}>Show this undo</button>
        </div>
      )}

      {hist.error && <div className="err" role="alert">{hist.error}</div>}
      <div className="grid gap-2" data-testid="history-list">
        {hist.loading && <span className="s">Loading…</span>}
        {!hist.loading && rows.length === 0 && <div className="empty" data-testid="history-empty"><span>No changes match.</span></div>}
        {rows.map((r) => (
          <div key={`${r.entity.kind}/${r.entity.id}/${r.id}`} className="card" data-testid="history-row" data-run={r.runId} data-kind={r.entity.kind} data-op={r.op}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip">{r.op}</span>
              <b>{r.entity.kind}</b><span className="s">{r.entity.id}</span>
              <span className={`chip ${r.actor.via === "mcp" ? "a" : "m"}`}>{r.actor.via}</span>
            </div>
            <span className="s">{who(r.actor.uid)} · {show(r.createdAt)} · run{" "}
              <button className="underline" onClick={() => { setRunId(r.runId); setShown(PAGE); }} data-testid="pick-run">{r.runId.slice(0, 8)}</button>
            </span>
            <details>
              <summary className="s cursor-pointer">{Object.keys(r.diff).length} field{Object.keys(r.diff).length === 1 ? "" : "s"}</summary>
              <table className="mt-1 w-full text-sm" data-testid="diff">
                <tbody>
                  {Object.entries(r.diff).flatMap(([f, d]) => diffRows(f, d)).map((x) => (
                    <tr key={x.key} className="align-top">
                      <td className="pr-2 font-semibold">{x.label}</td>
                      <td className="pr-2 text-muted line-through break-all">{show(x.before)}</td>
                      <td className="break-all">{show(x.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        ))}
      </div>
      {!runId.trim() && ((own.rows?.length ?? 0) >= shown || (shared.rows?.length ?? 0) >= shown) && <button className="btn ghost" onClick={() => setShown(shown + PAGE)} data-testid="show-more">Show more</button>}
    </div>
  );
}
