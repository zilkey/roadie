"use client";
import { useState } from "react";
import { MoneyInCard, MoneyOutCard } from "@/components/money/MoneyCards";
import { signed } from "@/components/releases/ReleaseMoney";
import { useCollection } from "@/lib/firestore-hooks";
import { formatCents } from "@/lib/money";
import { todayStr } from "@/lib/booking";
import { dayLabel, tourByDay, tourDays, tourTotals, type TourTotals } from "@/lib/tours";
import type { Expense, Income, Payout, Show, TourEntry } from "@/schema";
import { townOf, type TourRow } from "./common";

const ZERO = { inReceived: 0, inOwed: 0, outPaid: 0, outOwed: 0 };
const inOf = (t: Pick<TourTotals, "inReceived" | "inOwed">) => t.inReceived + t.inOwed;
const outOf = (t: Pick<TourTotals, "outPaid" | "outOwed">) => t.outPaid + t.outOwed;

/**
 * A tour's Money tab (admins only): where it stands (spent, earned, net so far, counting only money tagged with the tour,
 * shows still to come once their date passes), the By day table (every day of the tour with its in, out and net, then the
 * money pinned to no day as "Whole tour", then the total; clicking a row narrows the two cards below to that day's lines,
 * clicking it again clears), then the shared Money in and Money out cards on the tour's tag.
 */
export function TourMoney({ tour }: { tour: TourRow }) {
  const income = useCollection<Income>("income", { where: [["tourId", "==", tour.id]] }).rows ?? [];
  const expenses = useCollection<Expense>("expenses", { where: [["tourId", "==", tour.id]] }).rows ?? [];
  const payouts = useCollection<Payout>("payouts", { where: [["tourId", "==", tour.id]] }).rows ?? [];
  const entries = useCollection<TourEntry>(`tours/${tour.id}/entries`).rows ?? [];
  const shows = useCollection<Show>("shows").rows ?? [];
  const [day, setDay] = useState<string | null | undefined>(undefined);
  const context = { kind: "tour" as const, tourId: tour.id, projectId: tour.projectId };

  const today = todayStr();
  const records = { income, expenses, payouts };
  const t = tourTotals(records, today);
  const spent = outOf(t);
  const earned = inOf(t);
  const net = earned - spent;

  const entryDates = new Map(entries.map((e) => [e.id, e.date] as const));
  const byDay = new Map(tourByDay(records, entryDates, today).map((d) => [d.date, d.totals]));
  const days = tourDays(tour, entries).days;
  /** "Boulder": the show's city when there's a show that day, else where the day's last drive ends. */
  const townOn = (date: string) => {
    const onDay = entries.filter((e) => e.date === date && !e.deletedAt);
    const show = shows.find((s) => onDay.some((e) => e.kind === "show" && e.showId === s.id));
    const drives = onDay.filter((e) => e.kind === "drive").sort((a, b) => a.position - b.position);
    return show?.venue?.city ?? show?.place?.city ?? townOf(drives[drives.length - 1]?.to) ?? "";
  };
  const rows: { key: string; date: string | null; testid: string; label: string; town: string; totals: Pick<TourTotals, "inReceived" | "inOwed" | "outPaid" | "outOwed"> }[] = [
    ...days.map((d) => ({ key: d.date, date: d.date as string | null, testid: `tour-day-${d.date}`, label: dayLabel(d.date), town: townOn(d.date), totals: byDay.get(d.date) ?? ZERO })),
    { key: "whole", date: null, testid: "tour-day-whole", label: "Whole tour", town: "not one day", totals: byDay.get(null) ?? ZERO },
  ];
  // Money pinned to a date that is not one of the tour's days still gets its row.
  for (const [date, totals] of byDay) if (date && !days.some((d) => d.date === date)) rows.splice(rows.length - 1, 0, { key: date, date, testid: `tour-day-${date}`, label: dayLabel(date), town: townOn(date), totals });
  rows.sort((a, b) => (a.date === null ? 1 : b.date === null ? -1 : a.date < b.date ? -1 : 1));
  const cell = (c: number) => (c ? formatCents(c) : "—");

  return (
    <div className="grid gap-5" data-testid="tour-money">
      <section className="card" aria-labelledby="tour-money-h">
        <div className="sg-sech">
          <h2 id="tour-money-h" className="card-h">Where it stands</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="grid gap-1" data-testid="tile-spent">
            <span className="lbl">Spent</span>
            <b className="font-mono text-xl" data-testid="tour-spent-amount">{formatCents(spent)}</b>
            {t.outOwed > 0 && <span className="s">{formatCents(t.outOwed)} of it still owed</span>}
          </div>
          <div className="grid gap-1" data-testid="tile-earned">
            <span className="lbl">Earned</span>
            <b className="font-mono text-xl" data-testid="tour-earned-amount">{formatCents(earned)}</b>
            {t.inOwed > 0 && <span className="s">{formatCents(t.inOwed)} still owed to us</span>}
          </div>
          <div className="grid gap-1" data-testid="tile-net">
            <span className="lbl">Net so far</span>
            <b className="font-mono text-xl" data-testid="tour-net-amount">{signed(net)}</b>
          </div>
        </div>
        <span className="s">Counts only money tagged with this tour, whatever project it&apos;s on. Shows still to come count once their date passes.</span>
      </section>

      <section className="card" aria-labelledby="tour-by-day-h" data-testid="tour-by-day">
        <div className="sg-sech">
          <h2 id="tour-by-day-h" className="card-h">By day</h2>
          <span className="s">
            {day === undefined ? "Click a day to see its lines" : <button type="button" className="font-bold underline" onClick={() => setDay(undefined)} data-testid="tour-day-clear">Show all</button>}
          </span>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-[0.9375rem]">
          <thead>
            <tr className="text-left"><th scope="col" className="lbl py-1">Day</th><th scope="col" className="lbl text-right">In</th><th scope="col" className="lbl text-right">Out</th><th scope="col" className="lbl text-right">Net</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const on = day === r.date;
              return (
                <tr key={r.key} className={`border-t border-divider ${on ? "bg-soft" : ""}`}>
                  <td className="py-2">
                    <button type="button" className="text-left hover:underline" aria-pressed={on} onClick={() => setDay(on ? undefined : r.date)} data-testid={r.testid}>
                      <b>{r.label}</b>{r.town && <span className="text-muted"> · {r.town}</span>}
                    </button>
                  </td>
                  <td className="text-right font-mono">{cell(inOf(r.totals))}</td>
                  <td className="text-right font-mono">{cell(outOf(r.totals))}</td>
                  <td className="text-right font-mono">{inOf(r.totals) || outOf(r.totals) ? signed(inOf(r.totals) - outOf(r.totals)) : "—"}</td>
                </tr>
              );
            })}
            <tr className="border-t border-divider font-bold" data-testid="tour-day-total">
              <td className="py-2">Total</td>
              <td className="text-right font-mono">{formatCents(earned)}</td>
              <td className="text-right font-mono">{formatCents(spent)}</td>
              <td className="text-right font-mono">{signed(net)}</td>
            </tr>
          </tbody>
        </table>
        </div>
      </section>

      <MoneyInCard context={context} day={day} />
      <MoneyOutCard context={context} day={day} />
    </div>
  );
}
