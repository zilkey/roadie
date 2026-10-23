"use client";
import Link from "next/link";
import { useProfile } from "@/lib/auth";
import { useCollection } from "@/lib/firestore-hooks";
import { PageTitle } from "@/components/ui";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";
import { CATEGORY_LABEL, formatCents, reimbursementFor, reversedIds, type LedgerLike } from "@/lib/money";
import { fmtLong } from "@/lib/shows";
import type { Expense, Show } from "@/schema";

/** Members: their own expenses (and whether paid back) and every payment made to them. Rules allow only their own rows. */
export function MyMoney() {
  const p = useProfile();
  const expenses = useCollection<Expense>("expenses", { where: [["userId", "==", p.uid]] });
  const ledger = useCollection<LedgerLike>("ledger", { where: [["payeeUserId", "==", p.uid], ["kind", "in", ["payout", "reimbursement", "correction"]]] });
  const shows = useCollection<Show>("shows");
  const led = ledger.rows ?? [];
  const rev = reversedIds(led);
  const mine = [...(expenses.rows ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));
  const payments = led.filter((e) => e.kind === "payout" || e.kind === "reimbursement").sort((a, b) => (a.date < b.date ? 1 : -1));
  const showName = (id?: string) => shows.rows?.find((s) => s.id === id)?.venue.name;
  // Nothing of theirs yet (no expenses, no payments or entries): a welcome card with no hide button, since Money is how they get paid back.
  const nothingYet = expenses.rows !== null && ledger.rows !== null && mine.length === 0 && led.length === 0;
  if (nothingYet) {
    return (
      <WelcomeEmpty section="money" variant={0} hideable={false} title="Welcome to your money page!"
        body="Anything you spend for the band, like gas, strings or a rental, goes here so you get paid back, along with what the band has paid you."
        actions={<Link href="/money/expense" className="btn acc" data-testid="add-expense-link">Add an expense</Link>} />
    );
  }
  return (
    <div className="grid gap-3" data-testid="my-money">
      <PageTitle title="My money" />
      <Link href="/money/expense" className="btn acc" data-testid="add-expense-link">Add an expense</Link>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid content-start gap-2">
          <span className="lbl">My expenses</span>
          {expenses.rows && mine.length === 0 && <div className="card"><span className="s">Nothing yet.</span></div>}
          {mine.map((x) => {
            const paid = !!reimbursementFor(x.id, led);
            return (
              <div key={x.id} className="card" data-testid={`expense-${x.id}`}>
                <div className="flex items-center justify-between gap-2"><b>{x.what}</b>
                  <span className={`chip ${paid ? "g" : ""}`} data-testid={`expense-status-${x.id}`}>{paid ? "Paid back" : "Not yet"}</span></div>
                <span className="s">{fmtLong(x.date)} · {formatCents(x.amount)} · {CATEGORY_LABEL[x.category]}{showName(x.showId) ? ` · ${showName(x.showId)}` : ""}</span>
              </div>
            );
          })}
          <span className="s">Expenses can't be changed after sending. Ask Jeff or Ingrid to fix mistakes.</span>
        </div>
        <div className="grid content-start gap-2">
          <span className="lbl">Payments to me</span>
          {ledger.rows && payments.length === 0 && <div className="card"><span className="s">Nothing yet.</span></div>}
          {payments.map((e) => (
            <div key={e.id} className="card" data-testid={`payment-${e.id}`}>
              <div className="flex items-center justify-between gap-2">
                <b>{e.kind === "reimbursement" ? e.memo ?? "Expense" : showName(e.showId) ?? e.memo ?? "Payout"}</b>
                <span className="font-mono">{formatCents(e.amount)}</span></div>
              <span className="s">{e.kind === "reimbursement" ? "Reimbursed" : "Show payout"} · {e.method} · {fmtLong(e.date)}{rev.has(e.id) ? " · reversed" : ""}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
