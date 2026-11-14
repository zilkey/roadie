"use client";
import { useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { kindOf } from "@/lib/shows";
import Link, { useMaybeArtist } from "@/lib/artist";
import { bandsintownNewEventUrl } from "@/lib/bandsintown";
import { bandsintownItemOf } from "@/components/shows/checklists/BandsintownLink";
import type { ShowRow } from "../common";
import { InlineValue, PlusButton } from "@/components/InlineValue";
import { ShowCard } from "./kit";

type Doc = ShowRow["docs"][number];
const wire = (docs: Doc[]) => docs.map((d) => ({ title: d.title, driveFileId: d.driveFileId ?? "", url: d.url }));

/** Promotion, with no flip: the ticket link is a value; Bandsintown (Open Bandsintown, and the show's "Add to Bandsintown" to-do); docs as a list with a plus. */
export function PromotionCard({ show, admin }: { show: ShowRow; admin: boolean }) {
  const { call, error, busy } = useCommand();
  const ticket = useCommand();
  const docsCmd = useCommand();
  const bandsintownUrl = bandsintownNewEventUrl(useMaybeArtist()?.doc?.bandsintown?.artistId);
  const [adding, setAdding] = useState(false);
  const [nt, setNt] = useState(""); const [nu, setNu] = useState("");

  const bit = bandsintownItemOf(show.checklists ?? []);
  const listed = !!bit?.item.done;
  const isHouse = kindOf(show) === "house";
  const detail = bit ? (listed ? "On Bandsintown." : "Add it on Bandsintown for Artists, then tick it here or in the Promotion checklist.")
    : isHouse ? "Private events don't go on Bandsintown."
    : show.status === "hold" ? "Once the show is confirmed it gets an \"Add to Bandsintown\" to-do."
    : "Not on the show's checklists.";
  const mark = (done: boolean) => bit && call("checklists.check", { kind: "show", id: show.id, listId: bit.listId, itemId: bit.item.id, done });
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
        <div className="grid gap-1" data-testid="bit">
          <div className="flex items-center justify-between gap-2">
            <b className="text-[0.9375rem]">Bandsintown</b>
            {bit && <span className={`chip ${listed ? "g" : ""}`} data-testid="bit-state">{listed ? "Listed" : "Not listed yet"}</span>}
          </div>
          <span className="s" data-testid="bit-detail">{detail}</span>
          {admin && (
            <div className="flex flex-wrap items-center gap-2">
              {bandsintownUrl
                ? <a href={bandsintownUrl} target="_blank" rel="noopener noreferrer" className={`btn sm ${bit && !listed ? "acc" : "outline"}`} data-testid="bit-open">Open Bandsintown ↗</a>
                : <Link href="/admin/artist#bandsintown" className="btn outline sm" data-testid="bit-setup">Set up Bandsintown</Link>}
              {bit && !listed && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void mark(true)} data-testid="bit-mark">Mark as listed</button>}
              {listed && bit?.item.eventUrl && <a href={bit.item.eventUrl} target="_blank" rel="noopener noreferrer" className="btn ghost sm" data-testid="bit-listing">See the listing ↗</a>}
            </div>
          )}
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
          {!show.docs.length && !adding && <span className="s" data-testid="docs-none">No docs yet</span>}
          {adding && (
            <div className="flex flex-wrap gap-2" data-testid="doc-add-row">
              <input className="input !w-auto min-w-0 flex-1" aria-label="Doc title" placeholder="Title" autoFocus value={nt} onChange={(e) => setNt(e.target.value)}
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
