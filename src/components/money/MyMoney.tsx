"use client";
import Link from "@/lib/artist";
import { useState } from "react";
import { useProfile } from "@/lib/auth";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";
import { CATEGORY_LABEL, formatCents, parseDollars } from "@/lib/money";
import { fmtLong, showName as nameOfShow } from "@/lib/shows";
import type { Expense, Show } from "@/schema";

/** Members: their own expenses and whether each is paid back. Rules allow only their own rows. */
export function MyMoney() {
  const p = useProfile();
  const expenses = useCollection<Expense>("expenses", { where: [["userId", "==", p.uid]] });
  const shows = useCollection<Show>("shows");
  const mine = [...(expenses.rows ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));
  const showName = (id?: string) => ((x) => x && nameOfShow(x))(shows.rows?.find((s) => s.id === id));
  // Nothing of theirs yet: a welcome card with no hide button, since Money is how they get paid back.
  if (expenses.rows !== null && mine.length === 0) {
    return (
      <WelcomeEmpty section="money" variant={0} hideable={false} title="Welcome to your money page!"
        body="Anything you spend for the band, like gas, strings or a rental, goes here so you get paid back."
        actions={<Link href="/money/expense" className="btn acc" data-testid="add-expense-link">Add an expense</Link>} />
    );
  }
  return (
    <div className="grid max-w-xl gap-5" data-testid="my-money">
      <PageTitle title="My money" />
      <Link href="/money/expense" className="btn acc" data-testid="add-expense-link">Add an expense</Link>
      <div className="grid content-start gap-2">
        <span className="lbl">My expenses</span>
        {mine.map((x) => <MyExpense key={x.id} x={x} showLabel={showName(x.showId)} />)}
        <span className="s">You can edit or remove an expense until it's been paid back. After that, ask Jeff or Ingrid to fix mistakes.</span>
      </div>
    </div>
  );
}

function MyExpense({ x, showLabel }: { x: Row<Expense>; showLabel?: string }) {
  const { call, error, busy } = useCommand();
  const [editing, setEditing] = useState(false);
  const [what, setWhat] = useState(x.what);
  const [amount, setAmount] = useState((x.amount / 100).toFixed(2));
  const paid = !!x.paidBackAt;
  const status = paid ? `Paid back ${fmtLong(x.paidBackAt!)}` : x.payBack === false ? "Not paid back" : "Owed";
  const cents = parseDollars(amount);
  async function save() {
    if (!cents || !what.trim()) return;
    const r = await call("expenses.update", { id: x.id, patch: { what: what.trim(), amount: cents } });
    if (r) setEditing(false);
  }
  return (
    <div className="card" data-testid={`expense-${x.id}`}>
      <div className="flex items-center justify-between gap-2"><b>{x.what}</b>
        <span className={`chip ${paid ? "g" : ""}`} data-testid={`expense-status-${x.id}`}>{status}</span></div>
      <span className="s">{fmtLong(x.date)} · {formatCents(x.amount)} · {CATEGORY_LABEL[x.category]}{showLabel ? ` · ${showLabel}` : ""}</span>
      {editing && (
        <div className="grid gap-2">
          <input className="input" value={what} onChange={(e) => setWhat(e.target.value)} data-testid={`expense-edit-what-${x.id}`} />
          <input className="input font-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid={`expense-edit-amount-${x.id}`} />
          <div className="flex gap-2">
            <button className="btn acc sm" disabled={busy || !cents || !what.trim()} onClick={save} data-testid={`expense-save-${x.id}`}>Save</button>
            <button className="btn ghost sm" onClick={() => { setEditing(false); setWhat(x.what); setAmount((x.amount / 100).toFixed(2)); }}>Cancel</button>
          </div>
        </div>
      )}
      <ErrorBox error={error} />
      {!paid && !editing && (
        <div className="flex gap-2">
          <button className="btn ghost sm" onClick={() => setEditing(true)} data-testid={`expense-edit-${x.id}`}>Edit</button>
          <button className="btn ghost sm" disabled={busy} data-testid={`expense-remove-${x.id}`}
            onClick={() => { if (confirm("Remove this expense?")) void call("expenses.remove", { id: x.id }); }}>Remove</button>
        </div>
      )}
    </div>
  );
}
