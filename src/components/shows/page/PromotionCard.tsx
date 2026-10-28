"use client";
import { useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { fmtInstant } from "@/lib/timezone";
import { isPublished } from "@/lib/shows";
import type { ShowRow } from "../common";
import { InlineValue, PlusButton } from "@/components/InlineValue";
import { ShowCard } from "./kit";

type Doc = ShowRow["docs"][number];
const wire = (docs: Doc[]) => docs.map((d) => ({ title: d.title, driveFileId: d.driveFileId ?? "", url: d.url }));

/** Promotion, with no flip: the ticket link is a value, Bandsintown (Publish puts the show on it), docs as a list with a plus. */
export function PromotionCard({ show, admin }: { show: ShowRow; admin: boolean }) {
  const { call, error, busy } = useCommand();
  const ticket = useCommand();
  const docsCmd = useCommand();
  const [warn, setWarn] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [nt, setNt] = useState(""); const [nu, setNu] = useState("");

  const bit = show.listings.bandsintown;
  const published = isPublished(show);
  const eligible = published && show.status === "confirmed";
  const when = bit?.syncedAt ? fmtInstant(bit.syncedAt) : "";
  const detail = bit?.state === "listed" ? `Last synced ${when}`
    : bit?.state === "error" ? `${bit.error ?? "Sync failed"}${when ? ` · ${when}` : ""}`
    : bit?.state === "pending" ? "Waiting to sync."
    : eligible ? "Waiting to sync." : !published ? "Not published." : show.status === "hold" ? "Published: it lists once the show is confirmed." : "Only confirmed shows are listed.";

  async function publish(on: boolean) { const r = await call<{ warnings: string[] }>("shows.update", { id: show.id, patch: { publishToBandsintown: on } }); if (r) setWarn(r.warnings ?? []); }
  async function sync() { const r = await call<{ warnings: string[] }>("shows.sync", { id: show.id }); if (r) setWarn(r.warnings ?? []); }
  const saveDocs = (docs: Doc[]) => docsCmd.call("shows.update", { id: show.id, patch: { docs: wire(docs) } });
  async function addDoc() {
    if (!(nt.trim() && nu.trim())) return;
    if (await saveDocs([...show.docs, { title: nt.trim(), driveFileId: "", url: nu.trim() }])) { setNt(""); setNu(""); setAdding(false); }
  }
  const closeAdd = () => { setNt(""); setNu(""); setAdding(false); docsCmd.setError(null); };

  return (
    <ShowCard title="Promotion" testid="promotion">
      <div className="grid gap-4" data-testid="promotion-view">
        <div className="grid gap-1">
          <span className="lbl">Ticket link</span>
          {!admin && !show.ticketUrl ? <span className="s" data-testid="ticket-none">No ticket link yet</span> : (
            <InlineValue testid="ticket-url" label="Ticket link" kind="url" value={show.ticketUrl ?? ""} placeholder="https://" canEdit={admin}
              error={ticket.error} className="break-all"
              link={show.ticketUrl ? <a href={show.ticketUrl} target="_blank" rel="noreferrer" className="text-[0.9375rem] font-semibold underline" data-testid="ticket-link">{show.ticketUrl}</a> : undefined}
              onSave={async (v) => !!(await ticket.call("shows.update", { id: show.id, patch: { ticketUrl: v || null } }))} />
          )}
        </div>
        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-2">
            <b className="text-[0.9375rem]">Bandsintown</b>
            <span className={`chip ${bit?.state === "listed" ? "g" : bit?.state === "error" ? "a" : ""}`} data-testid="bit-state">
              {bit?.state === "listed" ? "Listed" : bit?.state === "error" ? "Error" : bit?.state === "pending" ? "Pending" : "Not listed"}
            </span>
          </div>
          <span className="s" data-testid="bit-detail">{detail}</span>
          {admin && (
            <div className="flex flex-wrap gap-2">
              {published
                ? <button type="button" className="btn outline sm" disabled={busy} onClick={() => void publish(false)} data-testid="bit-unpublish">Take off Bandsintown</button>
                : <button type="button" className="btn acc sm" disabled={busy} onClick={() => void publish(true)} data-testid="bit-publish">Publish to Bandsintown</button>}
              {eligible && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void sync()} data-testid="bit-sync">Sync Bandsintown now</button>}
            </div>
          )}
          {warn.map((w) => <span key={w} className="s">{w}</span>)}
          <ErrorBox error={error} />
        </div>
        <div className="grid gap-1">
          <div className="flex min-h-[44px] items-center justify-between gap-2">
            <span className="lbl">Docs</span>
            {admin && <PlusButton label="Add a doc" onClick={() => setAdding(true)} testid="doc-add" />}
          </div>
          {show.docs.map((d, i) => (
            <div key={d.url + i} className="doc-row flex min-h-[44px] items-center justify-between gap-2">
              <a href={d.url} target="_blank" rel="noreferrer" className="min-w-0 break-words text-[0.9375rem] font-semibold underline" data-testid="doc-link">{d.title}</a>
              {admin && (
                <button type="button" className="ib doc-x" aria-label={`Remove ${d.title}`} title={`Remove ${d.title}`} disabled={docsCmd.busy}
                  onClick={() => void saveDocs(show.docs.filter((_, j) => j !== i))} data-testid="doc-remove">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              )}
            </div>
          ))}
          {!show.docs.length && !adding && <span className="s" data-testid="docs-none">Stage plot, poster, etc.</span>}
          {adding && (
            <div className="flex flex-wrap gap-2" data-testid="doc-add-row">
              <input className="input !w-auto min-w-0 flex-1" aria-label="Doc title" placeholder="Title (stage plot, poster…)" autoFocus value={nt} onChange={(e) => setNt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") closeAdd(); }} data-testid="doc-title" />
              <input className="input !w-auto min-w-0 flex-1" aria-label="Doc link" type="url" placeholder="Link" value={nu} onChange={(e) => setNu(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void addDoc(); if (e.key === "Escape") closeAdd(); }} data-testid="doc-url" />
              <button type="button" className="btn acc" disabled={!(nt.trim() && nu.trim()) || docsCmd.busy} onClick={() => void addDoc()} data-testid="doc-add-confirm">Add</button>
              <button type="button" className="btn outline" onClick={closeAdd} data-testid="doc-add-cancel">Cancel</button>
            </div>
          )}
          <ErrorBox error={docsCmd.error} />
        </div>
      </div>
    </ShowCard>
  );
}
