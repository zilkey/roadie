"use client";
"use client";
import Link from "@/lib/artist";
import { Suspense, useMemo, useState } from "react";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { Tabs } from "@/components/booking/common";
import { useCollection } from "@/lib/firestore-hooks";
import { CATEGORY_LABEL, INCOME_LABEL, METHOD_LABEL, byCategory, byMonth, byShow, formatCents, moneyRows, owedExpenses, totals, unreceivedIncome } from "@/lib/money";
import { dateInBandZone } from "@/lib/timezone";
import { fmtLong, showName as nameOfShow } from "@/lib/shows";
import { HBars, MonthBars } from "./charts";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";
import type { Expense, Musician, Show, ShowDeal, User } from "@/schema";

type Tab = "overview" | "shows" | "categories";

export function AdminMoney() { return <Suspense><Admin /></Suspense>; }

function Admin() {
  const expenses = useCollection<Expense>("expenses");
  const deals = useCollection<ShowDeal>("showDeals");
  const shows = useCollection<Show>("shows");
  const musicians = useCollection<Musician>("musicians");
  const users = useCollection<User>("users");
  const [tab, setTab] = useState<Tab>("overview");
  const { call, error, busy } = useCommand();

  const showById = useMemo(() => new Map((shows.rows ?? []).map((s) => [s.id, s])), [shows.rows]);
  const showName = (id: string) => ((x) => (x ? nameOfShow(x) : "Show"))(showById.get(id));
  const person = (userId?: string) =>
    users.rows?.find((u) => u.id === userId)?.name ?? musicians.rows?.find((m) => m.userId === userId)?.name ?? "Someone";
  const rows = useMemo(
    () => moneyRows({ deals: deals.rows ?? [], expenses: expenses.rows ?? [], showDate: (id) => showById.get(id)?.date }),
    [deals.rows, expenses.rows, showById],
  );
  const t = totals(rows);
  const owed = owedExpenses(expenses.rows ?? []);
  const owedBy = new Map<string, { name: string; total: number; lines: typeof owed }>();
  for (const x of owed) {
    const o = owedBy.get(x.userId) ?? { name: person(x.userId), total: 0, lines: [] };
    o.total += x.amount; o.lines.push(x); owedBy.set(x.userId, o);
  }
  const waiting = unreceivedIncome({ deals: deals.rows ?? [], show: (id) => showById.get(id), today: dateInBandZone() });
  const waitingTotal = waiting.reduce((n, w) => n + w.total, 0);
  // setIncome replaces the whole list, so resend every line with just this one flipped.
  const markReceived = (showId: string, lineId: string) => {
    const income = deals.rows?.find((d) => d.id === showId)?.income ?? [];
    return call("showDeals.setIncome", { id: showId, income: income.map((l) => (l.id === lineId ? { ...l, received: true } : l)) });
  };

  // No income lines and no expenses yet: only the welcome card, none of the tabs or totals.
  const nothingYet = expenses.rows !== null && deals.rows !== null && rows.length === 0 && (expenses.rows ?? []).length === 0;
  if (nothingYet) {
    return (
      <WelcomeEmpty section="money" variant={0} title="Welcome to Money!"
        body="Everything that comes in and goes out: show income, gear and rentals, who's owed what, and the totals broken down by show and category. Add the first expense or enter show income on a show's deal and the numbers start to fill in."
        actions={<Link href="/money/expense" className="btn acc" data-testid="add-expense-link">Add an expense</Link>}>
        <ErrorBox error={error} />
      </WelcomeEmpty>
    );
  }

  return (
    <div className="grid gap-5" data-testid="admin-money">
      <PageTitle title="Money" actions={<Link href="/money/expense" className="btn acc" data-testid="add-expense-link">Add an expense</Link>} />
      <Tabs<Tab> testid="money-tab" value={tab} onChange={setTab} options={[["overview", "Overview"], ["shows", "By show"], ["categories", "By category"]]} />
      <ErrorBox error={error} />

      {tab === "overview" && (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="grid content-start gap-5">
            <div className="card" data-testid="money-totals">
              <div className="sum flex justify-between"><span>In</span><span className="font-mono" data-testid="total-in">{formatCents(t.in)}</span></div>
              <div className="sum flex justify-between"><span>Out</span><span className="font-mono" data-testid="total-out">{formatCents(t.out)}</span></div>
              <div className="sum flex justify-between border-t border-line pt-2"><b>Left</b><b className="font-mono" data-testid="total-left">{formatCents(t.left)}</b></div>
            </div>
            <MonthBars data={byMonth(rows)} testid="chart-months" />
          </div>
          <div className="grid content-start gap-5">
          <div className="grid content-start gap-2" data-testid="unreceived">
            <div className="flex justify-between"><span className="lbl">Not received yet</span>{waiting.length > 0 && <b className="font-mono" data-testid="unreceived-total">{formatCents(waitingTotal)}</b>}</div>
            {waiting.length === 0 && <div className="empty"><span>Every show so far has paid up.</span></div>}
            {waiting.map((w) => (
              <div key={w.showId} className="card" data-testid={`unreceived-${w.showId}`}>
                <div className="flex justify-between gap-2">
                  <Link href={`/shows/${w.showId}`}><b>{showName(w.showId)}</b> <span className="s">{fmtLong(w.date)}</span></Link>
                  <b className="font-mono">{formatCents(w.total)}</b>
                </div>
                {w.lines.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{INCOME_LABEL[l.category] ?? l.category} <span className="s">{formatCents(l.amount)}{l.method ? ` · ${METHOD_LABEL[l.method] ?? l.method}` : ""}</span></span>
                    <button className="btn sm" disabled={busy} data-testid={`received-${l.id}`} onClick={() => markReceived(w.showId, l.id)}>Mark received</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="grid content-start gap-2" data-testid="owed">
            <span className="lbl">Owed to people</span>
            {owed.length === 0 && <div className="empty"><span>Nobody is owed anything.</span></div>}
            {[...owedBy.entries()].map(([key, o]) => (
              <div key={key} className="card" data-testid={`owed-${key}`}>
                <div className="flex justify-between"><b>{o.name}</b><b className="font-mono">{formatCents(o.total)}</b></div>
                {o.lines.map((x) => (
                  <div key={x.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{x.what} <span className="s">{formatCents(x.amount)} · {fmtLong(x.date)}</span></span>
                    <button className="btn sm" disabled={busy} data-testid={`paid-back-${x.id}`} onClick={() => call("expenses.setPaidBack", { id: x.id, paid: true })}>Mark paid back</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
          </div>
        </div>
      )}

      {tab === "shows" && (
        <HBars title="Each show's take" testid="chart-shows"
          rows={byShow(rows).map((r) => ({ ...r, label: showName(r.key), sub: showById.get(r.key) ? fmtLong(showById.get(r.key)!.date) : undefined }))} />
      )}
      {tab === "categories" && <HBars title="By category" testid="chart-categories" rows={byCategory(rows).map((r) => ({ ...r, label: CATEGORY_LABEL[r.key] ?? r.key }))} />}
    </div>
  );
}
