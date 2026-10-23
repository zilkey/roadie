"use client";
import { useRef, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { CATEGORY_LABEL, dollarsToCents, formatCents, splitEvenly, indexLedger, netOf, type LedgerLike } from "@/lib/money";
import type { Show, ShowDeal, Musician } from "@/schema";

const LINES = [["door", "Tickets / door"], ["guarantee", "Guarantee"], ["merch", "Merch"], ["tips", "Cash tips"], ["venmo", "Venmo"]] as const;
type Cat = (typeof LINES)[number][0];
const cents = (s: string) => (s.trim() === "" || isNaN(Number(s)) ? 0 : dollarsToCents(s));

/** After the show: money in, then proposed payouts to the people who played. Saving settles the show. */
export function EnterMoney({ show, deal }: { show: Row<Show>; deal: Row<ShowDeal> | null }) {
  const musicians = useCollection<Musician>("musicians");
  const ledger = useCollection<LedgerLike>("ledger", { where: [["showId", "==", show.id]] });
  const { call, error, busy } = useCommand();
  // shows.settle is a one-shot action: the button stays, what has been typed so far is a draft for this show.
  const draft = useDraft("settlement", show.id, {
    inc: { door: "", guarantee: deal?.guarantee ? String(deal.guarantee / 100) : "", merch: "", tips: "", venmo: "" } as Record<Cat, string>,
    pay: null as Record<string, string> | null, skip: {} as Record<string, boolean>, unpaid: {} as Record<string, boolean>,
  }, { title: () => `Settle show · ${show.venue.name} · ${show.date}` });
  const { inc, pay, skip, unpaid } = draft.value;
  const setInc = (v: Record<Cat, string>) => draft.setValue({ ...draft.value, inc: v });
  const setPay = (v: Record<string, string> | null) => draft.setValue({ ...draft.value, pay: v });
  const setSkip = (v: Record<string, boolean>) => draft.setValue({ ...draft.value, skip: v });
  const setUnpaid = (v: Record<string, boolean>) => draft.setValue({ ...draft.value, unpaid: v });
  const mutationId = useRef(newMutationId());
  const [done, setDone] = useState(false);

  const total = LINES.reduce((n, [k]) => n + cents(inc[k]), 0);
  const people = show.personnel.map((id) => musicians.rows?.find((m) => m.id === id)).filter((m): m is Row<Musician> => !!m);
  const proposed = Object.fromEntries(people.map((m, i) => [m.id, (splitEvenly(total, people.length)[i] / 100).toFixed(2)]));
  const amounts = pay ?? proposed;
  const payTotal = people.reduce((n, m) => n + (skip[m.id] ? 0 : cents(amounts[m.id] ?? "")), 0);
  const over = payTotal > total;

  if (deal?.settled || done) {
    const rows = ledger.rows ?? [];
    const by = indexLedger(rows);
    return (
      <div className="card" data-testid="money-step">
        <span className="lbl">Money</span>
        <span className="chip g self-start" data-testid="settled">Entered</span>
        {rows.map((e) => (
          <div key={e.id} className="flex justify-between text-sm"><span>{e.kind === "income" ? CATEGORY_LABEL[e.category] : e.kind === "payout" ? `Paid ${musicians.rows?.find((m) => m.id === e.payeeMusicianId)?.name ?? "someone"}` : e.kind}</span><span className="font-mono">{formatCents(netOf(e, by))}</span></div>
        ))}
        {(deal?.owedPayouts ?? []).length > 0 && <span className="s">Still owed: {deal!.owedPayouts!.map((o) => `${musicians.rows?.find((m) => m.id === o.musicianId)?.name ?? "?"} ${formatCents(o.amount)}`).join(", ")}</span>}
      </div>
    );
  }

  async function save() {
    await draft.settle();
    const income = LINES.filter(([k]) => cents(inc[k]) > 0).map(([k]) => ({ category: k, amount: cents(inc[k]) }));
    const payouts = people.filter((m) => !skip[m.id] && cents(amounts[m.id] ?? "") > 0).map((m) => ({ musicianId: m.id, amount: cents(amounts[m.id]), paid: !unpaid[m.id] }));
    const r = await call("shows.settle", { id: show.id, income, payouts }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (r) { setDone(true); await draft.clear(); }
  }

  if (!draft.ready) return <div className="card" data-testid="money-step"><span className="s">Loading…</span></div>;
  return (
    <div className="card" data-testid="money-step">
      <span className="lbl">Money in</span>
      {LINES.map(([k, label]) => (
        <label key={k} className="flex items-center justify-between gap-3"><span>{label}</span>
          <input className="input !w-32 text-right font-mono" inputMode="decimal" placeholder="$0" value={inc[k]} data-testid={`income-${k}`} onChange={(e) => setInc({ ...inc, [k]: e.target.value })} /></label>
      ))}
      <div className="flex justify-between border-t border-line pt-2"><b>Total</b><b className="font-mono" data-testid="income-total">{formatCents(total)}</b></div>

      <span className="lbl mt-2">Pay the band</span>
      <span className="s">Split evenly between the {people.length} who played. Change any amount, untick anyone you are not paying, or mark it owed to pay later.</span>
      {people.map((m) => (
        <div key={m.id} className="flex items-center gap-2" data-testid={`payout-row-${m.id}`}>
          <input type="checkbox" aria-label={`Pay ${m.name}`} checked={!skip[m.id]} onChange={(e) => setSkip({ ...skip, [m.id]: !e.target.checked })} />
          <span className="grow">{m.name}</span>
          <label className="s flex items-center gap-1"><input type="checkbox" checked={!!unpaid[m.id]} onChange={(e) => setUnpaid({ ...unpaid, [m.id]: e.target.checked })} />owed</label>
          <input className="input !w-28 text-right font-mono" inputMode="decimal" value={amounts[m.id] ?? ""} disabled={!!skip[m.id]} data-testid={`payout-${m.id}`}
            onChange={(e) => setPay({ ...amounts, [m.id]: e.target.value })} />
        </div>
      ))}
      <div className="flex justify-between"><span>Left for the band</span><b className={`font-mono ${over ? "text-accent" : ""}`} data-testid="left-over">{formatCents(total - payTotal)}</b></div>
      {over && <div className="err">Payouts are more than the money in.</div>}
      <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
      <ErrorBox error={error} />
      <button className="btn acc" disabled={busy || total <= 0 || over} onClick={save} data-testid="enter-money">Save money</button>
    </div>
  );
}
