"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { Dialog, ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { runCommand } from "@/lib/commands";

/** What site.status returns (src/server/commands/sites.ts). */
interface Version { n: number; site: "live" | "staging"; kind: string; state: string; by: string; at: string; note: string | null; current: boolean; fromVersion: number | null; rebuildable: boolean; error: string | null; files: number }
interface Status {
  name: string; urls: { live: string; staging: string }; liveVersion: number | null; stagingVersion: number | null;
  changes: { path: string; change: string }[]; stagingChanges: { path: string; change: string }[];
  showsChanged: { live: boolean; staging: boolean }; autoRefresh: boolean; refreshPaused: { live: boolean; staging: boolean };
  publishing: boolean; checkedAt: string | null; lastError: string | null; pages: { path: string; url: string }[]; versions: Version[];
}
type View = "draft" | "staging" | "live";

const KIND: Record<string, string> = { publish: "Publish", promote: "Promote staging", rollback: "Roll back", refresh: "Data refresh (shows changed)", reconcile: "Released outside Roadie" };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const pageLabel = (p: string) => (p === "index.html" ? "Home" : p.replace(/\.html$/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));

export default function WebsitePage() { return <AdminOnly><WebsiteBody /></AdminOnly>; }

/**
 * The Website section (docs/designs/sites, Decision 8): the preview with a page picker, Draft / Staging / Live and Desktop /
 * Phone switches; "N changes not published", Publish to staging, Publish and Promote; History with View and Roll back. Editing is
 * Roadie's chat (the panel beside the page): ask it to change a page and the preview updates.
 */
function WebsiteBody() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [page, setPage] = useState("index.html");
  const [view, setView] = useState<View>("draft");
  const [phone, setPhone] = useState(false);
  const [viewN, setViewN] = useState<number | null>(null);
  const [html, setHtml] = useState<string>("");
  const [confirm, setConfirm] = useState<null | { kind: "staging" | "live" | "promote" } | { kind: "rollback"; v: Version }>(null);
  const [note, setNote] = useState("");
  const [history, setHistory] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const cmd = useCommand();

  const load = useCallback(async () => {
    try { setStatus(await runCommand<Status>("site.status", {})); setLoadErr(null); } catch (e) { setLoadErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const n = viewN ?? (view === "live" ? status?.liveVersion : view === "staging" ? status?.stagingVersion : null) ?? null;
  const previewKey = `${page}|${view}|${n ?? "draft"}`;
  const loadPreview = useCallback(async () => {
    if (view !== "draft" && !n && viewN === null) { setHtml(""); return; }
    try {
      const r = await runCommand<{ html: string }>("site.preview", { path: page, ...(view !== "draft" || viewN ? { n: n ?? undefined } : {}) });
      setHtml(r.html);
    } catch (e) { setHtml(`<p style="font:14px system-ui;padding:2rem;color:#666">${String((e as Error).message).replace(/</g, "&lt;")}</p>`); }
  }, [page, view, n, viewN]);
  useEffect(() => { void loadPreview(); }, [previewKey, loadPreview]);

  // Roadie edits the draft from the chat panel: keep the preview and the change count current while the page is open.
  useEffect(() => {
    if (view !== "draft" || viewN) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") { void loadPreview(); void load(); } }, 4000);
    const f = () => { void loadPreview(); void load(); };
    window.addEventListener("focus", f);
    return () => { clearInterval(t); window.removeEventListener("focus", f); };
  }, [view, viewN, loadPreview, load]);

  const pages = useMemo(() => status?.pages ?? [], [status]);

  async function act() {
    if (!confirm) return;
    let r: { n?: number } | undefined;
    if (confirm.kind === "rollback") r = await cmd.call("site.rollback", { site: confirm.v.site, n: confirm.v.n });
    else if (confirm.kind === "promote") r = await cmd.call("site.promote", note ? { note } : {});
    else r = await cmd.call("site.publish", { site: confirm.kind, ...(note ? { note } : {}) });
    if (r) {
      setDone(confirm.kind === "rollback" ? `Version ${r.n} rolls ${confirm.v.site} back to version ${confirm.v.n}.` : `Version ${r.n} is live on ${confirm.kind === "staging" ? "staging" : "the live site"}.`);
      setConfirm(null); setNote(""); await load(); await loadPreview();
    }
  }

  if (loadErr) return <div className="grid gap-5"><PageTitle title="Website" /><div className="err" role="alert">{loadErr}</div></div>;
  if (!status) return <div className="grid gap-5"><PageTitle title="Website" /><p className="s">Loading…</p></div>;

  const changes = status.changes.length;
  const viewing = viewN ? status.versions.find((v) => v.n === viewN) : undefined;
  return (
    <div className="grid gap-4" data-testid="website">
      <PageTitle
        title="Website"
        sub={<>
          <a href={status.urls.live} target="_blank" rel="noopener" data-testid="site-live-url">{status.urls.live.replace(/^https:\/\//, "")}</a>
          {" · staging "}<a href={status.urls.staging} target="_blank" rel="noopener" data-testid="site-staging-url">{status.urls.staging.replace(/^https:\/\//, "")}</a>
        </>}
        actions={<>
          <button type="button" className="btn ghost" data-testid="site-history" onClick={() => setHistory(true)}>History</button>
          <button type="button" className="btn ghost" data-testid="site-publish-staging" disabled={status.publishing} onClick={() => setConfirm({ kind: "staging" })}>Publish to staging</button>
          {status.stagingVersion && <button type="button" className="btn ghost" data-testid="site-promote" disabled={status.publishing} onClick={() => setConfirm({ kind: "promote" })}>Promote staging</button>}
          <button type="button" className="btn acc" data-testid="site-publish" disabled={status.publishing} onClick={() => setConfirm({ kind: "live" })}>Publish</button>
        </>}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid="site-state">
        <span data-testid="site-changes">{changes ? `${changes} change${changes === 1 ? "" : "s"} not published` : status.liveVersion ? "Live matches the draft" : "Not published yet"}</span>
        {status.showsChanged.live && !status.autoRefresh && <span className="text-muted">Shows changed since the last publish</span>}
        {status.refreshPaused.live && <span className="text-muted" data-testid="site-paused">Shows aren&apos;t updating after a rollback; publish to resume</span>}
        {status.publishing && <span className="text-muted">Publishing…</span>}
        {status.lastError && <span className="text-muted">Last check: {status.lastError}</span>}
      </div>
      {done && <div className="ok" role="status" data-testid="site-done">{done}</div>}
      <ErrorBox error={cmd.error} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Pages">
          {pages.map((p) => (
            <button key={p.path} type="button" role="tab" aria-selected={page === p.path} className={`pick`} aria-pressed={page === p.path} data-testid={`site-page-${p.path.replace(/\.html$/, "")}`} onClick={() => setPage(p.path)}>{pageLabel(p.path)}</button>
          ))}
        </div>
        <span className="ml-auto flex gap-1" role="group" aria-label="Version">
          {(["draft", "staging", "live"] as const).map((v) => (
            <button key={v} type="button" className="pick" aria-pressed={view === v && !viewN} data-testid={`site-view-${v}`} onClick={() => { setView(v); setViewN(null); }}>{v[0].toUpperCase() + v.slice(1)}</button>
          ))}
        </span>
        <span className="flex gap-1" role="group" aria-label="Width">
          <button type="button" className="pick" aria-pressed={!phone} onClick={() => setPhone(false)}>Desktop</button>
          <button type="button" className="pick" aria-pressed={phone} data-testid="site-phone" onClick={() => setPhone(true)}>Phone</button>
        </span>
      </div>
      {viewing && <div className="text-sm" data-testid="site-viewing">Viewing version {viewing.n} ({viewing.site}) · <button type="button" className="btn text" onClick={() => setViewN(null)}>Back to the {view}</button></div>}
      {view !== "draft" && !n && !viewN
        ? <p className="s" data-testid="site-empty">Nothing is published to {view} yet.</p>
        : <div className="rounded-lg border border-border bg-white" style={{ height: "70vh", maxWidth: phone ? 390 : "100%", margin: phone ? "0 auto" : undefined, width: "100%" }}>
            <iframe title="Website preview" data-testid="site-preview" sandbox="allow-popups" srcDoc={html} style={{ width: "100%", height: "100%", border: 0, borderRadius: 8 }} />
          </div>}
      <p className="s">Ask Roadie to change the site (&ldquo;make the bio shorter&rdquo;, &ldquo;put the next three shows on the home page&rdquo;): it edits the draft, and nothing goes public until you publish.</p>

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.kind === "rollback" ? `Roll back to version ${confirm.v.n}?` : confirm?.kind === "promote" ? "Promote staging to the live site?" : confirm?.kind === "staging" ? "Publish the draft to staging?" : "Publish the draft to the live site?"} testid="site-confirm">
        {confirm && confirm.kind !== "rollback" && confirm.kind !== "promote" && (
          <div className="grid gap-1 text-sm">
            {(confirm.kind === "staging" ? status.stagingChanges : status.changes).length
              ? <><span>Changed files:</span><ul className="list-disc pl-5">{(confirm.kind === "staging" ? status.stagingChanges : status.changes).map((c) => <li key={c.path}>{c.path} <span className="text-muted">({c.change})</span></li>)}</ul></>
              : <span className="text-muted">No file changes; the show list is rendered fresh.</span>}
          </div>
        )}
        {confirm?.kind === "promote" && <p className="text-sm">The live site gets what staging serves (version {status.stagingVersion}){status.showsChanged.staging ? ". Shows have changed since staging was published; live gets today's list." : "."}</p>}
        {confirm?.kind === "rollback" && <p className="text-sm">The {confirm.v.site} site serves version {confirm.v.n} again. Shows stop updating there until the next publish.</p>}
        {confirm && confirm.kind !== "rollback" && <label className="grid gap-1 text-sm">Note (optional)<input className="input" value={note} onChange={(e) => setNote(e.target.value)} data-testid="site-note" /></label>}
        <ErrorBox error={cmd.error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn text" onClick={() => setConfirm(null)}>Cancel</button>
          <button type="button" className="btn acc" disabled={cmd.busy} data-testid="site-confirm-go" onClick={() => void act()}>{cmd.busy ? "Publishing…" : confirm?.kind === "rollback" ? "Roll back" : "Publish"}</button>
        </div>
      </Dialog>

      <Dialog open={history} onClose={() => setHistory(false)} title="History" testid="site-history-dialog">
        {status.versions.length === 0 ? <p className="s">Nothing published yet.</p> : (
          <ul className="grid gap-2" data-testid="site-versions">
            {status.versions.map((v) => (
              <li key={v.n} className="flex flex-wrap items-baseline gap-x-2 border-b border-divider pb-2 text-sm" data-testid={`site-version-${v.n}`}>
                <b>{v.n}</b><span>{v.site === "live" ? "Live" : "Staging"}</span><span>{KIND[v.kind] ?? v.kind}{v.fromVersion ? ` (from ${v.fromVersion})` : ""}</span>
                <span className="text-muted">{v.by === "system" ? "Roadie" : "you or a bandmate"} · {when(v.at)}</span>
                {v.current && <span className="pill">current</span>}
                {v.state !== "done" && <span className="text-muted">{v.state}{v.error ? `: ${v.error}` : ""}</span>}
                {v.note && <span className="w-full text-muted">{v.note}</span>}
                <span className="ml-auto flex gap-1">
                  {v.rebuildable && <button type="button" className="btn text" data-testid={`site-view-version-${v.n}`} onClick={() => { setViewN(v.n); setView(v.site); setHistory(false); }}>View</button>}
                  {v.state === "done" && !v.current && <button type="button" className="btn text" data-testid={`site-rollback-${v.n}`} onClick={() => { setHistory(false); setConfirm({ kind: "rollback", v }); }}>Roll back</button>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end"><button type="button" className="btn text" onClick={() => setHistory(false)}>Close</button></div>
      </Dialog>
    </div>
  );
}
