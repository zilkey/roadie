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

// ---------- money: income, expenses and payouts, each on exactly one project (pure; used by the server and the UI) ----------
// Nothing is stored but the records: every balance below is computed when read. The one cache is showDeals.totals
// (src/server/dealTotals.ts), which showTotals() feeds.

export interface ExpenseLike {
  id: string; userId: string; date: string; amount: number; category: string; what: string; showId?: string; projectId?: string;
  payBack?: boolean; paidBackAt?: string; reimbursedBy?: string; deletedAt?: unknown;
}
/** An income doc (src/schema/income.ts). No receivedAt = owed to us. */
export interface IncomeLike {
  id: string; date: string; amount: number; category: string; method?: string; from: string; projectId: string; showId?: string;
  receivedAt?: string; deletedAt?: unknown;
}
/** A payout doc (src/schema/payouts.ts). No paidAt = we owe. */
export interface PayoutLike {
  id: string; to: { musicianId?: string; userId?: string; contactId?: string; name: string }; kind: string; amount: number; what?: string;
  projectId: string; showId?: string; dueDate?: string; paidAt?: string; method?: string; expenseIds?: string[]; deletedAt?: unknown;
}
export interface ProjectLike { id: string; kind: string; name: string; status: string; isDefault?: boolean; deletedAt?: unknown }

/** The project a record belongs to: its projectId, else the default project (records written before `npm run migrate:money`). */
export const projectOf = (x: { projectId?: string }, defaultProjectId: string | undefined) => x.projectId ?? defaultProjectId;
export const defaultProject = <P extends ProjectLike>(projects: readonly P[]) => projects.find((p) => p.isDefault && !p.deletedAt);

export const INCOME_LABEL: Record<string, string> = {
  guarantee: "Guarantee", door: "Door", tips: "Tips", merch: "Merch", streaming: "Streaming", digitalSales: "Digital sales", physical: "CDs and vinyl", preorders: "Pre-orders", crowdfunding: "Crowdfunding",
  sync: "Sync", grant: "Grant", gearSale: "Gear sale", other: "Other",
};
export const EXPENSE_LABEL: Record<string, string> = {
  gear: "Gear", travel: "Travel", lodging: "Lodging", food: "Food", recording: "Recording", mixing: "Mixing", mastering: "Mastering", pressing: "Pressing",
  artwork: "Artwork", photo: "Photo", video: "Video", space: "Room rental", marketing: "Marketing", fees: "Fees", other: "Other",
};
export const PAYOUT_KIND_LABEL: Record<string, string> = { pay: "Pay for playing", split: "Another band's cut", reimbursement: "Paid back", other: "Other" };
export const PROJECT_KIND_LABEL: Record<string, string> = { band: "Band", duo: "Duo", album: "Album", tour: "Tour", video: "Video", other: "Other" };
export const METHOD_LABEL: Record<string, string> = { cash: "Cash", venmo: "Venmo", check: "Check", square: "Square", card: "Card", bank: "Bank", other: "Other" };

// ---------- the four computed views (W2 implements; signatures are the contract) ----------

/** One thing the band still owes someone: an unpaid payout, or a pay-back expense nobody has paid back. */
export interface OwedItem {
  kind: "payout" | "expense"; id: string; amount: number; what: string; date: string; projectId?: string; showId?: string; payoutKind?: string;
}
/**
 * Who the band owes, grouped by person, biggest first. A person is keyed "user:<uid>", "musician:<id>", "contact:<id>"
 * or "name:<name>"; a payout to a musician who has a user id (`musicianUserId`) and that user's expenses land in the
 * same group. `personName(key)` names users and musicians (expenses only carry a userId); payouts carry their own name.
 */
export interface OwedGroup { key: string; name: string; userId?: string; musicianId?: string; contactId?: string; total: number; items: OwedItem[] }
export function weOwe(i: {
  payouts: readonly PayoutLike[]; expenses: readonly ExpenseLike[];
  musicianUserId?(musicianId: string): string | undefined; personName(userId: string): string;
}): OwedGroup[] {
  const groups = new Map<string, OwedGroup>();
  const at = (key: string, name: string, ids: Pick<OwedGroup, "userId" | "musicianId" | "contactId">) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, name, ...ids, total: 0, items: [] }));
    return g;
  };
  for (const p of live(i.payouts)) {
    if (p.paidAt || !countsAsPaidOut(p)) continue;
    const uid = p.to.userId ?? (p.to.musicianId ? i.musicianUserId?.(p.to.musicianId) : undefined);
    const g = uid ? at(`user:${uid}`, p.to.name, { userId: uid, musicianId: p.to.musicianId })
      : p.to.musicianId ? at(`musician:${p.to.musicianId}`, p.to.name, { musicianId: p.to.musicianId })
      : p.to.contactId ? at(`contact:${p.to.contactId}`, p.to.name, { contactId: p.to.contactId })
      : at(`name:${p.to.name}`, p.to.name, {});
    // payouts carry no date of their own: dueDate stands in ("" sorts first)
    g.items.push({ kind: "payout", id: p.id, amount: p.amount, what: p.what || PAYOUT_KIND_LABEL[p.kind] || p.kind, date: p.dueDate ?? "", projectId: p.projectId, showId: p.showId, payoutKind: p.kind });
    g.total += p.amount;
  }
  for (const x of owedExpenses(i.expenses)) {
    const g = at(`user:${x.userId}`, i.personName(x.userId), { userId: x.userId });
    g.items.push({ kind: "expense", id: x.id, amount: x.amount, what: x.what, date: x.date, projectId: x.projectId, showId: x.showId });
    g.total += x.amount;
  }
  for (const g of groups.values()) g.items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

/**
 * Income that has landed or is due: everything received, plus unreceived income dated on or before `today`. A booked
 * show's guarantee is created on the show's date, so a show that hasn't happened yet is dropped until it does.
 */
export function incomeSoFar<T extends { date: string; receivedAt?: string }>(income: readonly T[], today: string): T[] {
  return income.filter((x) => !!x.receivedAt || x.date <= today);
}

/** Money still coming to the band: live income with no receivedAt, oldest first, and the total. */
export function owedToUs(i: { income: readonly IncomeLike[] }): { items: IncomeLike[]; total: number } {
  const items = live(i.income).filter((x) => !x.receivedAt).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { items, total: items.reduce((n, x) => n + x.amount, 0) };
}

/** A project's money: in (all income, owed included), paid out (all payouts), expenses (all, whoever paid), net = in − paidOut − expenses, and what's still open each way. */
export interface MoneyTotals { income: number; paidOut: number; expenses: number; net: number; owedToUs: number; weOwe: number }
export function projectTotals(i: {
  projectId: string; defaultProjectId?: string;
  income: readonly IncomeLike[]; expenses: readonly ExpenseLike[]; payouts: readonly PayoutLike[];
}): MoneyTotals {
  const mine = <T extends { projectId?: string }>(xs: readonly T[]) => xs.filter((x) => projectOf(x, i.defaultProjectId) === i.projectId);
  const income = mine(i.income), payouts = mine(i.payouts).filter(countsAsPaidOut), expenses = mine(i.expenses);
  const inn = sumExpenses(income), paidOut = sumExpenses(payouts), spent = sumExpenses(expenses);
  return {
    income: inn, paidOut, expenses: spent, net: inn - paidOut - spent,
    owedToUs: owedToUs({ income }).total,
    weOwe: sumExpenses(live(payouts).filter((p) => !p.paidAt)) + sumExpenses(owedExpenses(expenses)),
  };
}

/**
 * A show's money, the same sums over showId. Pass only the records on the show (the caller filters); live ones count,
 * owed amounts included; reimbursement payouts are dropped here (their expenses already count). Feeds showDeals.totals.
 */
export function showTotals(i: {
  income?: readonly { amount: number; deletedAt?: unknown }[]; payouts?: readonly { amount: number; kind?: string; deletedAt?: unknown }[];
  expenses: readonly { amount: number; deletedAt?: unknown }[];
}): { income: number; paidOut: number; expenses: number; net: number } {
  const income = sumExpenses(i.income ?? []), paidOut = sumExpenses((i.payouts ?? []).filter((p) => countsAsPaidOut({ kind: p.kind ?? "" }))), expenses = sumExpenses(i.expenses);
  return { income, paidOut, expenses, net: income - paidOut - expenses };
}

export const sumIncome = (lines: readonly { amount: number }[] = []) => lines.reduce((n, l) => n + l.amount, 0);
const live = <T extends { deletedAt?: unknown }>(xs: readonly T[]) => xs.filter((x) => !x.deletedAt);
export const sumExpenses = (xs: readonly { amount: number; deletedAt?: unknown }[]) => live(xs).reduce((n, x) => n + x.amount, 0);

/** The band owes this back: it's a pay-back expense (the default) not yet marked paid back. */
export const owesBack = (x: Pick<ExpenseLike, "payBack" | "paidBackAt">) => x.payBack !== false && !x.paidBackAt;

/** What the band owes people: live pay-back expenses not yet paid back. */
export const owedExpenses = <T extends ExpenseLike>(xs: readonly T[]) => live(xs).filter(owesBack);
/** A reimbursement pays back an expense that is already counted as spent, so it never counts as paid out (or as owed) on top of it. */
export const countsAsPaidOut = (p: { kind: string }) => p.kind !== "reimbursement";


/** One amount in or out, for the Money page's totals and charts. */
export interface MoneyRow { date: string; kind: "income" | "expense" | "payout"; showId?: string; projectId?: string; category: string; in: number; out: number }
/** Live income (by its own date), expenses and payouts (by paidAt, else dueDate; one with neither has no date and is left out). */
export function moneyRows(i: { income: readonly IncomeLike[]; expenses: readonly ExpenseLike[]; payouts: readonly PayoutLike[] }): MoneyRow[] {
  const out: MoneyRow[] = [];
  for (const x of live(i.income)) out.push({ date: x.date, kind: "income", showId: x.showId, projectId: x.projectId, category: x.category, in: x.amount, out: 0 });
  for (const x of live(i.expenses)) out.push({ date: x.date, kind: "expense", showId: x.showId, projectId: x.projectId, category: x.category, in: 0, out: x.amount });
  for (const p of live(i.payouts).filter(countsAsPaidOut)) {
    const date = p.paidAt ?? p.dueDate;
    if (date) out.push({ date, kind: "payout", showId: p.showId, projectId: p.projectId, category: "payout", in: 0, out: p.amount });
  }
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
export const byProject = (rows: readonly MoneyRow[]) => group(rows, (r) => r.projectId).sort((a, b) => b.net - a.net);
export const byCategory = (rows: readonly MoneyRow[]) => group(rows, (r) => r.category).sort((a, b) => b.in + b.out - (a.in + a.out));

/** Split `total` cents evenly over n people; the first people get the leftover cents. */
export function splitEvenly(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n), extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}
/** Every category label in one map (income and expense, plus the legacy ledger values still on old expenses). */
export const CATEGORY_LABEL: Record<string, string> = { ...INCOME_LABEL, ...EXPENSE_LABEL, venmo: "Venmo", door: "Door split", payout: "Paid out" };
