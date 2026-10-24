"use client";
import { useRef, useState } from "react";
import { useDoc } from "@/lib/firestore-hooks";
import { useCommand } from "@/components/ui";
import { formatCents, INCOME_LABEL, METHOD_LABEL, parseDollars, sumIncome } from "@/lib/money";
import type { ShowDeal } from "@/schema/shows";
import type { ShowRow } from "../common";
import { AdminOnlyBadge, AutoGrowTextarea, EditableCard, UnfinishedPlaceholder, useCardEdit } from "./kit";

type Category = "guarantee" | "door" | "tips" | "merch" | "other";
type Method = "cash" | "venmo" | "check" | "square" | "card" | "bank" | "other";
interface Line { key: string; id?: string; category: Category; amount: string; method: Method | ""; received: boolean }

const CATEGORIES = Object.keys(INCOME_LABEL) as Category[];
const METHODS = Object.keys(METHOD_LABEL) as Method[];
const STARTERS: { label: string; category: Category; testid: string }[] = [
  { label: "Guarantee", category: "guarantee", testid: "income-start-guarantee" },
  { label: "Door split", category: "door", testid: "income-start-door" },
  { label: "Tips only", category: "tips", testid: "income-start-tips" },
];
let seq = 0;
const newKey = () => `n${++seq}`;
const blank = (category: Category = "guarantee"): Line => ({ key: newKey(), category, amount: "", method: "", received: false });
const dollars = (cents: number) => (cents / 100).toFixed(2);

/** Income (admins only): the lines on the show's deal, with a total and notes. */
export function IncomeCard({ show }: { show: ShowRow }) {
  const { doc: deal } = useDoc<ShowDeal>("showDeals", show.id);
  const income = deal?.income ?? [];
  const notes = deal?.incomeNotes ?? "";
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const starter = useRef<Category | null>(null);
  const { call, busy, error, setError } = useCommand();

  const ed = useCardEdit({
    canEdit: true,
    onStart: () => {
      const s = starter.current; starter.current = null;
      setLines(income.length ? income.map((l) => ({ key: newKey(), id: l.id, category: l.category, amount: dollars(l.amount), method: l.method ?? "", received: l.received })) : s ? [blank(s)] : []);
      setText(notes); setBad(false); setError(null);
    },
  });

  const patch = (key: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const parsed = lines.map((l) => parseDollars(l.amount));
  const total = parsed.reduce<number>((n, c) => n + (c ?? 0), 0);

  async function save() {
    if (parsed.some((c) => c === null)) { setBad(true); return false; }
    setBad(false);
    const r = await call("showDeals.setIncome", {
      id: show.id,
      income: lines.map((l, i) => ({ ...(l.id ? { id: l.id } : {}), category: l.category, amount: parsed[i]!, ...(l.method ? { method: l.method } : {}), received: l.received })),
      incomeNotes: text.trim() ? text.trim() : null,
    });
    return r !== undefined;
  }

  const begin = (c: Category) => { starter.current = c; ed.start(); };

  return (
    <EditableCard title="Income" testid="income" ed={ed} badge={<AdminOnlyBadge />} onSave={save} busy={busy} error={error}>
      {ed.editing ? (
        <div className="flex flex-col gap-3">
          {lines.length > 0 && (
            <div className="hidden sm:grid sm:grid-cols-[minmax(0,1fr)_112px_112px_48px_40px] gap-2 lbl" aria-hidden>
              <span>What</span><span>Amount</span><span>How</span><span className="text-center">Rec&rsquo;d</span><span />
            </div>
          )}
          {lines.map((l, i) => {
            const invalid = bad && parsed[i] === null;
            return (
              <div key={l.key} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_112px_112px_48px_40px] gap-2 items-center" data-testid="income-row">
                <select className="select col-span-2 sm:col-span-1" aria-label="What" value={l.category} onChange={(e) => patch(l.key, { category: e.target.value as Category })} data-testid="income-what">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{INCOME_LABEL[c]}</option>)}
                </select>
                <input className="input" aria-label="Amount" inputMode="decimal" placeholder="$0.00" value={l.amount} aria-invalid={invalid || undefined} onChange={(e) => patch(l.key, { amount: e.target.value })} data-testid="income-amount" />
                <select className="select" aria-label="How paid" value={l.method} onChange={(e) => patch(l.key, { method: e.target.value as Method | "" })} data-testid="income-how">
                  <option value=""></option>
                  {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
                </select>
                <div className="col-span-2 sm:contents flex items-center justify-between">
                  <label className="flex items-center justify-center gap-2 min-h-11 text-sm cursor-pointer">
                    <input type="checkbox" checked={l.received} onChange={(e) => patch(l.key, { received: e.target.checked })} data-testid="income-received" aria-label="Received" />
                    <span className="sm:sr-only">Rec&rsquo;d</span>
                  </label>
                  <button type="button" className="btn ghost sm min-h-11 min-w-11" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} data-testid="income-remove">&times;</button>
                </div>
                {invalid && <p className="col-span-2 sm:col-span-5 s text-[var(--danger)]" role="alert" data-testid="income-amount-error">Enter an amount like $250 or 250.00.</p>}
              </div>
            );
          })}
          <div><button type="button" className="btn ghost" onClick={() => setLines((ls) => [...ls, blank(ls.length ? "tips" : "guarantee")])} data-testid="income-add">+ Add income</button></div>
          <div className="money-row font-semibold" data-testid="income-total"><span>Total</span><span>{formatCents(total)}</span></div>
          <div className="flex flex-col gap-1.5">
            <label className="lbl" htmlFor="income-notes">Notes</label>
            <AutoGrowTextarea id="income-notes" value={text} onChange={setText} data-testid="income-notes" />
          </div>
        </div>
      ) : income.length === 0 ? (
        <UnfinishedPlaceholder lead="What's the deal?" testid="income-empty"
          actions={STARTERS.map((s) => <button key={s.category} type="button" className="btn ghost" onClick={() => begin(s.category)} data-testid={s.testid}>{s.label}</button>)}>
          Start with how you&rsquo;re getting paid &mdash; add tips and merch after the show.
        </UnfinishedPlaceholder>
      ) : (
        <div>
          {income.map((l) => (
            <div key={l.id} className="money-row" data-testid="income-line">
              <span>{[INCOME_LABEL[l.category], l.method ? METHOD_LABEL[l.method] : null, l.received ? "received" : "not yet"].filter(Boolean).join(" · ")}</span>
              <span>{formatCents(l.amount)}</span>
            </div>
          ))}
          <div className="money-row font-bold" data-testid="income-total"><span>Total</span><span>{formatCents(sumIncome(income))}</span></div>
          {notes && <p className="s mt-3 whitespace-pre-wrap" data-testid="income-notes-view">{notes}</p>}
        </div>
      )}
    </EditableCard>
  );
}
