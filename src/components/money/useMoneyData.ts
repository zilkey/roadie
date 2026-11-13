"use client";
import { useMemo } from "react";
import { useCollection } from "@/lib/firestore-hooks";
import { incomeSoFar, moneyRows } from "@/lib/money";
import { todayStr } from "@/lib/booking";
import type { Expense, Income, Musician, Payout, Project, Show, User } from "@/schema";

/**
 * Everything the admin Money pages read: the records, money-so-far (a show that hasn't happened yet stays out: its
 * guarantee is dated on the show), the rows that moved, and name lookups.
 */
export function useMoneyData() {
  const income = useCollection<Income>("income");
  const expenses = useCollection<Expense>("expenses");
  const payouts = useCollection<Payout>("payouts");
  const projects = useCollection<Project>("projects");
  const shows = useCollection<Show>("shows");
  const musicians = useCollection<Musician>("musicians");
  const users = useCollection<User>("users");
  const today = todayStr();
  const inc = useMemo(() => incomeSoFar(income.rows ?? [], today), [income.rows, today]);
  const exp = useMemo(() => expenses.rows ?? [], [expenses.rows]);
  const pay = useMemo(() => payouts.rows ?? [], [payouts.rows]);
  const rows = useMemo(() => moneyRows({ income: inc, expenses: exp, payouts: pay }), [inc, exp, pay]);
  const showById = useMemo(() => new Map((shows.rows ?? []).map((s) => [s.id, s])), [shows.rows]);
  const personName = (userId: string) =>
    users.rows?.find((u) => u.id === userId)?.name ?? musicians.rows?.find((m) => m.userId === userId)?.name ?? "Someone";
  const musicianUserId = (mid: string) => musicians.rows?.find((m) => m.id === mid)?.userId;
  const loaded = income.rows !== null && expenses.rows !== null && payouts.rows !== null;
  return { income, expenses, payouts, projects, shows, musicians, users, today, inc, exp, pay, rows, showById, personName, musicianUserId, loaded };
}
