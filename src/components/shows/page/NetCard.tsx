"use client";
import { useCollection } from "@/lib/firestore-hooks";
import { defaultProject, formatCents, owedExpenses, owedToUs, showTotals, sumExpenses, type ExpenseLike, type IncomeLike, type PayoutLike, type ProjectLike } from "@/lib/money";
import type { ShowRow } from "../common";
import { AdminOnlyBadge, ShowCard } from "./kit";

/** This show's money (admins only), summed from the show's own income, payout and expense records. */
export function NetCard({ show }: { show: ShowRow }) {
  const where: [string, "==", string][] = [["showId", "==", show.id]];
  const income = useCollection<IncomeLike>("income", { where }).rows ?? [];
  const payouts = useCollection<PayoutLike>("payouts", { where }).rows ?? [];
  const expenses = useCollection<ExpenseLike>("expenses", { where }).rows ?? [];
  const projects = useCollection<ProjectLike>("projects").rows ?? [];
  const pid = show.projectId ?? defaultProject(projects)?.id;
  const name = projects.find((p) => p.id === pid)?.name ?? "Band";
  const t = showTotals({ income, payouts, expenses });
  const owed = owedToUs({ income }).total;
  const weOwe = sumExpenses(payouts.filter((p) => !p.paidAt)) + sumExpenses(owedExpenses(expenses));
  const row = (label: string, v: string, testid: string, bold?: boolean) => (
    <div className={`money-row${bold ? " font-bold" : ""}`}><span>{label}</span><span data-testid={testid}>{v}</span></div>
  );
  return (
    <ShowCard title="This show" testid="net-card" badge={<AdminOnlyBadge />}>
      {row("In", formatCents(t.income), "net-in")}
      {row("Paid out", t.paidOut ? formatCents(-t.paidOut) : formatCents(0), "net-paid-out")}
      {row("Expenses", t.expenses ? formatCents(-t.expenses) : formatCents(0), "net-expenses")}
      {row(`Net to ${name}`, formatCents(t.net), "net-net", true)}
      {row("Still owed to us", formatCents(owed), "net-owed-to-us")}
      {row("We still owe", formatCents(weOwe), "net-we-owe")}
    </ShowCard>
  );
}
