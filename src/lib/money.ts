/** Money is integer cents everywhere. */
export const dollarsToCents = (d: number | string) => Math.round(Number(d) * 100);
export const centsToDollars = (c: number) => c / 100;
export function formatCents(c: number): string {
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}
/** "$1,234.50", "1234.5", "12" -> cents; null when it isn't a non-negative amount. */
export function parseDollars(text: string): number | null {
  const s = text.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(s)) return null;
  return dollarsToCents(s);
}

// ---------- show money: income lines (on the deal) and expenses (pure; used by the server and the UI) ----------
// There is no ledger: a show's income is the lines on its deal, what was spent is the expenses on it.

export interface IncomeLineLike { id: string; category: string; amount: number; method?: string; received: boolean }
export interface ExpenseLike {
  id: string; userId: string; date: string; amount: number; category: string; what: string; showId?: string;
  payBack?: boolean; paidBackAt?: string; deletedAt?: unknown;
}

export const INCOME_LABEL: Record<string, string> = { guarantee: "Guarantee", door: "Door split", tips: "Tips", merch: "Merch", other: "Other" };
export const METHOD_LABEL: Record<string, string> = { cash: "Cash", venmo: "Venmo", check: "Check", square: "Square", card: "Card", bank: "Bank", other: "Other" };

export const sumIncome = (lines: readonly { amount: number }[] = []) => lines.reduce((n, l) => n + l.amount, 0);
const live = <T extends { deletedAt?: unknown }>(xs: readonly T[]) => xs.filter((x) => !x.deletedAt);
export const sumExpenses = (xs: readonly { amount: number; deletedAt?: unknown }[]) => live(xs).reduce((n, x) => n + x.amount, 0);

/** The band owes this back: it's a pay-back expense (the default) not yet marked paid back. */
export const owesBack = (x: Pick<ExpenseLike, "payBack" | "paidBackAt">) => x.payBack !== false && !x.paidBackAt;

/** A show's totals (showDeals.totals, the Played table, Net): every income line, and every live expense on the show. */
export function showTotals(i: { income?: readonly { amount: number }[]; expenses: readonly { amount: number; deletedAt?: unknown }[] }): { income: number; expenses: number } {
  return { income: sumIncome(i.income), expenses: sumExpenses(i.expenses) };
}

/** What the band owes people: live pay-back expenses not yet paid back. */
export const owedExpenses = <T extends ExpenseLike>(xs: readonly T[]) => live(xs).filter(owesBack);

/**
 * Money the band is still waiting on: income lines not marked received, on shows dated today or earlier
 * (a later show's guarantee isn't due yet) that weren't canceled or dropped. Oldest show first.
 * Merch is left out: unverified merch orders are their own thing (story 31), not a show waiting to pay.
 */
export function unreceivedIncome<L extends IncomeLineLike>(i: {
  deals: readonly { id: string; income?: readonly L[]; deletedAt?: unknown }[];
  show(id: string): { date: string; status: string; deletedAt?: unknown } | undefined;
  today: string;
}): { showId: string; date: string; lines: L[]; total: number }[] {
  const out: { showId: string; date: string; lines: L[]; total: number }[] = [];
  for (const d of live(i.deals)) {
    const s = i.show(d.id);
    if (!s || s.deletedAt || s.status === "canceled" || s.status === "dropped" || s.date > i.today) continue;
    const lines = (d.income ?? []).filter((l) => !l.received && l.amount > 0 && l.category !== "merch");
    if (lines.length) out.push({ showId: d.id, date: s.date, lines, total: sumIncome(lines) });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** One amount in or out, for the Money page's totals and charts. */
export interface MoneyRow { date: string; showId?: string; category: string; in: number; out: number }
export function moneyRows(i: {
  deals: readonly { id: string; income?: readonly IncomeLineLike[]; deletedAt?: unknown }[];
  expenses: readonly ExpenseLike[];
  showDate(id: string): string | undefined;
}): MoneyRow[] {
  const out: MoneyRow[] = [];
  for (const d of live(i.deals)) {
    const date = i.showDate(d.id);
    if (!date) continue;
    for (const l of d.income ?? []) out.push({ date, showId: d.id, category: l.category, in: l.amount, out: 0 });
  }
  for (const x of live(i.expenses)) out.push({ date: x.date, showId: x.showId, category: x.category, in: 0, out: x.amount });
  return out;
}
export function totals(rows: readonly MoneyRow[]) {
  const inn = rows.reduce((n, r) => n + r.in, 0), out = rows.reduce((n, r) => n + r.out, 0);
  return { in: inn, out, left: inn - out };
}
function group(rows: readonly MoneyRow[], key: (r: MoneyRow) => string | undefined) {
  const m = new Map<string, { in: number; out: number }>();
  for (const r of rows) {
    const k = key(r); if (k === undefined) continue;
    const g = m.get(k) ?? { in: 0, out: 0 };
    g.in += r.in; g.out += r.out; m.set(k, g);
  }
  return [...m].map(([k, v]) => ({ key: k, ...v, net: v.in - v.out }));
}
export const byMonth = (rows: readonly MoneyRow[]) => group(rows, (r) => r.date.slice(0, 7)).sort((a, b) => (a.key < b.key ? -1 : 1));
export const byShow = (rows: readonly MoneyRow[]) => group(rows, (r) => r.showId).sort((a, b) => b.net - a.net);
export const byCategory = (rows: readonly MoneyRow[]) => group(rows, (r) => r.category).sort((a, b) => b.in + b.out - (a.in + a.out));

/** Split `total` cents evenly over n people; the first people get the leftover cents. */
export function splitEvenly(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n), extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}
export const CATEGORY_LABEL: Record<string, string> = {
  guarantee: "Guarantee", door: "Door split", merch: "Merch", tips: "Tips", venmo: "Venmo", photo: "Photo shoot", video: "Video",
  space: "Room rental", gear: "Gear", marketing: "Marketing", travel: "Travel", fees: "Fees", other: "Other",
};
