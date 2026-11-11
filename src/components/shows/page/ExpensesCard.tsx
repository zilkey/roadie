"use client";
import { ExpensesCardFor } from "@/components/money/ExpensesCard";
import type { ShowRow } from "../common";

/** A show's expenses: the shared card pointed at the show. */
export function ExpensesCard({ show, admin }: { show: ShowRow; admin: boolean }) {
  return <ExpensesCardFor target={{ kind: "show", id: show.id }} admin={admin} />;
}
