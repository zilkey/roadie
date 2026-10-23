"use client";
import { draftPath } from "@/schema/drafts";
import Link from "@/lib/artist";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { BackLink, useNotFound } from "@/components/booking/common";
import { useDoc, type Row } from "@/lib/firestore-hooks";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { fmtLong, showName } from "@/lib/shows";
import { EnterMoney } from "@/components/money/EnterMoney";
import type { Show, ShowDeal } from "@/schema";

export default function Page() { return <AdminOnly><After /></AdminOnly>; }

function Stars({ label, value, onChange, testid }: { label: string; value: number; onChange(n: number): void; testid: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="flex gap-1" role="group" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" aria-pressed={value === n} aria-label={`${n} of 5`} data-testid={`${testid}-${n}`} onClick={() => onChange(n)}
            className={`text-2xl leading-none ${n <= value ? "text-accent" : "text-muted"}`}>{n <= value ? "★" : "☆"}</button>
        ))}
      </span>
    </div>
  );
}

function After() {
  const { id } = useParams<{ id: string }>();
  const show = useDoc<Show>("shows", id);
  const deal = useDoc<ShowDeal>("showDeals", id);
  const nf = useNotFound(show.loading, show.doc, "show");
  if (nf || !show.doc) return nf;
  if (deal.loading) return null;
  return <AfterForm id={id} show={show.doc} deal={deal.doc} />;
}

interface Rating { show: number; venue: number; crowd: string; paid: string; notes: string }

/** shows.afterShow is a one-shot action (marks the show played, syncs listings): the button stays, the answers are a draft per show. */
function AfterForm({ id, show, deal }: { id: string; show: Row<Show>; deal: Row<ShowDeal> | null }) {
  const { call, error, busy } = useCommand();
  const r = deal?.rating;
  const blank: Rating = { show: r?.show ?? 0, venue: r?.venue ?? 0, crowd: r?.crowd != null ? String(r.crowd) : "", paid: deal?.paidAttendance != null ? String(deal.paidAttendance) : "", notes: r?.notes ?? "" };
  const draft = useDraft(draftPath.newUnder("shows", id, "after"), blank, { title: () => `How'd it go? · ${showName(show)}` });
  const mutationId = useRef(newMutationId());
  const [saved, setSaved] = useState(false);
  const v = draft.value;
  const set = (p: Partial<Rating>) => { setSaved(false); draft.setValue({ ...v, ...p }); };
  async function save() {
    await draft.settle();
    const ok = await call("shows.afterShow", {
      id, show: v.show, venue: v.venue, ...(v.crowd ? { crowd: Number(v.crowd) } : {}), ...(v.paid ? { paidAttendance: Number(v.paid) } : {}), ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
    }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (ok) { setSaved(true); mutationId.current = newMutationId(); await draft.clear(); }
  }
  const rated = saved || !!r;
  return (
    <div className="grid gap-3" data-testid="after-page">
      <BackLink href={`/shows/${id}`} label={showName(show)} />
      <PageTitle title="How'd it go?" sub={`${showName(show)} · ${fmtLong(show.date)}`} />
      <ErrorBox error={error} />
      {!draft.ready ? <span className="s">Loading…</span> : (
        <div className="card">
          <Stars label="The show" value={v.show} onChange={(n) => set({ show: n })} testid="rate-show" />
          <Stars label="The venue" value={v.venue} onChange={(n) => set({ venue: n })} testid="rate-venue" />
          <label className="grid gap-1"><span className="lbl">Crowd (about how many)</span>
            <input className="input" type="number" min={0} value={v.crowd} onChange={(e) => set({ crowd: e.target.value })} data-testid="rate-crowd" /></label>
          <label className="grid gap-1"><span className="lbl">Paid attendance</span>
            <input className="input" type="number" min={0} value={v.paid} onChange={(e) => set({ paid: e.target.value })} data-testid="rate-paid" /></label>
          <textarea className="input" rows={3} placeholder="Notes for next time…" value={v.notes} onChange={(e) => set({ notes: e.target.value })} data-testid="rate-notes" />
          <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
          <button className="btn acc" disabled={busy || !v.show || !v.venue} onClick={save} data-testid="rate-save">Save</button>
          {saved && <span className="chip g self-start" data-testid="rate-saved">Saved</span>}
        </div>
      )}
      <EnterMoney show={show} deal={deal} />
      {rated && <Link href={`/shows/${id}`} className="s font-semibold underline">Back to the show</Link>}
    </div>
  );
}
