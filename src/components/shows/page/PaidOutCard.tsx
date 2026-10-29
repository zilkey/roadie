"use client";
import { useState } from "react";
import { useCollection } from "@/lib/firestore-hooks";
import { ErrorBox, useCommand } from "@/components/ui";
import { defaultProject, formatCents, METHOD_LABEL, parseDollars, showTotals, splitEvenly, type ExpenseLike, type IncomeLike, type PayoutLike, type ProjectLike } from "@/lib/money";
import { MoneyOutModal } from "@/components/money/MoneyOutModal";
import { useBand, type ShowRow } from "../common";
import { AdminOnlyBadge, ShowCard, UnfinishedPlaceholder } from "./kit";

const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
interface Proposal { key: string; name: string; to: { musicianId: string } | { userId: string }; amount: string }

/** Paid out (admins only): the payouts on this show, mark-paid, and a Split evenly helper (nothing about the rule is stored). */
export function PaidOutCard({ show }: { show: ShowRow }) {
  const where: [string, "==", string][] = [["showId", "==", show.id]];
  const payouts = useCollection<PayoutLike>("payouts", { where }).rows;
  const income = useCollection<IncomeLike>("income", { where }).rows ?? [];
  const expenses = useCollection<ExpenseLike>("expenses", { where }).rows ?? [];
  const projects = useCollection<ProjectLike>("projects").rows ?? [];
  const { musicians } = useBand();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<Proposal[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { call, busy, error, setError } = useCommand();
  const list = [...(payouts ?? [])].sort((a, b) => ((a.paidAt ?? a.dueDate ?? "9") < (b.paidAt ?? b.dueDate ?? "9") ? -1 : 1));
  const projectId = show.projectId ?? defaultProject(projects)?.id;

  function propose() {
    setError(null); setNote(null);
    const have = payouts ?? [];
    const missing = show.personnel.map((id) => musicians.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m)
      .filter((m) => !have.some((p) => p.kind === "pay" && (p.to.musicianId === m.id || (!!m.userId && p.to.userId === m.userId))));
    if (!missing.length) { setNote("Everyone playing already has pay on this show."); setPlan(null); return; }
    const net = showTotals({ income, payouts: have, expenses }).net;
    if (net <= 0) { setNote("Nothing left to split: money in doesn't cover what's already paid out and spent."); setPlan(null); return; }
    const amounts = splitEvenly(net, missing.length);
    setPlan(missing.map((m, i) => ({ key: m.id, name: m.name, to: m.userId ? { userId: m.userId } : { musicianId: m.id }, amount: (amounts[i]! / 100).toFixed(2) })));
  }
  async function addAll() {
    if (!plan) return;
    const parsed = plan.map((r) => parseDollars(r.amount));
    if (parsed.some((c) => !c)) { setError("Enter each amount like 100 or 100.50."); return; }
    for (const [i, r] of plan.entries()) {
      const ok = await call("payouts.add", { to: r.to, kind: "pay", amount: parsed[i], what: "for the show", showId: show.id, ...(projectId ? { projectId } : {}) });
      if (!ok) return;
    }
    setPlan(null);
  }

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn ghost" disabled={busy} onClick={propose} data-testid="split-evenly">Split evenly</button>
      <button type="button" className="btn ghost" onClick={() => setOpen(true)} data-testid="money-out-open">+ Money out</button>
    </div>
  );
  return (
    <ShowCard title="Paid out" testid="paid-out" badge={<AdminOnlyBadge />} aside={actions}>
      {payouts && list.length === 0 && !plan ? (
        <UnfinishedPlaceholder lead="Nobody paid yet." testid="paid-out-empty">Add what the band paid or owes with + Money out, or split the night.</UnfinishedPlaceholder>
      ) : (
        <div>
          {list.map((p) => {
            const why = p.what && p.kind !== "pay" ? p.what : p.kind === "pay" ? "for the show" : p.what ?? "";
            return (
              <div key={p.id} className="money-row" data-testid={`payout-row-${p.id}`}>
                <span>
                  {p.paidAt ? "We paid" : "We owe"} <b>{p.to.name}</b> {why}
                  {p.paidAt && <span className="s"> · {[p.method ? METHOD_LABEL[p.method] ?? p.method : null, shortDate(p.paidAt)].filter(Boolean).join(" · ")}</span>}
                </span>
                <span className="flex flex-wrap items-center justify-end gap-2">
                  <b>{formatCents(p.amount)}</b>
                  {p.paidAt ? <span className="pill ok" data-testid={`payout-status-${p.id}`}>Paid</span> : (
                    <>
                      <select className="select" style={{ width: 96 }} aria-label="How you paid" value={method[p.id] ?? p.method ?? "venmo"} onChange={(e) => setMethod((m) => ({ ...m, [p.id]: e.target.value }))} data-testid={`payout-method-${p.id}`}>
                        {Object.entries(METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                      <button type="button" className="btn outline sm" disabled={busy} onClick={() => void call("payouts.markPaid", { id: p.id, method: method[p.id] ?? p.method ?? "venmo" })} data-testid={`payout-mark-paid-${p.id}`}>Mark paid</button>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {note && <p className="s mt-2" data-testid="split-note">{note}</p>}
      {plan && (
        <div className="mt-3 grid gap-2 rounded-xl p-3" style={{ border: "1px solid var(--line)" }} data-testid="split-plan">
          <b>Split what's left evenly</b>
          {plan.map((r) => (
            <div key={r.key} className="money-row" data-testid="split-row">
              <span>We owe <b>{r.name}</b> for the show</span>
              <input className="input" style={{ width: 112 }} inputMode="decimal" aria-label={`Amount for ${r.name}`} value={r.amount}
                onChange={(e) => setPlan((pl) => pl && pl.map((x) => (x.key === r.key ? { ...x, amount: e.target.value } : x)))} data-testid="split-amount" />
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn outline" disabled={busy} onClick={() => { setPlan(null); setError(null); }} data-testid="split-cancel">Cancel</button>
            <button type="button" className="btn acc" disabled={busy} onClick={() => void addAll()} data-testid="split-add">Add payouts</button>
          </div>
        </div>
      )}
      <ErrorBox error={error} />
      <MoneyOutModal open={open} onClose={() => setOpen(false)} defaults={{ showId: show.id, projectId: show.projectId }} />
    </ShowCard>
  );
}
