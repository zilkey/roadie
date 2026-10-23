"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { BackLink } from "@/components/booking/common";
import { useCollection } from "@/lib/firestore-hooks";
import { CATEGORY_LABEL, dollarsToCents } from "@/lib/money";
import { fmtLong } from "@/lib/shows";
import type { Show } from "@/schema";

const CATS = ["gear", "travel", "space", "marketing", "fees", "other"] as const;
interface Hit { driveFileId: string; name: string; url: string }
const fileIdOf = (url: string) => /\/d\/([\w-]+)/.exec(url)?.[1] ?? /[?&]id=([\w-]+)/.exec(url)?.[1] ?? url.replace(/\W+/g, "").slice(-24);

export default function Page() { return <Suspense><AddExpense /></Suspense>; }

function AddExpense() {
  const router = useRouter();
  const sp = useSearchParams();
  const shows = useCollection<Show>("shows");
  const { call, error, busy } = useCommand();
  const [amount, setAmount] = useState("");
  const [what, setWhat] = useState("");
  const [cat, setCat] = useState<(typeof CATS)[number]>("gear");
  const [showId, setShowId] = useState(sp.get("show") ?? "");
  const [link, setLink] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const search = useCommand();
  const cents = amount.trim() && !isNaN(Number(amount)) ? dollarsToCents(amount) : 0;
  const sorted = [...(shows.rows ?? [])].filter((s) => s.status !== "canceled").sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30);

  async function find() {
    const r = await search.call<{ files: Hit[] }>("receipts.search", { q: q.trim() });
    if (r) setHits(r.files);
  }
  async function send() {
    const url = link.trim();
    const r = await call("expenses.add", {
      amount: cents, what: what.trim(), category: cat, ...(showId ? { showId } : {}),
      ...(url ? { receipt: { driveFileId: fileIdOf(url), url } } : {}),
    });
    if (r) router.push("/money");
  }
  return (
    <div className="grid max-w-xl gap-3" data-testid="add-expense">
      <BackLink href="/money" label="My money" />
      <PageTitle title="Add an expense" />
      <div className="card">
        <label className="grid gap-1"><span className="lbl">How much</span>
          <input className="input font-mono" inputMode="decimal" placeholder="$0.00" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="expense-amount" /></label>
        <span className="lbl">What for</span>
        <div className="flex flex-wrap gap-1.5" role="group">
          {CATS.map((c) => <button key={c} type="button" aria-pressed={cat === c} data-testid={`expense-cat-${c}`} onClick={() => setCat(c)} className={`btn sm ${cat === c ? "acc" : "ghost"}`}>{CATEGORY_LABEL[c]}</button>)}
        </div>
        <input className="input" placeholder="Drum heads" value={what} onChange={(e) => setWhat(e.target.value)} data-testid="expense-what" />
        <label className="grid gap-1"><span className="lbl">For a show?</span>
          <select className="select" value={showId} onChange={(e) => setShowId(e.target.value)} data-testid="expense-show">
            <option value="">Pick a show (optional)</option>
            {sorted.map((s) => <option key={s.id} value={s.id}>{fmtLong(s.date)} · {s.venue.name}</option>)}
          </select></label>
        <span className="lbl">Receipt</span>
        <input className="input" placeholder="Paste a Drive link" value={link} onChange={(e) => setLink(e.target.value)} data-testid="expense-receipt" />
        <div className="flex gap-2">
          <input className="input" placeholder="…or search Drive" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && q.trim() && find()} data-testid="receipt-search" />
          <button type="button" className="btn ghost" disabled={!q.trim() || search.busy} onClick={find} data-testid="receipt-search-go">Search</button>
        </div>
        <ErrorBox error={search.error} />
        {hits && hits.length === 0 && <span className="s">No files found.</span>}
        {hits?.map((h) => (
          <button key={h.driveFileId} type="button" className="btn ghost sm justify-start" onClick={() => { setLink(h.url); setHits(null); }} data-testid={`receipt-hit-${h.driveFileId}`}>{h.name}</button>
        ))}
        <span className="s">You can't change it after sending. Ask Jeff or Ingrid to fix mistakes.</span>
        <ErrorBox error={error} />
        <button className="btn acc" disabled={busy || cents <= 0 || !what.trim()} onClick={send} data-testid="expense-send">Send</button>
      </div>
    </div>
  );
}
