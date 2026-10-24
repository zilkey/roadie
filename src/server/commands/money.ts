import { z } from "zod";
import { dateInBandZone } from "@/lib/timezone";
import { run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import { defineCommand } from "./types";
import { driveClient } from "../integrations";
import { ledgerCategory, driveRef } from "@/schema";
import { refreshDealTotals } from "../dealTotals";

const todayServer = () => dateInBandZone();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// There is no ledger: a show's income is the lines on its deal (showDeals.setIncome), money spent is expenses.
// An expense can be changed or removed by its owner (or an admin) until an admin marks it paid back.

async function requireExpense(w: Writer, id: string) {
  const x = await w.get("expenses", id);
  if (!x || x.deletedAt) throw new AppError("not_found", "Expense not found", 404);
  return x;
}
/** The caller may change this expense: theirs (or they're an admin) and not paid back yet. */
function assertCanChange(w: Writer, x: Doc) {
  if (w.ctx.role === "member" && x.userId !== w.ctx.uid) throw new AppError("forbidden", "You can only change your own expenses", 403);
  if (x.paidBackAt) throw new AppError("paid_back", "That expense was already paid back", 409);
}
const refresh = (w: Writer, ...showIds: unknown[]) => Promise.all([...new Set(showIds.filter((s): s is string => typeof s === "string"))].map((s) => refreshDealTotals(w, s)));

// ---------- expenses ----------

export const expensesAdd = defineCommand({
  name: "expenses.add", roles: ["admin", "member"],
  description: "Add an expense: amount in cents, what it was for, category, optional showId and receipt (Drive link), payBack (default true: the band owes it back). Members add their own; admins may pass userId.",
  input: z.strictObject({
    amount: z.number().int().positive(), what: z.string().trim().min(1), category: ledgerCategory, date: dateStr.optional(),
    showId: z.string().min(1).optional(), receipt: driveRef.optional(), userId: z.string().min(1).optional(), payBack: z.boolean().optional(),
  }),
  run: (ctx, i) => run(ctx, async (w) => {
    if (i.userId && i.userId !== ctx.uid && ctx.role === "member") throw new AppError("forbidden", "You can only add your own expenses", 403);
    const userId = i.userId ?? ctx.uid;
    const u = await w.get("users", userId);
    if (!u || u.deletedAt) throw new AppError("not_found", "User not found", 404);
    if (i.showId && !(await w.get("shows", i.showId))) throw new AppError("not_found", "Show not found", 404);
    const { userId: _u, ...rest } = i;
    const r = await w.create("expenses", { ...rest, userId, date: i.date ?? todayServer() });
    if (i.showId) await refreshDealTotals(w, i.showId, { expenses: [(await w.get("expenses", r.id))!] });
    return r;
  }),
});

export const expensesUpdate = defineCommand({
  name: "expenses.update", roles: ["admin", "member"],
  description: "Fix an expense until it's paid back: what, amount, payBack, receipt (null clears), showId (null clears). Members only their own.",
  input: z.strictObject({ id: z.string().min(1), patch: z.strictObject({
    what: z.string().trim().min(1).optional(), amount: z.number().int().positive().optional(), payBack: z.boolean().optional(),
    receipt: driveRef.nullable().optional(), showId: z.string().min(1).nullable().optional(), category: ledgerCategory.optional(),
  }) }),
  run: (ctx, { id, patch }) => run(ctx, async (w) => {
    const x = await requireExpense(w, id);
    assertCanChange(w, x);
    if (patch.showId && !(await w.get("shows", patch.showId))) throw new AppError("not_found", "Show not found", 404);
    const r = await w.update("expenses", id, patch as Record<string, unknown>);
    await refresh(w, x.showId, patch.showId);
    return r;
  }),
});

export const expensesRemove = defineCommand({
  name: "expenses.remove", roles: ["admin", "member"], description: "Remove an expense that hasn't been paid back. Members only their own.",
  input: z.strictObject({ id: z.string().min(1) }),
  run: (ctx, { id }) => run(ctx, async (w) => {
    const x = await requireExpense(w, id);
    assertCanChange(w, x);
    const r = await w.softDelete("expenses", id);
    await refresh(w, x.showId);
    return r;
  }),
});

export const expensesSetPaidBack = defineCommand({
  name: "expenses.setPaidBack", roles: ["admin", "mcp"], description: "Mark an expense paid back (paid:true, today, by you) or not paid back after all (paid:false).",
  input: z.strictObject({ id: z.string().min(1), paid: z.boolean() }),
  run: (ctx, i) => run(ctx, async (w) => {
    await requireExpense(w, i.id);
    return w.update("expenses", i.id, i.paid ? { paidBackAt: todayServer(), paidBackBy: ctx.uid } : { paidBackAt: null, paidBackBy: null });
  }),
});

const ExpenseLine = z.strictObject({
  id: z.string().min(1).optional(), what: z.string().trim().min(1), amount: z.number().int().positive(), userId: z.string().min(1).optional(),
  payBack: z.boolean().default(true), receipt: driveRef.nullable().optional(),
});
export const showsSetExpenses = defineCommand({
  name: "shows.setExpenses", roles: ["admin", "member"],
  description: "Save a show's expense lines as the caller sees them (members: their own; admins: all): lines without an id are added, changed ones updated, " +
    "and the caller's expenses on the show that are missing are removed. Paid-back expenses can't change (send them as they are). userId is for admins only.",
  input: z.strictObject({ id: z.string().min(1), lines: z.array(ExpenseLine) }),
  run: (ctx, i) => run(ctx, async (w) => {
    const show = await w.get("shows", i.id);
    if (!show || show.deletedAt) throw new AppError("not_found", "Show not found", 404);
    const mine = (await w.query("expenses", (q) => q.where("showId", "==", i.id)))
      .filter((x) => !x.deletedAt && (ctx.role !== "member" || x.userId === ctx.uid));
    const byId = new Map(mine.map((x) => [x.id, x]));
    const out = { added: [] as string[], updated: [] as string[], removed: [] as string[] };
    for (const l of i.lines) {
      if (l.userId && l.userId !== ctx.uid && ctx.role === "member") throw new AppError("forbidden", "You can only add your own expenses", 403);
      if (!l.id) {
        const userId = l.userId ?? ctx.uid;
        const u = await w.get("users", userId);
        if (!u || u.deletedAt) throw new AppError("not_found", "User not found", 404);
        const { id: _i, receipt, ...rest } = l;
        out.added.push((await w.create("expenses", { ...rest, userId, ...(receipt ? { receipt } : {}), category: "other", date: todayServer(), showId: i.id })).id);
        continue;
      }
      const x = byId.get(l.id);
      if (!x) throw new AppError("not_found", "Expense not found on this show", 404);
      const patch: Record<string, unknown> = {};
      for (const k of ["what", "amount", "payBack", "userId"] as const) if (l[k] !== undefined && l[k] !== (k === "payBack" ? x.payBack ?? true : x[k])) patch[k] = l[k];
      if (l.receipt !== undefined && JSON.stringify(l.receipt) !== JSON.stringify(x.receipt ?? null)) patch.receipt = l.receipt;
      if (!Object.keys(patch).length) continue;
      assertCanChange(w, x);
      await w.update("expenses", x.id, patch);
      out.updated.push(x.id);
    }
    const kept = new Set(i.lines.map((l) => l.id).filter(Boolean));
    for (const x of mine) {
      if (kept.has(x.id)) continue;
      assertCanChange(w, x);
      await w.softDelete("expenses", x.id);
      out.removed.push(x.id);
    }
    await refreshDealTotals(w, i.id);
    return { id: i.id, ...out };
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

export const moneyCommands = [expensesAdd, expensesUpdate, expensesRemove, expensesSetPaidBack, showsSetExpenses, receiptsSearch];
