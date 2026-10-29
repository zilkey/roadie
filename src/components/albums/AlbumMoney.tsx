"use client";
import { useState } from "react";
import Link from "@/lib/artist";
import { ErrorBox, useCommand } from "@/components/ui";
import { InlineValue } from "@/components/InlineValue";
import { HBars } from "@/components/money/charts";
import { MoneyInModal } from "@/components/money/MoneyInModal";
import { useCollection } from "@/lib/firestore-hooks";
import { CATEGORY_LABEL, INCOME_LABEL, PAYOUT_KIND_LABEL, byCategory, defaultProject, formatCents, moneyRows, owesBack, parseDollars, projectOf, projectTotals } from "@/lib/money";
import type { Expense, Income, Musician, Payout, Project, User } from "@/schema";
import type { AlbumData } from "./common";

type Filter = "all" | "expenses" | "income" | "owed";
const FILTERS: [Filter, string][] = [["all", "Everything"], ["expenses", "Expenses"], ["income", "Income"], ["owed", "Owed back"]];

const shortDate = (s: string) => (s ? new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");
/** "+$1,180.00", "−$3,032.00", "$0.00". */
export const signed = (c: number) => `${c < 0 ? "−" : c > 0 ? "+" : ""}${formatCents(Math.abs(c))}`;

interface Line { key: string; kind: "income" | "expense" | "payout"; id: string; date: string; cat: string; trackId?: string; details: string; notes?: string; who: string; amount: number; sign: 1 | -1; owed: boolean }

/** The album's money: its project's income, expenses and payouts against the album's budget. Admins only. */
export function AlbumMoney({ data }: { data: AlbumData }) {
  if (!data.admin || !data.album) return null;
  return <View data={data} />;
}

function View({ data }: { data: AlbumData }) {
  const album = data.album!;
  const projects = useCollection<Project>("projects");
  const income = useCollection<Income>("income");
  const expenses = useCollection<Expense>("expenses");
  const payouts = useCollection<Payout>("payouts");
  const users = useCollection<User>("users");
  const musicians = useCollection<Musician>("musicians");
  const { call, error } = useCommand();
  const [modal, setModal] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const def = defaultProject(projects.rows ?? [])?.id;
  const mine = <T extends { projectId?: string }>(xs: readonly T[] | null) => (xs ?? []).filter((x) => projectOf(x, def) === album.projectId);
  const inc = mine(income.rows), exp = mine(expenses.rows), pay = mine(payouts.rows);
  const t = projectTotals({ projectId: album.projectId, defaultProjectId: def, income: income.rows ?? [], expenses: expenses.rows ?? [], payouts: payouts.rows ?? [] });
  const spent = t.expenses + t.paidOut;
  const earned = t.income;
  const net = earned - spent;
  const budget = album.budget;
  const pct = budget ? Math.round((spent / budget) * 100) : 0;

  const personName = (uid: string) => users.rows?.find((u) => u.id === uid)?.name ?? musicians.rows?.find((m) => m.userId === uid)?.name ?? "Someone";
  const trackLabel = (id?: string) => {
    if (!id) return "—";
    const tr = data.tracks.find((x) => x.id === id);
    return tr ? `${tr.position} · ${tr.title}` : "—";
  };

  const lines: Line[] = [
    ...inc.map((x): Line => ({ key: `income-${x.id}`, kind: "income", id: x.id, date: x.date, cat: INCOME_LABEL[x.category] ?? x.category, trackId: x.albumTrackId, details: x.from, notes: x.notes, who: "Band", amount: x.amount, sign: 1, owed: false })),
    ...exp.map((x): Line => ({ key: `expense-${x.id}`, kind: "expense", id: x.id, date: x.date, cat: CATEGORY_LABEL[x.category] ?? x.category, trackId: x.albumTrackId, details: x.what, who: `${personName(x.userId)}${owesBack(x) ? " · owed back" : ""}`, amount: x.amount, sign: -1, owed: owesBack(x) })),
    ...pay.map((p): Line => ({ key: `payout-${p.id}`, kind: "payout", id: p.id, date: p.paidAt ?? p.dueDate ?? "", cat: PAYOUT_KIND_LABEL[p.kind] ?? p.kind, details: p.what ?? (p.paidAt ? "Paid out" : "We owe"), who: p.to.name, amount: p.amount, sign: -1, owed: false })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.key.localeCompare(b.key)));
  const shown = lines.filter((l) => filter === "all" || (filter === "income" ? l.kind === "income" : filter === "expenses" ? l.kind !== "income" : l.kind === "expense" && l.owed));

  const spentCats = byCategory(moneyRows({ income: [], expenses: exp, payouts: pay })).map((r) => ({ ...r, label: CATEGORY_LABEL[r.key] ?? r.key }));
  const earnedCats = byCategory(moneyRows({ income: inc, expenses: [], payouts: [] })).map((r) => ({ ...r, label: INCOME_LABEL[r.key] ?? r.key }));

  const saveBudget = async (v: string) => {
    const cents = v.trim() ? parseDollars(v) : null;
    return !!(await call("albums.update", { id: album.id, patch: { budget: cents } }));
  };

  return (
    <div className="grid gap-5" data-testid="album-money">
      <section className="card" aria-labelledby="album-money-h">
        <div className="sg-sech">
          <h2 id="album-money-h" className="card-h">Where it stands</h2>
          <div className="flex flex-wrap gap-2">
            <Link href={`/money/expense?project=${encodeURIComponent(album.projectId)}`} className="btn outline sm" data-testid="add-expense-link">+ Add expense</Link>
            <button type="button" className="btn outline sm" onClick={() => setModal(true)} data-testid="add-income-btn">+ Add income</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="grid gap-1" data-testid="tile-budget">
            <span className="lbl">Budget</span>
            <InlineValue testid="album-budget" label="Budget" kind="text" inputMode="decimal" className="font-mono text-xl font-bold" canEdit error={error}
              value={budget ? (budget / 100).toFixed(2) : ""} display={budget ? formatCents(budget) : undefined} emptyLabel="Set a budget"
              validate={(v) => (!v.trim() || parseDollars(v) !== null ? null : "Needs a dollar amount.")} onSave={saveBudget} />
          </div>
          <div className="grid gap-1" data-testid="tile-spent">
            <span className="lbl">Spent</span>
            <b className="font-mono text-xl" data-testid="album-spent-amount">{formatCents(spent)}</b>
          </div>
          <div className="grid gap-1" data-testid="tile-earned">
            <span className="lbl">Earned</span>
            <b className="font-mono text-xl" data-testid="album-earned-amount">{formatCents(earned)}</b>
            {t.owedToUs > 0 && <span className="s">{formatCents(t.owedToUs)} still owed</span>}
          </div>
          <div className="grid gap-1" data-testid="tile-net">
            <span className="lbl">Net so far</span>
            <b className="font-mono text-xl" data-testid="album-net-amount">{signed(net)}</b>
          </div>
        </div>
        {!!budget && (
          <div className="grid gap-1.5">
            <div role="progressbar" aria-label="Budget spent" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(pct, 100)} aria-valuetext={`${pct}% of budget spent`}
              data-testid="budget-bar" className="overflow-hidden rounded-full" style={{ height: 6, background: "var(--divider)" }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: pct > 100 ? "var(--danger)" : "var(--accent)" }} />
            </div>
            <span className="s" data-testid="budget-left">{pct}% of budget spent · {spent <= budget ? `${formatCents(budget - spent)} left` : `${formatCents(spent - budget)} over`}</span>
          </div>
        )}
        <ErrorBox error={error} />
      </section>

      <div className="grid gap-5 sm:grid-cols-2">
        <HBars title="Spent by category" testid="spent-by-category" spent rows={spentCats} />
        <div className="grid content-start gap-2">
          <HBars title="Earned by source" testid="earned-by-source" rows={earnedCats} />
          <span className="s">Streaming and sync show up here once statements come in.</span>
        </div>
      </div>

      <section className="card" data-testid="album-lines" aria-labelledby="album-lines-h">
        <div className="sg-sech">
          <h2 id="album-lines-h" className="card-h">All lines</h2>
          <label className="flex items-center gap-2"><span className="lbl">Show</span>
            <select className="select !w-auto" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} data-testid="lines-filter" aria-label="Show">
              {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        {shown.length === 0
          ? <span className="s" data-testid="lines-empty">{lines.length ? "Nothing matches." : "No money on this album yet."}</span>
          : (
            <div className="book-tw">
              <table className="book-table" style={{ minWidth: 720 }}>
                <thead><tr><th>Date</th><th>Category</th><th>Track</th><th>Details</th><th>Who</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {shown.map((l) => (
                    <tr key={l.key} data-testid={`line-${l.kind}-${l.id}`}>
                      <td className="nw">{shortDate(l.date)}</td>
                      <td className="nw">{l.cat}</td>
                      <td className="nw">{trackLabel(l.trackId)}</td>
                      <td>{l.details}{l.notes && <span className="s"> · {l.notes}</span>}</td>
                      <td className="nw">{l.who}</td>
                      <td className={`nw text-right font-mono font-bold${l.sign > 0 ? " text-ok" : ""}`}>{l.sign > 0 ? "+" : "−"}{formatCents(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <span className="s">These are the band&apos;s ledger and expenses, tagged with this album. They also show in Money.</span>
      </section>

      <MoneyInModal open={modal} onClose={() => setModal(false)} defaults={{ projectId: album.projectId }} />
    </div>
  );
}
