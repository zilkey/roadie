"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { BackLink, useNotFound } from "@/components/booking/common";
import { useDoc } from "@/lib/firestore-hooks";
import { fmtLong } from "@/lib/shows";
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
  const { call, error, busy } = useCommand();
  const [f, setF] = useState<{ show: number; venue: number; crowd: string; paid: string; notes: string } | null>(null);
  const [saved, setSaved] = useState(false);
  if (nf || !show.doc) return nf;
  if (deal.loading) return null;
  const r = deal.doc?.rating;
  const v = f ?? { show: r?.show ?? 0, venue: r?.venue ?? 0, crowd: r?.crowd != null ? String(r.crowd) : "", paid: deal.doc?.paidAttendance != null ? String(deal.doc.paidAttendance) : "", notes: r?.notes ?? "" };
  async function save() {
    const ok = await call("shows.afterShow", {
      id, show: v.show, venue: v.venue, ...(v.crowd ? { crowd: Number(v.crowd) } : {}), ...(v.paid ? { paidAttendance: Number(v.paid) } : {}), ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
    });
    if (ok) setSaved(true);
  }
  const rated = saved || !!r;
  return (
    <div className="grid gap-3" data-testid="after-page">
      <BackLink href={`/shows/${id}`} label={show.doc.venue.name} />
      <PageTitle title="How'd it go?" sub={`${show.doc.venue.name} · ${fmtLong(show.doc.date)}`} />
      <ErrorBox error={error} />
      <div className="card">
        <Stars label="The show" value={v.show} onChange={(n) => setF({ ...v, show: n })} testid="rate-show" />
        <Stars label="The venue" value={v.venue} onChange={(n) => setF({ ...v, venue: n })} testid="rate-venue" />
        <label className="grid gap-1"><span className="lbl">Crowd (about how many)</span>
          <input className="input" type="number" min={0} value={v.crowd} onChange={(e) => setF({ ...v, crowd: e.target.value })} data-testid="rate-crowd" /></label>
        <label className="grid gap-1"><span className="lbl">Paid attendance</span>
          <input className="input" type="number" min={0} value={v.paid} onChange={(e) => setF({ ...v, paid: e.target.value })} data-testid="rate-paid" /></label>
        <textarea className="input" rows={3} placeholder="Notes for next time…" value={v.notes} onChange={(e) => setF({ ...v, notes: e.target.value })} data-testid="rate-notes" />
        <button className="btn acc" disabled={busy || !v.show || !v.venue} onClick={save} data-testid="rate-save">Save</button>
        {saved && <span className="chip g self-start" data-testid="rate-saved">Saved</span>}
      </div>
      <EnterMoney show={show.doc} deal={deal.doc} />
      {rated && <Link href={`/shows/${id}`} className="s font-semibold underline">Back to the show</Link>}
    </div>
  );
}
