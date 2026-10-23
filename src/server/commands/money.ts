import { z } from "zod";
import { run, type Writer } from "../db";
import { AppError } from "../errors";
import { defineCommand } from "./types";
import { driveClient } from "../integrations";
import { LedgerInput, ledgerCategory, driveRef } from "@/schema";
import { reversedIds, reimbursementFor, owedLines, type LedgerLike } from "@/lib/money";

const todayServer = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const method = z.enum(["cash", "venmo", "check", "card", "bank", "other"]);

const ledgerOf = (w: Writer, expenseId: string) => w.query("ledger", (q) => q.where("expenseId", "==", expenseId)) as Promise<LedgerLike[]>;

async function userIdForMusician(w: Writer, musicianId: string): Promise<string | undefined> {
  const m = await w.get("musicians", musicianId);
  if (!m || m.deletedAt) throw new AppError("not_found", `Musician ${musicianId} not found`, 404);
  if (m.userId) return m.userId as string;
  const us = await w.query("users", (q) => q.where("musicianId", "==", musicianId).limit(1));
  return us[0]?.id;
}

/**
 * The one place ledger entries are created. Entries are immutable (db.ts refuses update/delete);
 * mistakes get a `correction` that reverses exactly one earlier entry.
 */
export async function addLedgerEntry(w: Writer, entry: Record<string, unknown>) {
  const e = entry as { kind: string; amount: number; reversesId?: string; expenseId?: string; showId?: string; payeeUserId?: string; payeeMusicianId?: string };
  if (e.kind !== "correction" && e.reversesId) throw new AppError("invalid_input", "Only a correction can have reversesId", 400);
  if (e.showId && !(await w.get("shows", e.showId))) throw new AppError("not_found", `Show ${e.showId} not found`, 404);
  if (e.kind === "correction") {
    const orig = await w.get("ledger", e.reversesId!);
    if (!orig) throw new AppError("not_found", "The entry to correct does not exist", 404);
    if (orig.kind === "correction") throw new AppError("invalid_state", "A correction cannot be corrected; record a new entry instead", 409);
    if (reversedIds(await w.query("ledger", (q) => q.where("reversesId", "==", orig.id)) as LedgerLike[]).has(orig.id)) {
      throw new AppError("already_corrected", "That entry was already corrected", 409);
    }
    if (e.amount !== orig.amount) throw new AppError("invalid_input", "A correction must have the same amount as the entry it reverses", 400);
  }
  if (e.kind === "reimbursement") {
    if (!e.expenseId) throw new AppError("invalid_input", "A reimbursement needs expenseId", 400);
    const x = await w.get("expenses", e.expenseId);
    if (!x) throw new AppError("not_found", "Expense not found", 404);
    if (reimbursementFor(e.expenseId, await ledgerOf(w, e.expenseId))) throw new AppError("already_reimbursed", "That expense was already paid back", 409);
  }
  if (e.kind === "payout" && !e.payeeUserId && !e.payeeMusicianId) throw new AppError("invalid_input", "A payout needs payeeUserId or payeeMusicianId", 400);
  const out = { ...entry };
  if (e.payeeMusicianId && !e.payeeUserId) {
    const u = await userIdForMusician(w, e.payeeMusicianId);
    if (u) out.payeeUserId = u;
  }
  return w.create("ledger", out);
}

// ---------- ledger ----------

export const ledgerRecord = defineCommand({
  name: "ledger.record", roles: ["admin", "mcp"], input: LedgerInput,
  description:
    "Record any money in or out (photo shoot, video, room rental, tips...). kind: income|expense|payout|reimbursement|correction; amount in cents, always positive. " +
    "Entries are never edited or deleted: a correction needs reversesId and the same amount (prefer ledger.correct).",
  run: (ctx, input) => run(ctx, (w) => addLedgerEntry(w, input as Record<string, unknown>)),
});

export const ledgerCorrect = defineCommand({
  name: "ledger.correct", roles: ["admin", "mcp"],
  description: "Reverse a ledger entry by adding a correction entry (same amount, reversesId set). The original stays. Record the right entry afterwards if needed.",
  input: z.strictObject({ reversesId: z.string().min(1), memo: z.string().optional(), date: dateStr.optional() }),
  run: (ctx, i) => run(ctx, async (w) => {
    const o = await w.get("ledger", i.reversesId);
    if (!o) throw new AppError("not_found", "The entry to correct does not exist", 404);
    const keep = ["category", "method", "showId", "rehearsalId", "payeeUserId", "payeeMusicianId", "expenseId"] as const;
    return addLedgerEntry(w, {
      date: i.date ?? todayServer(), kind: "correction", amount: o.amount, reversesId: o.id, memo: i.memo ?? `Reverses ${o.kind} of ${o.date}`,
      ...Object.fromEntries(keep.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])),
    });
  }),
});

// ---------- settle a show ----------

const IncomeLine = z.strictObject({
  category: z.enum(["guarantee", "door", "merch", "tips", "venmo"]), amount: z.number().int().positive(),
  method: method.optional(), memo: z.string().optional(),
});
const PayoutLine = z.strictObject({ musicianId: z.string().min(1), amount: z.number().int().positive(), paid: z.boolean().default(true), method: method.default("venmo") });
const DEFAULT_METHOD = { guarantee: "check", door: "cash", merch: "cash", tips: "cash", venmo: "venmo" } as const;

export const showsSettle = defineCommand({
  name: "shows.settle", roles: ["admin", "mcp"],
  description:
    "Enter the money after a show: income lines (guarantee|door|merch|tips|venmo, cents) and payouts to people who played. paid:true writes a payout ledger entry, " +
    "paid:false remembers it as owed. All entries and showDeals.settled=true are written in one transaction. Payouts cannot exceed income.",
  input: z.strictObject({ id: z.string().min(1), income: z.array(IncomeLine).min(1), payouts: z.array(PayoutLine).default([]) }),
  run: (ctx, i) => run(ctx, async (w) => {
    const show = await w.get("shows", i.id);
    if (!show || show.deletedAt) throw new AppError("not_found", "Show not found", 404);
    if (show.status === "canceled") throw new AppError("invalid_state", "This show was canceled", 409);
    const deal = await w.get("showDeals", i.id);
    if (!deal) throw new AppError("not_found", "Show deal not found", 404);
    if (deal.settled) throw new AppError("already_settled", "The money for this show is already entered", 409);
    const inTotal = i.income.reduce((n, l) => n + l.amount, 0);
    const outTotal = i.payouts.reduce((n, l) => n + l.amount, 0);
    if (outTotal > inTotal) throw new AppError("over_allocated", "Payouts add up to more than the money in", 400);
    if (new Set(i.payouts.map((p) => p.musicianId)).size !== i.payouts.length) throw new AppError("invalid_input", "Each person can appear once in payouts", 400);
    const ids: string[] = [];
    for (const l of i.income) {
      ids.push((await addLedgerEntry(w, { date: show.date, kind: "income", amount: l.amount, category: l.category, method: l.method ?? DEFAULT_METHOD[l.category], showId: i.id, ...(l.memo ? { memo: l.memo } : {}) })).id);
    }
    const owed: { musicianId: string; amount: number }[] = [];
    for (const p of i.payouts) {
      const userId = await userIdForMusician(w, p.musicianId);
      if (p.paid) {
        ids.push((await addLedgerEntry(w, {
          date: todayServer(), kind: "payout", amount: p.amount, category: "other", method: p.method, showId: i.id, payeeMusicianId: p.musicianId,
          ...(userId ? { payeeUserId: userId } : {}), memo: `${show.venue.name} payout`,
        })).id);
      } else owed.push({ musicianId: p.musicianId, amount: p.amount });
    }
    await w.update("showDeals", i.id, { settled: true, owedPayouts: owed.length ? owed : null });
    return { id: i.id, ledgerIds: ids, in: inTotal, paidOut: i.payouts.filter((p) => p.paid).reduce((n, p) => n + p.amount, 0), owed: owed.length };
  }),
});

export const payoutsPay = defineCommand({
  name: "payouts.pay", roles: ["admin", "mcp"],
  description: "Pay a show payout that was left owed when the show was settled (writes a payout ledger entry; amount defaults to what is still owed).",
  input: z.strictObject({ showId: z.string().min(1), musicianId: z.string().min(1), amount: z.number().int().positive().optional(), method: method.default("venmo") }),
  run: (ctx, i) => run(ctx, async (w) => {
    const deal = await w.get("showDeals", i.showId);
    const show = await w.get("shows", i.showId);
    if (!deal || !show) throw new AppError("not_found", "Show not found", 404);
    const led = (await w.query("ledger", (q) => q.where("showId", "==", i.showId))) as LedgerLike[];
    const line = owedLines({ expenses: [], ledger: led, deals: [{ id: i.showId, owedPayouts: deal.owedPayouts }] }).find((l) => l.musicianId === i.musicianId);
    if (!line) throw new AppError("nothing_owed", "Nothing is owed to that person for this show", 409);
    const amount = i.amount ?? line.amount;
    if (amount > line.amount) throw new AppError("over_allocated", "That is more than is owed", 400);
    const userId = await userIdForMusician(w, i.musicianId);
    return addLedgerEntry(w, {
      date: todayServer(), kind: "payout", amount, category: "other", method: i.method, showId: i.showId, payeeMusicianId: i.musicianId,
      ...(userId ? { payeeUserId: userId } : {}), memo: `${show.venue.name} payout`,
    });
  }),
});

// ---------- expenses ----------

export const expensesAdd = defineCommand({
  name: "expenses.add", roles: ["admin", "member"],
  description: "Add an expense: amount in cents, what it was for, category, optional showId and receipt (Drive link). Cannot be changed afterwards. Members add their own; admins may pass userId.",
  input: z.strictObject({
    amount: z.number().int().positive(), what: z.string().trim().min(1), category: ledgerCategory, date: dateStr.optional(),
    showId: z.string().min(1).optional(), receipt: driveRef.optional(), userId: z.string().min(1).optional(),
  }),
  run: (ctx, i) => run(ctx, async (w) => {
    if (i.userId && i.userId !== ctx.uid && ctx.role === "member") throw new AppError("forbidden", "You can only add your own expenses", 403);
    const userId = i.userId ?? ctx.uid;
    const u = await w.get("users", userId);
    if (!u || u.deletedAt) throw new AppError("not_found", "User not found", 404);
    if (i.showId && !(await w.get("shows", i.showId))) throw new AppError("not_found", "Show not found", 404);
    const { userId: _u, ...rest } = i;
    return w.create("expenses", { ...rest, userId, date: i.date ?? todayServer() });
  }),
});

export const expensesReimburse = defineCommand({
  name: "expenses.reimburse", roles: ["admin", "mcp"],
  description: "Mark an expense paid back: writes a reimbursement ledger entry with expenseId. Once per expense unless that entry is corrected.",
  input: z.strictObject({ id: z.string().min(1), method: method.default("venmo") }),
  run: (ctx, i) => run(ctx, async (w) => {
    const x = await w.get("expenses", i.id);
    if (!x || x.deletedAt) throw new AppError("not_found", "Expense not found", 404);
    const u = await w.get("users", x.userId);
    return addLedgerEntry(w, {
      date: todayServer(), kind: "reimbursement", amount: x.amount, category: x.category, method: i.method, expenseId: x.id,
      payeeUserId: x.userId, ...(u?.musicianId ? { payeeMusicianId: u.musicianId } : {}), ...(x.showId ? { showId: x.showId } : {}),
      memo: x.what, ...(x.receipt ? { receipt: x.receipt } : {}),
    });
  }),
});

export const receiptsSearch = defineCommand({
  name: "receipts.search", roles: ["admin", "member"],
  description: "Search Drive for a receipt file by name; returns driveFileId, name and url.",
  input: z.strictObject({ q: z.string().min(1) }),
  async run(_ctx, { q }) {
    const hits = await driveClient().search({ q });
    return { files: hits.slice(0, 20).map((f) => ({ driveFileId: f.id, name: f.name, mimeType: f.mimeType, url: f.webViewLink })) };
  },
});

export const moneyCommands = [ledgerRecord, ledgerCorrect, showsSettle, payoutsPay, expensesAdd, expensesReimburse, receiptsSearch];
