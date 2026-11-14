// ---------- the Money sheet: two tables Roadie keeps in an admin's own Google Sheet (pure; the server sends them) ----------
// Settings › Google › Money sheet. Every send rewrites both tables in full, so a fix in Roadie always reaches the sheet and
// nothing has to remember what was sent. The sheet's own formulas total them, e.g.
//   =SUMIFS(Roadie_income[Amount], Roadie_income[Year], 2026, Roadie_income[Month], "Jan", Roadie_income[Cash], FALSE)
// "Just mine" is the same rows as that admin's Taxes page (src/lib/taxes.ts): income they received, expenses whose cost
// they bore, payouts they paid. "The whole band's" is everything that moved. Owed money never goes (only money that moved),
// and reimbursements never do (their expenses already count).

import { countsAsPaidOut, EXPENSE_LABEL, INCOME_LABEL, isOwedBill, METHOD_LABEL, PAYOUT_KIND_LABEL, type ExpenseLike, type IncomeLike, type MoneyTo, type PayoutLike } from "./money";
import { bearerOf, MEALS_PCT, TAX_LINES, taxLineOf } from "./taxes";

export type MoneySheetWhose = "mine" | "band";
/** How a column is typed in the sheet's table. `link` is a text column whose cells are =HYPERLINK(url, "open"). */
export type SheetColumnKind = "date" | "number" | "currency" | "text" | "boolean" | "link";
export interface SheetColumn { name: string; kind: SheetColumnKind }
/** A cell: a date is "YYYY-MM-DD", a link is its URL, null is blank. */
export type SheetValue = string | number | boolean | null;
export interface SheetTable { tab: string; name: string; columns: SheetColumn[]; rows: SheetValue[][] }
/** A row that went out with a blank a formula may need, or (Just mine) received income nobody is down as receiving. */
export interface SheetBlank { id: string; kind: "income" | "expense"; what: string; date: string; why: "no_method" | "no_receiver"; href: string }

export const INCOME_TAB = "Roadie income", EXPENSES_TAB = "Roadie expenses";
export const INCOME_TABLE = "Roadie_income", EXPENSES_TABLE = "Roadie_expenses";
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const col = (name: string, kind: SheetColumnKind): SheetColumn => ({ name, kind });
export const INCOME_COLUMNS: SheetColumn[] = [
  col("Date", "date"), col("Year", "number"), col("Month", "text"), col("Amount", "currency"), col("Cash", "boolean"), col("Method", "text"),
  col("Category", "text"), col("From", "text"), col("Show", "text"), col("Project", "text"), col("Received by", "text"), col("Notes", "text"), col("Roadie", "link"),
];
export const EXPENSE_COLUMNS: SheetColumn[] = [
  col("Date", "date"), col("Year", "number"), col("Month", "text"), col("Amount", "currency"), col("Kind", "text"), col("Category", "text"),
  col("Tax line", "text"), col("Deductible", "currency"), col("What", "text"), col("Paid to", "text"), col("Paid by", "text"), col("Miles", "number"),
  col("Project", "text"), col("Show", "text"), col("Roadie", "link"),
];

interface SheetIncome extends IncomeLike { receivedBy?: string; notes?: string }
interface SheetExpense extends ExpenseLike { gas?: { miles?: number } }
interface SheetShow { id: string; date?: string; name: string }
interface SheetProject { id: string; name: string }

export interface MoneySheetInput {
  whose: MoneySheetWhose;
  /** The admin the sheet belongs to (Just mine). */
  uid: string;
  income: readonly SheetIncome[]; expenses: readonly SheetExpense[]; payouts: readonly PayoutLike[];
  shows: readonly SheetShow[]; projects: readonly SheetProject[];
  /** The default project's id: a record without a projectId is on it. */
  defaultProjectId?: string;
  personName(uid: string): string;
  musicianUserId?(musicianId: string): string | undefined;
  /** The artist's base URL, e.g. https://app.myroadie.online/artists/ingrid-avison-band */
  base: string;
}

const live = <T extends { deletedAt?: unknown }>(xs: readonly T[]) => xs.filter((x) => !x.deletedAt);
const dollars = (cents: number) => Math.round(cents) / 100;
const yearOf = (d: string) => Number(d.slice(0, 4));
const monthOf = (d: string) => MONTHS[Number(d.slice(5, 7)) - 1] ?? "";
const shortDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const isSelf = (to: MoneyTo, uid: string | undefined, musicianUserId?: (id: string) => string | undefined) =>
  !!uid && (to.userId === uid || (!!to.musicianId && musicianUserId?.(to.musicianId) === uid));

/** Both tables, oldest row first, and the rows a formula may trip on. */
export function moneySheetTables(i: MoneySheetInput): { income: SheetTable; expenses: SheetTable; blanks: SheetBlank[] } {
  const mine = i.whose === "mine";
  const shows = new Map(i.shows.map((s) => [s.id, s]));
  const projects = new Map(i.projects.map((p) => [p.id, p.name]));
  const showLabel = (id?: string) => { const s = id ? shows.get(id) : undefined; return s ? (s.date ? `${s.name} · ${shortDate(s.date)}` : s.name) : null; };
  const projectName = (id?: string) => projects.get(id ?? i.defaultProjectId ?? "") ?? null;
  const href = (r: { showId?: string; projectId?: string }) =>
    r.showId ? `${i.base}/shows/${r.showId}` : `${i.base}/money/projects/${r.projectId ?? i.defaultProjectId ?? ""}`;
  const blanks: SheetBlank[] = [];

  // Income: received (cash basis, by receivedAt), and for Just mine, received by this admin.
  const received = live(i.income).filter((x) => !!x.receivedAt);
  for (const x of received) {
    if (mine && !x.receivedBy) blanks.push({ id: x.id, kind: "income", what: x.from, date: x.receivedAt!, why: "no_receiver", href: href(x) });
  }
  const inc = received.filter((x) => !mine || x.receivedBy === i.uid).sort((a, b) => cmp(a.receivedAt!, b.receivedAt!));
  const incomeRows = inc.map((x): SheetValue[] => {
    const d = x.receivedAt!;
    if (!x.method) blanks.push({ id: x.id, kind: "income", what: x.from, date: d, why: "no_method", href: href(x) });
    return [
      d, yearOf(d), monthOf(d), dollars(x.amount), x.method ? x.method === "cash" : null, x.method ? METHOD_LABEL[x.method] ?? x.method : null,
      INCOME_LABEL[x.category] ?? x.category, x.from, showLabel(x.showId), projectName(x.projectId), x.receivedBy ? i.personName(x.receivedBy) : null,
      x.notes?.trim() || null, href(x),
    ];
  });

  // Expenses: paid ones (open bills never), by whoever bore the cost; payouts paid (never reimbursements, never to the payer).
  const payoutById = new Map(i.payouts.map((p) => [p.id, p]));
  type Row = { date: string; cells: SheetValue[] };
  const out: Row[] = [];
  for (const x of live(i.expenses)) {
    if (isOwedBill(x)) continue;
    const bearer = bearerOf(x, (id) => payoutById.get(id)?.paidBy);
    if (mine && bearer !== i.uid) continue;
    const line = TAX_LINES[taxLineOf(x.category)];
    const deductible = x.category === "food" ? Math.round((x.amount * MEALS_PCT) / 100) : x.amount;
    out.push({ date: x.date, cells: [
      x.date, yearOf(x.date), monthOf(x.date), dollars(x.amount), "Expense", EXPENSE_LABEL[x.category] ?? x.category,
      `${line.line} ${line.label}`, dollars(deductible), x.what, x.to?.name ?? null, bearer ? i.personName(bearer) : null, x.gas?.miles ?? null,
      projectName(x.projectId), showLabel(x.showId), href(x),
    ] });
  }
  for (const p of live(i.payouts)) {
    if (!countsAsPaidOut(p) || !p.paidAt) continue;
    if (mine && p.paidBy !== i.uid) continue;
    if (isSelf(p.to, p.paidBy, i.musicianUserId)) continue;
    const line = TAX_LINES.labor;
    out.push({ date: p.paidAt, cells: [
      p.paidAt, yearOf(p.paidAt), monthOf(p.paidAt), dollars(p.amount), "Payout", PAYOUT_KIND_LABEL[p.kind] ?? p.kind,
      `${line.line} ${line.label}`, dollars(p.amount), p.what?.trim() || p.to.name, p.to.name, p.paidBy ? i.personName(p.paidBy) : null, null,
      projectName(p.projectId), showLabel(p.showId), href(p),
    ] });
  }
  out.sort((a, b) => cmp(a.date, b.date));

  return {
    income: { tab: INCOME_TAB, name: INCOME_TABLE, columns: INCOME_COLUMNS, rows: incomeRows },
    expenses: { tab: EXPENSES_TAB, name: EXPENSES_TABLE, columns: EXPENSE_COLUMNS, rows: out.map((r) => r.cells) },
    blanks: blanks.sort((a, b) => cmp(a.date, b.date)),
  };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A spreadsheet id from what an admin pastes: a Sheets link (…/spreadsheets/d/{id}/…) or the bare id. */
export function spreadsheetIdFrom(v: string): string | null {
  const s = v.trim();
  const m = /\/spreadsheets\/d\/([\w-]+)/.exec(s);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(s) ? s : null;
}

/** Days since 1899-12-30: how Google Sheets stores a date. */
export function sheetSerial(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}
