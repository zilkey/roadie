"use client";
import { useMemo } from "react";
import Link from "@/lib/artist";
import { PageTitle } from "@/components/ui";
import { CATEGORY_LABEL, byCategory, byMonth, byPayer, byReceiver, byShow, byYear, formatCents, type MoneyRow } from "@/lib/money";
import { fmtLong, showName as nameOfShow } from "@/lib/shows";
import { HBars, MonthBars } from "./charts";
import { useMoneyData } from "./useMoneyData";
import { useAdmins } from "./MoneyNav";

const signed = (c: number) => `${c < 0 ? "" : "+"}${formatCents(c)}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Each show's take (money that moved on it), best first. */
export function MoneyByShow() {
  const d = useMoneyData();
  const name = (id: string) => ((x) => (x ? nameOfShow(x) : "Show"))(d.showById.get(id));
  return (
    <div className="grid gap-5" data-testid="money-by-show">
      <PageTitle title="By show" sub="What each show brought in, less what it cost and who got paid" />
      <HBars title="Each show's take" testid="chart-shows"
        rows={byShow(d.rows).map((r) => ({ ...r, label: name(r.key), sub: d.showById.get(r.key) ? fmtLong(d.showById.get(r.key)!.date) : undefined }))} />
    </div>
  );
}

/** In and out by category, biggest first. */
export function MoneyByCategory() {
  const d = useMoneyData();
  return (
    <div className="grid gap-5" data-testid="money-by-category">
      <PageTitle title="By category" />
      <HBars title="By category" testid="chart-categories" rows={byCategory(d.rows).map((r) => ({ ...r, label: CATEGORY_LABEL[r.key] ?? r.key }))} />
    </div>
  );
}

/**
 * Year by year: in, out and net for every year, then the year's months (with a running net) and its categories. The table
 * is the year-over-year view; each year's block answers "how did this year go".
 */
export function MoneyByYear() {
  const d = useMoneyData();
  const years = byYear(d.rows);
  return (
    <div className="grid gap-5" data-testid="money-by-year">
      <PageTitle title="By year" sub="Money that moved, by the date it moved. Owed amounts count once they're paid." />
      <div className="book-tw">
        <table className="book-table" style={{ minWidth: 520 }} data-testid="years-table">
          <thead><tr><th>Year</th><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Net</th><th className="text-right">vs year before</th></tr></thead>
          <tbody>
            {years.length === 0 && <tr><td colSpan={5} className="s">Nothing yet.</td></tr>}
            {years.map((y, n) => {
              const prev = years[n + 1];
              return (
                <tr key={y.key} data-testid={`year-${y.key}`}>
                  <td className="font-bold"><a href={`#y${y.key}`}>{y.key}</a></td>
                  <td className="text-right font-mono">{formatCents(y.in)}</td>
                  <td className="text-right font-mono">{formatCents(y.out)}</td>
                  <td className="text-right font-mono font-bold">{signed(y.net)}</td>
                  <td className="s text-right font-mono">{prev ? signed(y.net - prev.net) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {years.map((y) => <YearBlock key={y.key} year={y.key} rows={d.rows.filter((r) => r.date.startsWith(y.key))} />)}
    </div>
  );
}

function YearBlock({ year, rows }: { year: string; rows: MoneyRow[] }) {
  const months = useMemo(() => {
    const m = new Map(byMonth(rows).map((r) => [r.key, r]));
    let run = 0;
    return MONTHS.map((label, i) => {
      const key = `${year}-${String(i + 1).padStart(2, "0")}`;
      const r = m.get(key) ?? { key, in: 0, out: 0, net: 0 };
      run += r.net;
      return { ...r, label, run };
    });
  }, [rows, year]);
  const filled = months.filter((m) => m.in || m.out);
  return (
    <section id={`y${year}`} className="grid gap-3" data-testid={`year-block-${year}`}>
      <h2 className="text-xl font-extrabold">{year}</h2>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="book-tw">
          <table className="book-table" style={{ minWidth: 420 }} data-testid={`year-months-${year}`}>
            <thead><tr><th>Month</th><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Net</th><th className="text-right">Year to date</th></tr></thead>
            <tbody>
              {filled.length === 0 && <tr><td colSpan={5} className="s">Nothing this year.</td></tr>}
              {filled.map((m) => (
                <tr key={m.key}>
                  <td>{m.label}</td>
                  <td className="text-right font-mono">{m.in ? formatCents(m.in) : "—"}</td>
                  <td className="text-right font-mono">{m.out ? formatCents(m.out) : "—"}</td>
                  <td className="text-right font-mono">{signed(m.net)}</td>
                  <td className="s text-right font-mono">{signed(m.run)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid content-start gap-5">
          <MonthBars data={months.filter((m) => m.in || m.out)} testid={`chart-year-${year}`} />
          <HBars title="By category" testid={`year-cats-${year}`} rows={byCategory(rows).map((r) => ({ ...r, label: CATEGORY_LABEL[r.key] ?? r.key }))} />
        </div>
      </div>
    </section>
  );
}

/**
 * Whose account money went through, all time and this year: what landed with each admin (income received) and what left
 * each person's pocket (expenses they paid, payouts they made). Links to each admin's tax worksheet.
 */
export function MoneyByPerson() {
  const d = useMoneyData();
  const admins = useAdmins();
  const year = d.today.slice(0, 4);
  const table = (rows: MoneyRow[], testid: string) => {
    const ins = new Map(byReceiver(rows).map((r) => [r.key, r.in]));
    const outs = new Map(byPayer(rows).map((r) => [r.key, r.out]));
    const ids = [...new Set([...admins.map((a) => a.id), ...ins.keys(), ...outs.keys()])];
    const unassigned = rows.filter((r) => r.kind === "income" && !r.receiver).reduce((n, r) => n + r.in, 0);
    return (
      <div className="book-tw">
        <table className="book-table" style={{ minWidth: 560 }} data-testid={testid}>
          <thead><tr><th>Person</th><th className="text-right">Came in to them</th><th className="text-right">Paid out of pocket</th><th className="text-right">Net through them</th><th /></tr></thead>
          <tbody>
            {ids.map((id) => {
              const i = ins.get(id) ?? 0, o = outs.get(id) ?? 0;
              const admin = admins.some((a) => a.id === id);
              return (
                <tr key={id} data-testid={`${testid}-${id}`}>
                  <td className="font-bold">{d.personName(id)}</td>
                  <td className="text-right font-mono">{i ? formatCents(i) : "—"}</td>
                  <td className="text-right font-mono">{o ? formatCents(o) : "—"}</td>
                  <td className="text-right font-mono">{signed(i - o)}</td>
                  <td className="text-right">{admin && <Link href={`/money/taxes/${id}`} className="font-semibold">Taxes ›</Link>}</td>
                </tr>
              );
            })}
            {unassigned > 0 && (
              <tr data-testid={`${testid}-unassigned`}>
                <td className="s">Income nobody is down as receiving</td><td className="text-right font-mono">{formatCents(unassigned)}</td><td /><td /><td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };
  return (
    <div className="grid gap-5" data-testid="money-by-person">
      <PageTitle title="By person" sub="The band has no account: every dollar goes through someone's. Paid-back expenses count for whoever paid them, as on the Overview." />
      <span className="lbl">{year}</span>
      {table(d.rows.filter((r) => r.date.startsWith(year)), "people-year")}
      <span className="lbl">All time</span>
      {table(d.rows, "people-all")}
    </div>
  );
}
