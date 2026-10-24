/** showDeals.totals: kept by the server whenever a show's income lines or an expense on the show is written. */
import { showTotals, type ExpenseLike } from "@/lib/money";
import type { Doc, Writer } from "./db";

/**
 * Recompute and write showDeals/{showId}.totals from the deal's income lines and the show's expenses. No deal: nothing to do.
 * Writer.query only sees docs already in Firestore (plus this unit's edits to them), so expenses created earlier in the
 * same unit must be passed in `extra`.
 */
export async function refreshDealTotals(w: Writer, showId: string, extra: { expenses?: Doc[] } = {}) {
  const deal = await w.get("showDeals", showId);
  if (!deal || deal.deletedAt) return;
  const merge = (rows: Doc[], more: Doc[] = []) => [...new Map([...rows, ...more].map((d) => [d.id, d])).values()];
  const expenses = merge(await w.query("expenses", (q) => q.where("showId", "==", showId)), extra.expenses);
  const t = showTotals({ income: deal.income as { amount: number }[] | undefined, expenses: expenses as unknown as ExpenseLike[] });
  const cur = deal.totals as { income: number; expenses: number } | undefined;
  if (cur && cur.income === t.income && cur.expenses === t.expenses) return;
  await w.update("showDeals", showId, { totals: { ...t, updatedAt: w.now } });
}
