/** showDeals.totals: kept by the server whenever a ledger line or expense on the show is written. */
import { showTotals, type LedgerLike } from "@/lib/money";
import type { Doc, Writer } from "./db";

/**
 * Recompute and write showDeals/{showId}.totals. No deal: nothing to do.
 * Writer.query only sees docs already in Firestore (plus this unit's edits to them), so docs created earlier in the
 * same unit must be passed in `extra`.
 */
export async function refreshDealTotals(w: Writer, showId: string, extra: { ledger?: Doc[]; expenses?: Doc[] } = {}) {
  const deal = await w.get("showDeals", showId);
  if (!deal || deal.deletedAt) return;
  const merge = (rows: Doc[], more: Doc[] = []) => [...new Map([...rows, ...more].map((d) => [d.id, d])).values()];
  const ledger = merge(await w.query("ledger", (q) => q.where("showId", "==", showId)), extra.ledger);
  const expenses = merge(await w.query("expenses", (q) => q.where("showId", "==", showId)), extra.expenses);
  const t = showTotals({ ledger: ledger as unknown as LedgerLike[], expenses: expenses as unknown as { amount: number; deletedAt?: unknown }[] });
  const cur = deal.totals as { income: number; expenses: number } | undefined;
  if (cur && cur.income === t.income && cur.expenses === t.expenses) return;
  await w.update("showDeals", showId, { totals: { ...t, updatedAt: w.now } });
}
