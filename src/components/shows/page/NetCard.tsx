"use client";
import { useCollection } from "@/lib/firestore-hooks";
import { useDoc } from "@/lib/firestore-hooks";
import { formatCents, sumExpenses, sumIncome, type ExpenseLike } from "@/lib/money";
import type { ShowDeal } from "@/schema";
import type { ShowRow } from "../common";
import { AdminOnlyBadge, ShowCard } from "./kit";

/** Net for the show (admins only): income minus every expense on the show. */
export function NetCard({ show }: { show: ShowRow }) {
  const deal = useDoc<ShowDeal>("showDeals", show.id).doc;
  const expenses = useCollection<ExpenseLike>("expenses", { where: [["showId", "==", show.id]] }).rows ?? [];
  const net = sumIncome(deal?.income ?? []) - sumExpenses(expenses);
  return (
    <ShowCard title="Net for the show" testid="net" badge={<AdminOnlyBadge />} aside={<b style={{ fontSize: "1.375rem" }} data-testid="net-amount">{formatCents(net)}</b>}>{null}</ShowCard>
  );
}
