"use client";
import { useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { fmtInstant } from "@/lib/timezone";
import { isPublished } from "@/lib/shows";
import type { ShowRow } from "../common";
import { EditableCard, useCardEdit } from "./kit";

type Doc = ShowRow["docs"][number];

/** Promotion: ticket link, Bandsintown (Publish puts the show on it), docs. */
export function PromotionCard({ show, admin }: { show: ShowRow; admin: boolean }) {
  const { call, error, busy, setError } = useCommand();
  const [ticket, setTicket] = useState(show.ticketUrl ?? "");
  const [docs, setDocs] = useState<Doc[]>(show.docs);
  const [nt, setNt] = useState(""); const [nu, setNu] = useState("");
  const [warn, setWarn] = useState<string[]>([]);
  const ed = useCardEdit({ canEdit: admin, onStart: () => { setTicket(show.ticketUrl ?? ""); setDocs(show.docs); setNt(""); setNu(""); setError(null); } });

  const bit = show.listings.bandsintown;
  const published = isPublished(show);
  const eligible = published && show.status === "confirmed";
  const when = bit?.syncedAt ? fmtInstant(bit.syncedAt) : "";
  const detail = bit?.state === "listed" ? `Last synced ${when}`
    : bit?.state === "error" ? `${bit.error ?? "Sync failed"}${when ? ` · ${when}` : ""}`
    : bit?.state === "pending" ? "Waiting to sync."
    : eligible ? "Waiting to sync." : !published ? "Not published." : show.status === "hold" ? "Published: it lists once the show is confirmed." : "Only confirmed shows are listed.";

  async function save() {
    const patch: Record<string, unknown> = {};
    const t = ticket.trim();
    if (t !== (show.ticketUrl ?? "")) patch.ticketUrl = t || null;
    const all = nt.trim() && nu.trim() ? [...docs, { title: nt.trim(), driveFileId: "", url: nu.trim() }] : docs;
    if (JSON.stringify(all) !== JSON.stringify(show.docs)) patch.docs = all.map((d) => ({ title: d.title, driveFileId: d.driveFileId ?? "", url: d.url }));
    if (!Object.keys(patch).length) return true;
    return !!(await call("shows.update", { id: show.id, patch }));
  }
  async function publish(on: boolean) { const r = await call<{ warnings: string[] }>("shows.update", { id: show.id, patch: { publishToBandsintown: on } }); if (r) setWarn(r.warnings ?? []); }
  async function sync() { const r = await call<{ warnings: string[] }>("shows.sync", { id: show.id }); if (r) setWarn(r.warnings ?? []); }

  const addable = nt.trim() && nu.trim();

  return (
    <EditableCard title="Promotion" testid="promotion" ed={ed} onSave={save} busy={busy} error={error}>
      {ed.editing ? (
        <div className="grid gap-4">
          <div className="grid gap-2">
            <label className="lbl" htmlFor={`ticket-${show.id}`}>Ticket link</label>
            <input id={`ticket-${show.id}`} className="input" type="url" placeholder="https://" value={ticket} onChange={(e) => setTicket(e.target.value)} data-testid="ticket-url" />
          </div>
          <div className="grid gap-2">
            <span className="lbl">Docs</span>
            {docs.map((d, i) => (
              <div key={d.url + i} className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold">{d.title}</span>
                <button type="button" className="btn danger sm" onClick={() => setDocs(docs.filter((_, j) => j !== i))} data-testid="doc-remove">Remove</button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <input className="input !w-auto min-w-0 flex-1" aria-label="Doc title" placeholder="Title (stage plot, poster…)" value={nt} onChange={(e) => setNt(e.target.value)} data-testid="doc-title" />
              <input className="input !w-auto min-w-0 flex-1" aria-label="Doc link" type="url" placeholder="Link" value={nu} onChange={(e) => setNu(e.target.value)} data-testid="doc-url" />
              <button type="button" className="btn ghost" disabled={!addable} data-testid="doc-add"
                onClick={() => { setDocs([...docs, { title: nt.trim(), driveFileId: "", url: nu.trim() }]); setNt(""); setNu(""); }}>Add</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4" data-testid="promotion-view">
              <div className="grid gap-1">
                <span className="lbl">Ticket link</span>
                {show.ticketUrl ? <a href={show.ticketUrl} target="_blank" rel="noreferrer" className="break-all text-[15px] font-semibold underline" data-testid="ticket-link">{show.ticketUrl}</a> : <span className="s" data-testid="ticket-none">No ticket link yet</span>}
              </div>
              <div className="grid gap-1">
                <div className="flex items-center justify-between gap-2">
                  <b className="text-[15px]">Bandsintown</b>
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
                <ErrorBox error={ed.editing ? null : error} />
              </div>
            <div className="grid gap-1">
              <span className="lbl">Docs</span>
              {show.docs.length ? show.docs.map((d, i) => (
                <a key={d.url + i} href={d.url} target="_blank" rel="noreferrer" className="text-[15px] font-semibold underline" data-testid="doc-link">{d.title}</a>
              )) : <span className="s" data-testid="docs-none">Stage plot, poster, etc.</span>}
            </div>
        </div>
      )}
    </EditableCard>
  );
}
