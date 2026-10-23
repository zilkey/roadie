/** Money is integer cents everywhere. */
export const dollarsToCents = (d: number | string) => Math.round(Number(d) * 100);
export const centsToDollars = (c: number) => c / 100;
export function formatCents(c: number): string {
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

// ---------- ledger math (pure; used by the server and the UI) ----------

export interface LedgerLike {
  id: string; date: string; kind: "income" | "expense" | "payout" | "reimbursement" | "correction"; amount: number; category: string;
  method?: string; showId?: string; payeeUserId?: string; payeeMusicianId?: string; expenseId?: string; reversesId?: string; memo?: string;
}
export interface ExpenseLike { id: string; userId: string; date: string; amount: number; category: string; what: string; showId?: string }

/** Signed effect on the band's balance: income is +, everything else -; a correction undoes the entry it reverses. */
export function netOf(e: LedgerLike, byId: Map<string, LedgerLike>, depth = 0): number {
  if (e.kind === "income") return e.amount;
  if (e.kind !== "correction") return -e.amount;
  const orig = e.reversesId ? byId.get(e.reversesId) : undefined;
  if (!orig || depth > 3) return 0;
  return -netOf(orig, byId, depth + 1);
}
export const indexLedger = <T extends LedgerLike>(l: T[]) => new Map<string, LedgerLike>(l.map((e) => [e.id, e]));
export const reversedIds = (l: LedgerLike[]) => new Set(l.filter((e) => e.kind === "correction" && e.reversesId).map((e) => e.reversesId!));

/** Entries that count in reports: a reversed entry and its correction cancel out, so neither is counted. */
export function effective<T extends LedgerLike>(l: T[]): T[] {
  const rev = reversedIds(l);
  return l.filter((e) => e.kind !== "correction" && !rev.has(e.id));
}
export function totals(l: LedgerLike[]) {
  const by = indexLedger(l);
  let inn = 0, out = 0;
  for (const e of effective(l)) { const n = netOf(e, by); if (n >= 0) inn += n; else out -= n; }
  return { in: inn, out, left: inn - out };
}
/** Net (income positive, spending negative) summed per key. */
function groupNet(l: LedgerLike[], key: (e: LedgerLike) => string | undefined) {
  const by = indexLedger(l);
  const m = new Map<string, { in: number; out: number }>();
  for (const e of effective(l)) {
    const k = key(e); if (k === undefined) continue;
    const n = netOf(e, by);
    const r = m.get(k) ?? { in: 0, out: 0 };
    if (n >= 0) r.in += n; else r.out -= n;
    m.set(k, r);
  }
  return m;
}
const rows = (m: Map<string, { in: number; out: number }>) => [...m].map(([key, v]) => ({ key, ...v, net: v.in - v.out }));
export const byMonth = (l: LedgerLike[]) => rows(groupNet(l, (e) => e.date.slice(0, 7))).sort((a, b) => (a.key < b.key ? -1 : 1));
export const byShow = (l: LedgerLike[]) => rows(groupNet(l, (e) => e.showId)).sort((a, b) => b.net - a.net);
export const byCategory = (l: LedgerLike[]) => rows(groupNet(l, (e) => e.category)).sort((a, b) => b.in + b.out - (a.in + a.out));

/** Latest live reimbursement for an expense that has not been reversed, if any. */
export function reimbursementFor(expenseId: string, l: LedgerLike[]): LedgerLike | undefined {
  const rev = reversedIds(l);
  return l.find((e) => e.kind === "reimbursement" && e.expenseId === expenseId && !rev.has(e.id));
}

export interface OwedLine { key: string; kind: "expense" | "payout"; userId?: string; musicianId?: string; label: string; amount: number; expenseId?: string; showId?: string }
/** What the band owes: unreimbursed expenses plus agreed-but-unpaid show payouts. */
export function owedLines(i: {
  expenses: ExpenseLike[]; ledger: LedgerLike[];
  deals: { id: string; owedPayouts?: { musicianId: string; amount: number }[] }[];
  showName?(id: string): string;
}): OwedLine[] {
  const out: OwedLine[] = [];
  for (const x of i.expenses) {
    if (reimbursementFor(x.id, i.ledger)) continue;
    out.push({ key: `e-${x.id}`, kind: "expense", userId: x.userId, label: x.what, amount: x.amount, expenseId: x.id, showId: x.showId });
  }
  const rev = reversedIds(i.ledger);
  for (const d of i.deals) {
    for (const o of d.owedPayouts ?? []) {
      const paid = i.ledger.filter((e) => e.kind === "payout" && e.showId === d.id && e.payeeMusicianId === o.musicianId && !rev.has(e.id)).reduce((n, e) => n + e.amount, 0);
      const left = o.amount - paid;
      if (left > 0) out.push({ key: `p-${d.id}-${o.musicianId}`, kind: "payout", musicianId: o.musicianId, label: `${i.showName?.(d.id) ?? "Show"} payout`, amount: left, showId: d.id });
    }
  }
  return out;
}

/** Split `total` cents evenly over n people; the first people get the leftover cents. */
export function splitEvenly(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n), extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}
export const CATEGORY_LABEL: Record<string, string> = {
  guarantee: "Guarantee", door: "Tickets / door", merch: "Merch", tips: "Cash tips", venmo: "Venmo", photo: "Photo shoot", video: "Video",
  space: "Room rental", gear: "Gear", marketing: "Marketing", travel: "Travel", fees: "Fees", other: "Other",
};
export const KIND_LABEL: Record<string, string> = { income: "Income", expense: "Spent", payout: "Payout", reimbursement: "Reimbursed", correction: "Correction" };
