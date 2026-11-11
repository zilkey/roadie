/** showDeals.totals: kept by the server whenever income, a payout or an expense on the show is written. */
import { showTotals } from "@/lib/money";
import type { Doc, Writer } from "./db";

/**
 * Recompute and write showDeals/{showId}.totals ({ income, paidOut, expenses, updatedAt }) from the show's live income,
 * payouts and expenses. No deal: nothing to do. Writer.query only sees docs already in Firestore (plus this unit's edits
 * to them), so docs created earlier in the same unit must be passed in `extra` (merged by id).
 */
export async function refreshDealTotals(w: Writer, showId: string, extra: { expenses?: Doc[]; income?: Doc[]; payouts?: Doc[] } = {}) {
  const deal = await w.get("showDeals", showId);
  if (!deal || deal.deletedAt) return;
  const merge = (rows: Doc[], more: Doc[] = []) => [...new Map([...rows, ...more].map((d) => [d.id, d])).values()];
  const of = async (kind: "expenses" | "income" | "payouts") => // The overlay brings this unit's edits in whatever their showId is now: a record moved off this show must drop out here.
    merge(await w.query(kind, (q) => q.where("showId", "==", showId)), extra[kind]).filter((d) => d.showId === showId) as unknown as { amount: number; deletedAt?: unknown }[];
  const t = showTotals({ income: await of("income"), payouts: await of("payouts"), expenses: await of("expenses") });
  const cur = deal.totals as { income: number; paidOut?: number; expenses: number } | undefined;
  if (cur && cur.income === t.income && (cur.paidOut ?? 0) === t.paidOut && cur.expenses === t.expenses) return;
  await w.update("showDeals", showId, { totals: { income: t.income, paidOut: t.paidOut, expenses: t.expenses, updatedAt: w.now } });
}
