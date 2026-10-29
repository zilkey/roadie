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
//
// The band has no account of its own: every dollar out leaves an admin's or member's personal account. So an expense
// records who was paid (`to`) and who paid (`userId`), a payout who was paid (`to`) and which admin paid (`paidBy`).
// "We owe" is a bill nobody has paid yet (an expense with `owed`), or a payout with no paidAt. A pay-back expense is
// money a member fronted: the band still owes THEM until an admin pays it back, which writes a reimbursement payout.
// That payout is a transfer between people, never money spent, so it is left out of every total and every feed.

/** Who money went to: a band player, a signed-in user, a contact, or just a name (the stored shape always carries the name). */
export interface MoneyTo { musicianId?: string; userId?: string; contactId?: string; name: string }
export interface ExpenseLike {
  id: string; userId: string; date: string; amount: number; category: string; what: string; showId?: string; projectId?: string;
  to?: MoneyTo; owed?: boolean; payBack?: boolean; paidBackAt?: string; paidBackBy?: string; reimbursedBy?: string; deletedAt?: unknown;
}
/** An income doc (src/schema/income.ts). No receivedAt = owed to us. */
export interface IncomeLike {
  id: string; date: string; amount: number; category: string; method?: string; from: string; projectId: string; showId?: string;
  receivedAt?: string; deletedAt?: unknown;
}
/** A payout doc (src/schema/payouts.ts). No paidAt = we owe. */
export interface PayoutLike {
  id: string; to: MoneyTo; kind: string; amount: number; what?: string;
  projectId: string; showId?: string; dueDate?: string; paidAt?: string; method?: string; paidBy?: string; expenseIds?: string[]; deletedAt?: unknown;
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

/** A bill nobody has paid yet ("We owe"): its userId is whoever entered it, not a payer. */
export const isOwedBill = (x: Pick<ExpenseLike, "owed">) => x.owed === true;
/** The band owes this back to the member who paid: paid (not an open bill), pay-back on (the default) and not yet paid back. */
export const owesBack = (x: Pick<ExpenseLike, "owed" | "payBack" | "paidBackAt">) => !isOwedBill(x) && x.payBack !== false && !x.paidBackAt;
/** A reimbursement pays back an expense that is already counted as spent, so it never counts as paid out (or as owed) on top of it. */
export const countsAsPaidOut = (p: { kind: string }) => p.kind !== "reimbursement";
const live = <T extends { deletedAt?: unknown }>(xs: readonly T[]) => xs.filter((x) => !x.deletedAt);
export const sumExpenses = (xs: readonly { amount: number; deletedAt?: unknown }[]) => live(xs).reduce((n, x) => n + x.amount, 0);
export const sumIncome = (lines: readonly { amount: number }[] = []) => lines.reduce((n, l) => n + l.amount, 0);

/** What the band owes people back: live pay-back expenses not yet paid back. */
export const owedExpenses = <T extends ExpenseLike>(xs: readonly T[]) => live(xs).filter(owesBack);
/** Live bills nobody has paid yet. */
export const openBills = <T extends ExpenseLike>(xs: readonly T[]) => live(xs).filter(isOwedBill);
/** Live payouts the band still owes (a reimbursement never counts: its expenses are what is owed). */
export const openPayouts = <T extends PayoutLike>(xs: readonly T[]) => live(xs).filter((p) => !p.paidAt && countsAsPaidOut(p));

// ---------- the computed views ----------

/** One thing the band still owes someone: an unpaid payout, an unpaid bill, or a pay-back expense nobody has paid back. */
export interface OwedItem {
  kind: "payout" | "bill" | "expense"; id: string; amount: number; what: string; date: string; projectId?: string; showId?: string; payoutKind?: string;
}
/**
 * Who the band owes, grouped by person, biggest first. A person is keyed "user:<uid>", "musician:<id>", "contact:<id>"
 * or "name:<name>"; a payout or bill to a musician who has a user id (`musicianUserId`) and that user's pay-back
 * expenses land in the same group. `personName(key)` names users (pay-back expenses only carry a userId); payouts and
 * bills carry their own name. A bill with no `to` is grouped under its own description.
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
  const groupFor = (to: MoneyTo) => {
    const uid = to.userId ?? (to.musicianId ? i.musicianUserId?.(to.musicianId) : undefined);
    return uid ? at(`user:${uid}`, to.name, { userId: uid, musicianId: to.musicianId })
      : to.musicianId ? at(`musician:${to.musicianId}`, to.name, { musicianId: to.musicianId })
      : to.contactId ? at(`contact:${to.contactId}`, to.name, { contactId: to.contactId })
      : at(`name:${to.name}`, to.name, {});
  };
  for (const p of openPayouts(i.payouts)) {
    const g = groupFor(p.to);
    // payouts carry no date of their own: dueDate stands in ("" sorts first)
    g.items.push({ kind: "payout", id: p.id, amount: p.amount, what: p.what || PAYOUT_KIND_LABEL[p.kind] || p.kind, date: p.dueDate ?? "", projectId: p.projectId, showId: p.showId, payoutKind: p.kind });
    g.total += p.amount;
  }
  for (const x of openBills(i.expenses)) {
    const g = groupFor(x.to ?? { name: x.what });
    g.items.push({ kind: "bill", id: x.id, amount: x.amount, what: x.what, date: x.date, projectId: x.projectId, showId: x.showId });
    g.total += x.amount;
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
 * show's guarantee is created on the show's date, so a show that hasn't happened yet is dropped until it does. Every
 * money view goes through this; the one place a future show's money appears is incomeExpected.
 */
export function incomeSoFar<T extends { date: string; receivedAt?: string; deletedAt?: unknown }>(income: readonly T[], today: string): T[] {
  return live(income).filter((x) => !!x.receivedAt || x.date <= today);
}
/** The opposite: money booked for shows that haven't happened yet (unreceived, dated after `today`), soonest first. */
export function incomeExpected<T extends { date: string; amount: number; receivedAt?: string; deletedAt?: unknown }>(income: readonly T[], today: string): { items: T[]; total: number } {
  const items = live(income).filter((x) => !x.receivedAt && x.date > today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { items, total: items.reduce((n, x) => n + x.amount, 0) };
}

/** Money still coming to the band: live income with no receivedAt, oldest first, and the total. */
export function owedToUs(i: { income: readonly IncomeLike[] }): { items: IncomeLike[]; total: number } {
  const items = live(i.income).filter((x) => !x.receivedAt).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { items, total: items.reduce((n, x) => n + x.amount, 0) };
}

/**
 * A project's money, paid and owed kept apart. In: received income, and income still owed to us (the caller has already
 * dropped future shows). Out: what was actually paid (expenses whoever paid them, plus paid payouts) and what is still
 * owed (open bills and unpaid payouts). net is actual money: received − paid; netIfSettled is what it becomes once
 * everything owed each way settles. weOwe is the We owe list's total: outOwed plus pay-back expenses the band hasn't
 * paid back (already in outPaid, since the vendor was paid; they only change whose pocket it came from).
 */
export interface MoneyTotals { inReceived: number; inOwed: number; outPaid: number; outOwed: number; net: number; netIfSettled: number; weOwe: number }
export function projectTotals(i: {
  projectId: string; defaultProjectId?: string;
  income: readonly IncomeLike[]; expenses: readonly ExpenseLike[]; payouts: readonly PayoutLike[];
}): MoneyTotals {
  const mine = <T extends { projectId?: string }>(xs: readonly T[]) => xs.filter((x) => projectOf(x, i.defaultProjectId) === i.projectId);
  return moneyTotals({ income: mine(i.income), expenses: mine(i.expenses), payouts: mine(i.payouts) });
}
/** The same sums over whatever records are passed (the whole band, a project, a show). */
export function moneyTotals(i: { income: readonly IncomeLike[]; expenses: readonly ExpenseLike[]; payouts: readonly PayoutLike[] }): MoneyTotals {
  const income = live(i.income), expenses = live(i.expenses), payouts = live(i.payouts).filter(countsAsPaidOut);
  const sum = (xs: readonly { amount: number }[]) => xs.reduce((n, x) => n + x.amount, 0);
  const inReceived = sum(income.filter((x) => !!x.receivedAt)), inOwed = sum(income.filter((x) => !x.receivedAt));
  const outPaid = sum(expenses.filter((x) => !isOwedBill(x))) + sum(payouts.filter((p) => !!p.paidAt));
  const outOwed = sum(expenses.filter(isOwedBill)) + sum(payouts.filter((p) => !p.paidAt));
  return {
    inReceived, inOwed, outPaid, outOwed, net: inReceived - outPaid, netIfSettled: inReceived + inOwed - outPaid - outOwed,
    weOwe: outOwed + sum(expenses.filter(owesBack)),
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

/** One amount that actually moved, for the Money page's totals and charts. `payer` is whose account it left (expenses: userId; payouts: paidBy). */
export interface MoneyRow { date: string; kind: "income" | "expense" | "payout"; showId?: string; projectId?: string; category: string; payer?: string; in: number; out: number }
/**
 * Money that moved: received income (by its own date), paid expenses (open bills are left out) and paid payouts (by
 * paidAt; reimbursements are transfers, not spending, and are left out). Owed amounts never reach the charts.
 */
export function moneyRows(i: { income: readonly IncomeLike[]; expenses: readonly ExpenseLike[]; payouts: readonly PayoutLike[] }): MoneyRow[] {
  const out: MoneyRow[] = [];
  for (const x of live(i.income)) if (x.receivedAt) out.push({ date: x.date, kind: "income", showId: x.showId, projectId: x.projectId, category: x.category, in: x.amount, out: 0 });
  for (const x of live(i.expenses)) if (!isOwedBill(x)) out.push({ date: x.date, kind: "expense", showId: x.showId, projectId: x.projectId, category: x.category, payer: x.userId, in: 0, out: x.amount });
  for (const p of live(i.payouts).filter(countsAsPaidOut)) {
    if (p.paidAt) out.push({ date: p.paidAt, kind: "payout", showId: p.showId, projectId: p.projectId, category: "payout", payer: p.paidBy, in: 0, out: p.amount });
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
/** Who paid what out of their own pocket, biggest first: money out with a known payer (a record with none is left out). */
export const byPayer = (rows: readonly MoneyRow[]) => group(rows.filter((r) => r.out > 0), (r) => r.payer).sort((a, b) => b.out - a.out);

/** Split `total` cents evenly over n people; the first people get the leftover cents. */
export function splitEvenly(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n), extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}
/** Every category label in one map (income and expense, plus the legacy ledger values still on old expenses). */
export const CATEGORY_LABEL: Record<string, string> = { ...INCOME_LABEL, ...EXPENSE_LABEL, venmo: "Venmo", door: "Door split", payout: "Paid out" };
