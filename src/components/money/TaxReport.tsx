"use client";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useArtistRouter } from "@/lib/artist";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { EXPENSE_LABEL, INCOME_LABEL, METHOD_LABEL, formatCents } from "@/lib/money";
import { MEALS_PCT, defaultTaxYear, moneyYears, necThreshold, taxReport, unassignedIncome, type TaxEntry, type TaxLineTotal } from "@/lib/taxes";
import { useMoneyData } from "./useMoneyData";
import { useAdmins } from "./MoneyNav";
import { PrintIcon } from "@/components/print/PrintDialog";

const shortDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const amt = (c: number) => (c ? formatCents(c) : "—");

/**
 * One admin's yearly tax worksheet, laid out like Schedule C: Part I income (cash vs everything else, Line 1 gross
 * receipts), Part II expenses on their lines (each opens to the records behind it), Line 31 net, Part IV miles and Part V
 * other expenses, then who they paid as contract labor (1099-NEC). Received income nobody is down as receiving is listed
 * at the top with a picker, so it can be put on the right person's worksheet. The maths is src/lib/taxes.ts.
 */
export function TaxReport({ uid }: { uid: string }) {
  const d = useMoneyData();
  const admins = useAdmins();
  const sp = useSearchParams();
  const router = useArtistRouter();
  const { call, error, busy } = useCommand();
  const years = useMemo(() => moneyYears({ income: d.inc, expenses: d.exp, payouts: d.pay }, Number(d.today.slice(0, 4))), [d.inc, d.exp, d.pay, d.today]);
  const year = Number(sp.get("year")) || defaultTaxYear(d.today);
  // Cash is left out by default; ?cash=1 counts it in gross receipts and the net.
  const includeCash = sp.get("cash") === "1";
  const r = useMemo(() => taxReport({ year, uid, includeCash, income: d.inc, expenses: d.exp, payouts: d.pay, musicianUserId: d.musicianUserId }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [year, uid, includeCash, d.inc, d.exp, d.pay, d.musicians.rows]);
  const loose = unassignedIncome(d.inc, year);
  const name = d.personName(uid);
  const isAdmin = admins.some((a) => a.id === uid);
  const go = (y: number, cash: boolean) => router.replace(`/money/taxes/${uid}?year=${y}${cash ? "&cash=1" : ""}`);
  const setYear = (y: string) => go(Number(y), includeCash);

  return (
    <div className="grid gap-5" data-testid="tax-report">
      <PageTitle title={`${name}'s taxes`} sub="What went through their account, sorted the way Schedule C asks for it"
        actions={<div className="flex flex-nowrap items-center gap-2">
          <label className="pick" data-testid="tax-include-cash-label">
            <input type="checkbox" checked={includeCash} onChange={(e) => go(year, e.target.checked)} data-testid="tax-include-cash" /> Include cash
          </label>
          <select className="select w-auto" value={year} onChange={(e) => setYear(e.target.value)} data-testid="tax-year" aria-label="Tax year">
            {[...new Set([...years, year])].sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button type="button" className="icon-btn" onClick={() => window.print()} data-testid="tax-print" aria-label="Print" title="Print"><PrintIcon /></button>
        </div>} />
      <ErrorBox error={error} />
      {d.users.rows && !isAdmin && <div className="empty" data-testid="tax-not-admin">{name} isn&apos;t an admin, so nothing goes through their account.</div>}

      {loose.length > 0 && (
        <div className="card tax-notice" data-testid="tax-unassigned">
          <b>{loose.length === 1 ? "1 payment" : `${loose.length} payments`} received in {year} {loose.length === 1 ? "isn't" : "aren't"} on anyone&apos;s taxes yet</b>
          <span className="s">Pick whose account each one landed in. Money marked received in the app goes to whoever marked it; Roadie&apos;s and older ones need a person.</span>
          {loose.map((x) => (
            <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2" data-testid={`tax-unassigned-${x.id}`}>
              <span className="min-w-0"><b>{x.from}</b> <span className="s">· {INCOME_LABEL[x.category] ?? x.category} · {shortDate(x.receivedAt!)}{x.method ? ` · ${METHOD_LABEL[x.method] ?? x.method}` : ""}</span></span>
              <span className="flex items-center gap-2">
                <b className="font-mono">{formatCents(x.amount)}</b>
                <select className="select w-auto" value="" disabled={busy} onChange={(e) => e.target.value && void call("income.assign", { id: x.id, receivedBy: e.target.value })} data-testid={`tax-assign-${x.id}`} aria-label={`Who received ${x.from}`}>
                  <option value="">Who got it?</option>
                  {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="tax-form" data-testid="tax-form">
        <header className="tax-head">
          <div>
            <div className="tax-form-id">SCHEDULE C<br /><span>(Form 1040)</span></div>
          </div>
          <div className="tax-title">
            <b>Profit or Loss From Business</b>
            <span>Worksheet from Roadie · cash basis · not a tax form</span>
          </div>
          <div className="tax-year-box"><span>Tax year</span><b data-testid="tax-year-label">{year}</b></div>
        </header>
        <div className="tax-row tax-ident">
          <span><span className="tax-k">Name of proprietor</span> <b data-testid="tax-name">{name}</b></span>
          <span><span className="tax-k">Principal business</span> Musician / performing arts</span>
        </div>

        <h3 className="tax-part"><span>Part I</span> Income{!includeCash && <span className="tax-part-note" data-testid="tax-cash-off">cash left out</span>}</h3>
        <Line n="" label={includeCash ? "Received in cash" : "Received in cash (not included)"} value={r.income.cash} testid="tax-cash" sub />
        <Line n="" label="Received any other way (check, Venmo, card…)" value={r.income.nonCash} testid="tax-noncash" sub
          detail={r.income.byMethod.length > 0 && (
            <div className="tax-detail">
              {r.income.byMethod.map((m) => <div key={m.method} className="tax-dl"><span>{m.method === "unknown" ? "Method not recorded" : METHOD_LABEL[m.method] ?? m.method}</span><span className="font-mono">{formatCents(m.amount)}</span></div>)}
              {r.income.byMethod.some((m) => ["venmo", "square", "card"].includes(m.method)) && <p className="s">Venmo, Square and card payments may also be reported to the IRS on a 1099-K. Count them once.</p>}
            </div>
          )} />
        <Line n="1" label="Gross receipts or sales" value={r.income.gross} testid="tax-line-1" strong entries={r.income.entries} />
        <Line n="7" label="Gross income" value={r.income.gross} testid="tax-line-7" strong
          detail={r.income.byCategory.length > 0 && (
            <div className="tax-detail">{r.income.byCategory.map((c) => <div key={c.category} className="tax-dl"><span>{INCOME_LABEL[c.category] ?? c.category}</span><span className="font-mono">{formatCents(c.amount)}</span></div>)}</div>
          )} />

        <h3 className="tax-part"><span>Part II</span> Expenses</h3>
        {r.lines.map((l) => <ExpenseLine key={l.key} l={l} />)}
        <Line n="28" label="Total expenses" value={r.totalExpenses} testid="tax-line-28" strong />
        <Line n="31" label={r.net < 0 ? "Net loss" : "Net profit"} value={r.net} testid="tax-line-31" strong total />

        <h3 className="tax-part"><span>Part IV</span> Your vehicle</h3>
        <Line n="44a" label="Business miles (from gas estimates you logged)" value={r.miles} raw={`${r.miles.toLocaleString("en-US")} mi`} testid="tax-miles" />
        <p className="tax-note">Line 9 uses actual gas costs. If you take the standard mileage rate instead, use the miles and leave the gas off. Gas typed without an estimate has no miles here.</p>

        <h3 className="tax-part"><span>Part V</span> Other expenses</h3>
        {r.partV.length === 0 && <div className="tax-row s">None.</div>}
        {r.partV.map((c) => <Line key={c.category} n="" label={EXPENSE_LABEL[c.category] ?? c.category} value={c.amount} testid={`tax-other-${c.category}`} sub />)}
        {r.partV.length > 0 && <Line n="48" label="Total other expenses" value={r.lines.find((l) => l.key === "other")!.amount} testid="tax-line-48" strong />}

        <h3 className="tax-part"><span>1099-NEC</span> People you paid</h3>
        {r.payees.length === 0 && <div className="tax-row s">Nobody this year.</div>}
        {r.payees.map((p) => (
          <div key={p.key} className="tax-row" data-testid={`tax-payee-${p.key}`}>
            <span className="tax-n" />
            <span className="tax-label">{p.name} <span className="s">· {p.count === 1 ? "1 payment" : `${p.count} payments`}</span>{p.over && <span className="chip a ml-2" data-testid={`tax-payee-${p.key}-1099`}>1099-NEC</span>}</span>
            <span className="tax-amt">{formatCents(p.total)}</span>
          </div>
        ))}
        {r.payees.length > 0 && <p className="tax-note">A 1099-NEC is usually due for anyone paid {formatCents(necThreshold(year))} or more in {year} who isn&apos;t an employee or a corporation.</p>}

        <footer className="tax-foot">
          Income counts on the day it was received, with whoever received it{includeCash ? "" : "; cash is left out unless Include cash is on"}.Expenses count for whoever&apos;s money it finally was: a bandmate&apos;s expense you paid back is yours; one nobody has paid back is still theirs. Meals are at {MEALS_PCT}%. Gear is under Supplies: a big purchase may need to be depreciated instead (Form 4562). This is a worksheet, not tax advice.
        </footer>
      </div>
    </div>
  );
}

function ExpenseLine({ l }: { l: TaxLineTotal }) {
  const label = l.key === "meals" && l.spent ? `${l.label} (${MEALS_PCT}% of ${formatCents(l.spent)})` : l.label;
  return <Line n={l.line} label={label} value={l.amount} testid={`tax-line-${l.line}`} entries={l.entries} />;
}

function Line({ n, label, value, raw, testid, strong, total, sub, entries, detail }: {
  n: string; label: string; value: number; raw?: string; testid: string; strong?: boolean; total?: boolean; sub?: boolean; entries?: TaxEntry[]; detail?: React.ReactNode;
}) {
  const row = (
    <>
      <span className="tax-n">{n}</span>
      <span className="tax-label">{label}</span>
      <span className="tax-amt" data-testid={`${testid}-amount`}>{raw ?? amt(value)}</span>
    </>
  );
  const cls = `tax-row${strong ? " strong" : ""}${total ? " total" : ""}${sub ? " sub" : ""}`;
  const more = (entries?.length ?? 0) > 0 || detail;
  if (!more) return <div className={cls} data-testid={testid}>{row}</div>;
  return (
    <details className="tax-line" data-testid={testid}>
      <summary className={cls}>{row}</summary>
      {detail}
      {entries && entries.length > 0 && (
        <div className="tax-detail">
          {entries.map((e) => (
            <div key={`${e.kind}-${e.id}`} className="tax-dl" data-testid={`${testid}-${e.kind}-${e.id}`}>
              <span><span className="s">{shortDate(e.date)}</span> {e.what}<span className="s">{e.kind === "expense" ? ` · ${EXPENSE_LABEL[e.category] ?? e.category}` : e.kind === "income" ? ` · ${INCOME_LABEL[e.category] ?? e.category}` : ""}{e.method ? ` · ${METHOD_LABEL[e.method] ?? e.method}` : ""}</span></span>
              <span className="font-mono">{formatCents(e.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
