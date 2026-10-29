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
import type { ReleaseData } from "./common";

type Filter = "all" | "expenses" | "income" | "owed";
const FILTERS: [Filter, string][] = [["all", "Everything"], ["expenses", "Expenses"], ["income", "Income"], ["owed", "Owed back"]];

const shortDate = (s: string) => (s ? new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");
/** "+$1,180.00", "−$3,032.00", "$0.00". */
export const signed = (c: number) => `${c < 0 ? "−" : c > 0 ? "+" : ""}${formatCents(Math.abs(c))}`;

interface Line { key: string; kind: "income" | "expense" | "payout"; id: string; date: string; cat: string; trackId?: string; details: string; notes?: string; who: string; amount: number; sign: 1 | -1; owed: boolean }

/** The release's money: its project's income, expenses and payouts. Admins only. */
export function ReleaseMoney({ data }: { data: ReleaseData }) {
  if (!data.admin || !data.release) return null;
  return <View data={data} />;
}

function View({ data }: { data: ReleaseData }) {
  const release = data.release!;
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
  const mine = <T extends { projectId?: string }>(xs: readonly T[] | null) => (xs ?? []).filter((x) => projectOf(x, def) === release.projectId);
  const inc = mine(income.rows), exp = mine(expenses.rows), pay = mine(payouts.rows);
  const t = projectTotals({ projectId: release.projectId, defaultProjectId: def, income: income.rows ?? [], expenses: expenses.rows ?? [], payouts: payouts.rows ?? [] });
  // The release page keeps the whole picture: spent is everything out (paid or still owed), earned everything in (received or owed).
  const spent = t.outPaid + t.outOwed;
  const earned = t.inReceived + t.inOwed;
  const net = earned - spent;

  const personName = (uid: string) => users.rows?.find((u) => u.id === uid)?.name ?? musicians.rows?.find((m) => m.userId === uid)?.name ?? "Someone";
  const trackLabel = (id?: string) => {
    if (!id) return "—";
    const tr = data.tracks.find((x) => x.id === id);
    return tr ? `${tr.position} · ${tr.title}` : "—";
  };

  const lines: Line[] = [
    ...inc.map((x): Line => ({ key: `income-${x.id}`, kind: "income", id: x.id, date: x.date, cat: INCOME_LABEL[x.category] ?? x.category, trackId: x.releaseTrackId, details: x.from, notes: x.notes, who: "Band", amount: x.amount, sign: 1, owed: false })),
    ...exp.map((x): Line => ({ key: `expense-${x.id}`, kind: "expense", id: x.id, date: x.date, cat: CATEGORY_LABEL[x.category] ?? x.category, trackId: x.releaseTrackId, details: x.what, who: `${personName(x.userId)}${owesBack(x) ? " · owed back" : ""}`, amount: x.amount, sign: -1, owed: owesBack(x) })),
    ...pay.map((p): Line => ({ key: `payout-${p.id}`, kind: "payout", id: p.id, date: p.paidAt ?? p.dueDate ?? "", cat: PAYOUT_KIND_LABEL[p.kind] ?? p.kind, details: p.what ?? (p.paidAt ? "Paid out" : "We owe"), who: p.to.name, amount: p.amount, sign: -1, owed: false })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.key.localeCompare(b.key)));
  const shown = lines.filter((l) => filter === "all" || (filter === "income" ? l.kind === "income" : filter === "expenses" ? l.kind !== "income" : l.kind === "expense" && l.owed));

  const spentCats = byCategory(moneyRows({ income: [], expenses: exp, payouts: pay })).map((r) => ({ ...r, label: CATEGORY_LABEL[r.key] ?? r.key }));
  const earnedCats = byCategory(moneyRows({ income: inc, expenses: [], payouts: [] })).map((r) => ({ ...r, label: INCOME_LABEL[r.key] ?? r.key }));

  return (
    <div className="grid gap-5" data-testid="release-money">
      <section className="card" aria-labelledby="release-money-h">
        <div className="sg-sech">
          <h2 id="release-money-h" className="card-h">Where it stands</h2>
          <div className="flex flex-wrap gap-2">
            <Link href={`/money/expense?project=${encodeURIComponent(release.projectId)}`} className="btn outline sm" data-testid="add-expense-link">+ Add expense</Link>
            <button type="button" className="btn outline sm" onClick={() => setModal(true)} data-testid="add-income-btn">+ Add income</button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="grid gap-1" data-testid="tile-spent">
            <span className="lbl">Spent</span>
            <b className="font-mono text-xl" data-testid="release-spent-amount">{formatCents(spent)}</b>
          </div>
          <div className="grid gap-1" data-testid="tile-earned">
            <span className="lbl">Earned</span>
            <b className="font-mono text-xl" data-testid="release-earned-amount">{formatCents(earned)}</b>
            {t.inOwed > 0 && <span className="s">{formatCents(t.inOwed)} still owed</span>}
          </div>
          <div className="grid gap-1" data-testid="tile-net">
            <span className="lbl">Net so far</span>
            <b className="font-mono text-xl" data-testid="release-net-amount">{signed(net)}</b>
          </div>
        </div>
        <ErrorBox error={error} />
      </section>

      <div className="grid gap-5 sm:grid-cols-2">
        <HBars title="Spent by category" testid="spent-by-category" spent rows={spentCats} />
        <div className="grid content-start gap-2">
          <HBars title="Earned by source" testid="earned-by-source" rows={earnedCats} />
          <span className="s">Streaming and sync show up here once statements come in.</span>
        </div>
      </div>

      <section className="card" data-testid="release-lines" aria-labelledby="release-lines-h">
        <div className="sg-sech">
          <h2 id="release-lines-h" className="card-h">All lines</h2>
          <label className="flex items-center gap-2"><span className="lbl">Show</span>
            <select className="select !w-auto" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} data-testid="lines-filter" aria-label="Show">
              {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        {shown.length === 0
          ? <span className="s" data-testid="lines-empty">{lines.length ? "Nothing matches." : "No money on this release yet."}</span>
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
        <span className="s">These are the band&apos;s ledger and expenses, tagged with this release. They also show in Money.</span>
      </section>

      <MoneyInModal open={modal} onClose={() => setModal(false)} defaults={{ projectId: release.projectId }} />
    </div>
  );
}
