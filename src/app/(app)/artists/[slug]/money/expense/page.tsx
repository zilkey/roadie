"use client";
import { draftPath } from "@/schema/drafts";
import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { ErrorBox, PageTitle, Select, useCommand } from "@/components/ui";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { useCollection } from "@/lib/firestore-hooks";
import { CATEGORY_LABEL, dollarsToCents } from "@/lib/money";
import { fmtLong, showName } from "@/lib/shows";
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
  // A new expense is a draft with an explicit Send button (expenses can't be edited once sent).
  const fromShow = sp.get("show") ?? "";
  const draft = useDraft(fromShow ? draftPath.newUnder("shows", fromShow, "expenses") : draftPath.newIn("expenses"), { amount: "", what: "", cat: "gear" as (typeof CATS)[number], showId: fromShow, link: "" },
    { title: (v) => `New expense · ${v.what || (v.amount ? `$${v.amount}` : "")}`.replace(/ · $/, "") });
  const mutationId = useRef(newMutationId());
  const { amount, what, cat, showId, link } = draft.value;
  const setAmount = (v: string) => draft.setValue({ ...draft.value, amount: v });
  const setWhat = (v: string) => draft.setValue({ ...draft.value, what: v });
  const setCat = (v: (typeof CATS)[number]) => draft.setValue({ ...draft.value, cat: v });
  const setShowId = (v: string) => draft.setValue({ ...draft.value, showId: v });
  const setLink = (v: string) => draft.setValue((d) => ({ ...d, link: v }));
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
    await draft.settle();
    const r = await call("expenses.add", {
      amount: cents, what: what.trim(), category: cat, ...(showId ? { showId } : {}),
      ...(url ? { receipt: { driveFileId: fileIdOf(url), url } } : {}),
    }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (r) { await draft.clear(); router.push("/money"); }
  }
  return (
    <div className="grid max-w-xl gap-5" data-testid="add-expense">
      <PageTitle back={<Link href="/money" className="back-link" data-testid="back">← My money</Link>} title="Add an expense" />
      {!draft.ready ? <span className="s">Loading…</span> : <div className="card">
        <label className="grid gap-1"><span className="lbl">How much</span>
          <input className="input font-mono" inputMode="decimal" placeholder="$0.00" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="expense-amount" /></label>
        <label className="grid gap-1"><span className="lbl">What for</span>
          <Select testid="expense-cat" value={cat} onChange={setCat} options={CATS.map((c) => [c, CATEGORY_LABEL[c]] as [typeof c, string])} />
        </label>
        <input className="input" placeholder="Drum heads" value={what} onChange={(e) => setWhat(e.target.value)} data-testid="expense-what" />
        <label className="grid gap-1"><span className="lbl">For a show?</span>
          <select className="select" value={showId} onChange={(e) => setShowId(e.target.value)} data-testid="expense-show">
            <option value="">Pick a show (optional)</option>
            {sorted.map((s) => <option key={s.id} value={s.id}>{fmtLong(s.date)} · {showName(s)}</option>)}
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
        <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
        <button className="btn acc" disabled={busy || cents <= 0 || !what.trim()} onClick={send} data-testid="expense-send">Send</button>
      </div>}
    </div>
  );
}
