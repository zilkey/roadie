// ---------- the yearly tax worksheet (pure; the Money › Taxes pages) ----------
// The band has no account of its own, so each admin reports what went through THEIR account. A year's worksheet for one
// admin is cash-basis, laid out like Schedule C (Form 1040):
//  - Income: received income (by receivedAt) that landed with them (income.receivedBy), split cash vs everything else.
//    Cash is left out of gross receipts (and so the net) unless `includeCash`; its total is still reported.
//  - Expenses: paid expenses (open bills never count) whose cost they bore: whoever paid back a member's expense
//    (paidBackBy, else the reimbursement payout's paidBy), else whoever paid it (userId). A member's expense nobody has paid
//    back yet is still the member's, so it is on no admin's worksheet. Bucketed into Schedule C lines; meals at 50%.
//  - Contract labor (line 11): payouts they paid (paidBy, by paidAt) to anyone but themselves. Reimbursements are
//    transfers (their expenses already count), never labor.
// Not tax advice: it is the numbers sorted the way the form asks for them.

import { countsAsPaidOut, isOwedBill, type ExpenseLike, type IncomeLike, type MoneyTo, type PayoutLike } from "./money";

export interface TaxLine { line: string; label: string }
/** The Schedule C lines Roadie's expense categories land on. Part V ("Other expenses", line 27a → 48) is itemised by category. */
export const TAX_LINES = {
  advertising: { line: "8", label: "Advertising" },
  car: { line: "9", label: "Car and truck expenses" },
  fees: { line: "10", label: "Commissions and fees" },
  labor: { line: "11", label: "Contract labor" },
  rent: { line: "20b", label: "Rent or lease: other business property" },
  supplies: { line: "22", label: "Supplies" },
  travel: { line: "24a", label: "Travel" },
  meals: { line: "24b", label: "Deductible meals" },
  other: { line: "27a", label: "Other expenses (from Part V)" },
} satisfies Record<string, TaxLine>;
export type TaxLineKey = keyof typeof TAX_LINES;
/** Roadie expense category → Schedule C line. Anything not listed is Part V. */
export const EXPENSE_TAX_LINE: Record<string, TaxLineKey> = {
  marketing: "advertising", gas: "car", fees: "fees", space: "rent", gear: "supplies", travel: "travel", lodging: "travel", food: "meals",
};
export const taxLineOf = (category: string): TaxLineKey => EXPENSE_TAX_LINE[category] ?? "other";
/** The order the lines print in. */
export const TAX_LINE_ORDER: TaxLineKey[] = ["advertising", "car", "fees", "labor", "rent", "supplies", "travel", "meals", "other"];
/** Business meals are 50% deductible. */
export const MEALS_PCT = 50;
/** A 1099-NEC is due for a non-employee paid this much or more in the year: $600 through 2025, $2,000 from 2026. */
export const necThreshold = (year: number) => (year >= 2026 ? 200000 : 60000);

/** The IRS standard mileage rate for business, in cents per mile, on a date. 2022 changed on July 1. */
export function mileageRate(date: string): number {
  const y = Number(date.slice(0, 4));
  if (y >= 2026) return 72.5;
  if (y === 2025) return 70;
  if (y === 2024) return 67;
  if (y === 2023) return 65.5;
  if (y === 2022) return date.slice(5) >= "07-01" ? 62.5 : 58.5;
  return 56;
}

/** Whose money an expense finally was: who paid it back, else who paid it. Undefined for an open bill. */
export function bearerOf(x: ExpenseLike, payoutPaidBy: (payoutId: string) => string | undefined): string | undefined {
  if (isOwedBill(x)) return undefined;
  if (x.paidBackAt || x.reimbursedBy) return x.paidBackBy ?? (x.reimbursedBy ? payoutPaidBy(x.reimbursedBy) : undefined) ?? x.userId;
  return x.userId;
}

export interface TaxIncome extends IncomeLike { receivedBy?: string }
export interface TaxExpense extends ExpenseLike { gas?: { miles?: number } }
export interface TaxEntry { id: string; date: string; what: string; amount: number; category: string; kind: "income" | "expense" | "payout"; method?: string; to?: string }
export interface TaxLineTotal { key: TaxLineKey; line: string; label: string; amount: number; /** Meals: the full spend before the 50% cut. */ spent: number; entries: TaxEntry[] }
export interface TaxPayee { key: string; name: string; total: number; count: number; over: boolean }
export interface TaxReport {
  year: number; uid: string;
  /** Whether cash counts in gross receipts (and the net). */
  includeCash: boolean;
  /** Whether line 9 is the standard mileage rate on business miles (else actual gas). */
  useStandardRate: boolean;
  /** Their own gas spent this year (not bandmates' they paid back), counted on line 9 only without `useStandardRate`. */
  gasSpent: number;
  /** With `useStandardRate`: their own gas expenses that have no miles, so they count for nothing. */
  gasWithoutMiles: number;
  income: {
    /** Cash received, counted or not. */
    cash: number; nonCash: number; gross: number;
    /** Non-cash split by method ("unknown" when no method was recorded). */
    byMethod: { method: string; amount: number }[];
    byCategory: { category: string; amount: number }[];
    entries: TaxEntry[];
  };
  lines: TaxLineTotal[];
  /** Part V: other expenses by Roadie category. */
  partV: { category: string; amount: number }[];
  totalExpenses: number;
  net: number;
  /** Miles on this person's own gas expenses that came from an estimate (Part IV, line 44a); bandmates' driving is not theirs. */
  miles: number;
  /** Who they paid as contract labor this year, biggest first, with the 1099-NEC flag. */
  payees: TaxPayee[];
}

const live = <T extends { deletedAt?: unknown }>(xs: readonly T[]) => xs.filter((x) => !x.deletedAt);
const inYear = (date: string | undefined, year: number) => !!date && date.slice(0, 4) === String(year);
const toKey = (to: MoneyTo, musicianUserId?: (id: string) => string | undefined) => {
  const uid = to.userId ?? (to.musicianId ? musicianUserId?.(to.musicianId) : undefined);
  return uid ? `user:${uid}` : to.musicianId ? `musician:${to.musicianId}` : to.contactId ? `contact:${to.contactId}` : `name:${to.name.trim().toLowerCase()}`;
};
const byDate = (a: { date: string }, b: { date: string }) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

export function taxReport(i: {
  year: number; uid: string; includeCash?: boolean; useStandardRate?: boolean;
  income: readonly TaxIncome[]; expenses: readonly TaxExpense[]; payouts: readonly PayoutLike[];
  musicianUserId?(musicianId: string): string | undefined;
}): TaxReport {
  const { year, uid } = i;
  const payoutById = new Map(i.payouts.map((p) => [p.id, p]));

  // Income
  const includeCash = i.includeCash === true;
  const received = live(i.income).filter((x) => x.receivedAt && inYear(x.receivedAt, year) && x.receivedBy === uid);
  const cash = received.filter((x) => x.method === "cash").reduce((n, x) => n + x.amount, 0);
  const inc = includeCash ? received : received.filter((x) => x.method !== "cash");
  const gross = inc.reduce((n, x) => n + x.amount, 0);
  const sumBy = <T,>(xs: readonly T[], key: (x: T) => string, amt: (x: T) => number) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + amt(x));
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const byMethod = sumBy(inc.filter((x) => x.method !== "cash"), (x) => x.method ?? "unknown", (x) => x.amount).map(([method, amount]) => ({ method, amount }));
  const byCategory = sumBy(inc, (x) => x.category, (x) => x.amount).map(([category, amount]) => ({ category, amount }));

  // Expenses
  const lines = new Map<TaxLineKey, TaxLineTotal>(TAX_LINE_ORDER.map((k) => [k, { key: k, ...TAX_LINES[k], amount: 0, spent: 0, entries: [] }]));
  const useStandardRate = i.useStandardRate !== false;
  let miles = 0, gasSpent = 0, gasWithoutMiles = 0;
  const exp = live(i.expenses).filter((x) => inYear(x.date, year) && bearerOf(x, (id) => payoutById.get(id)?.paidBy) === uid);
  for (const x of exp) {
    const l = lines.get(taxLineOf(x.category))!;
    // Only their own driving is miles: gas they paid a bandmate back for stays what it cost (the rate is for your own car).
    const own = x.category === "gas" && x.userId === uid;
    const m = own ? x.gas?.miles ?? 0 : 0;
    if (own) { gasSpent += x.amount; miles += m; }
    if (own && useStandardRate) {
      if (!m) { gasWithoutMiles += 1; continue; }
      const rate = mileageRate(x.date);
      const amount = Math.round(m * rate);
      l.spent += amount;
      l.entries.push({ id: x.id, date: x.date, what: `${x.what} · ${m.toLocaleString("en-US")} mi × ${rate}¢`, amount, category: x.category, kind: "expense", to: x.to?.name });
      continue;
    }
    l.spent += x.amount;
    l.entries.push({ id: x.id, date: x.date, what: x.what, amount: x.amount, category: x.category, kind: "expense", to: x.to?.name });
  }
  const partV = sumBy(lines.get("other")!.entries, (e) => e.category, (e) => e.amount).map(([category, amount]) => ({ category, amount }));

  // Contract labor: payouts they paid, never to themselves, never a reimbursement.
  const labor = lines.get("labor")!;
  const payees = new Map<string, TaxPayee>();
  const pays = live(i.payouts).filter((p) => countsAsPaidOut(p) && p.paidAt && inYear(p.paidAt, year) && p.paidBy === uid);
  for (const p of pays) {
    const key = toKey(p.to, i.musicianUserId);
    if (key === `user:${uid}`) continue;
    labor.spent += p.amount;
    labor.entries.push({ id: p.id, date: p.paidAt!, what: p.what || p.to.name, amount: p.amount, category: "payout", kind: "payout", method: p.method, to: p.to.name });
    const g = payees.get(key) ?? { key, name: p.to.name, total: 0, count: 0, over: false };
    g.total += p.amount; g.count += 1; payees.set(key, g);
  }
  const limit = necThreshold(year);
  for (const g of payees.values()) g.over = g.total >= limit;

  for (const l of lines.values()) {
    l.amount = l.key === "meals" ? Math.round((l.spent * MEALS_PCT) / 100) : l.spent;
    l.entries.sort(byDate);
  }
  const all = TAX_LINE_ORDER.map((k) => lines.get(k)!);
  const totalExpenses = all.reduce((n, l) => n + l.amount, 0);
  return {
    year, uid, includeCash, useStandardRate, gasSpent, gasWithoutMiles,
    income: {
      cash, nonCash: gross - (includeCash ? cash : 0), gross, byMethod, byCategory,
      entries: inc.map((x) => ({ id: x.id, date: x.receivedAt!, what: x.from, amount: x.amount, category: x.category, kind: "income" as const, method: x.method })).sort(byDate),
    },
    lines: all, partV, totalExpenses, net: gross - totalExpenses, miles,
    payees: [...payees.values()].sort((a, b) => b.total - a.total),
  };
}

/** Received income in `year` that nobody is down as having received (logged by Roadie, or before receivedBy existed). */
export function unassignedIncome<T extends TaxIncome>(income: readonly T[], year: number): T[] {
  return live(income).filter((x) => x.receivedAt && inYear(x.receivedAt, year) && !x.receivedBy).sort((a, b) => byDate({ date: a.receivedAt! }, { date: b.receivedAt! }));
}

/** Every year with money that moved, newest first, always including `thisYear`. */
export function moneyYears(i: { income: readonly TaxIncome[]; expenses: readonly ExpenseLike[]; payouts: readonly PayoutLike[] }, thisYear: number): number[] {
  const ys = new Set<number>([thisYear]);
  for (const x of live(i.income)) if (x.receivedAt) ys.add(Number(x.receivedAt.slice(0, 4)));
  for (const x of live(i.expenses)) if (!isOwedBill(x)) ys.add(Number(x.date.slice(0, 4)));
  for (const p of live(i.payouts)) if (p.paidAt) ys.add(Number(p.paidAt.slice(0, 4)));
  return [...ys].filter((y) => y > 1900).sort((a, b) => b - a);
}

/** The year a tax page opens on: last year until filing season is over (through April), else this year. */
export const defaultTaxYear = (today: string) => (Number(today.slice(5, 7)) <= 4 ? Number(today.slice(0, 4)) - 1 : Number(today.slice(0, 4)));
