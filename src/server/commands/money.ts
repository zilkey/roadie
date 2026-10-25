import { z } from "zod";
import { dateInBandZone } from "@/lib/timezone";
import { db, run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import { defineCommand } from "./types";
import { driveClient, orsClient } from "../integrations";
import { getDriving, updateDriving } from "../driving";
import { gasCents, tripMiles } from "../gas/math";
import { routeMiles } from "../gas/route";
import { areaFor, priceFor } from "../gas/price";
import { ledgerCategory, driveRef, expenseGasBase, geoPoint, fuelGrade, type FuelAreaKind } from "@/schema";
import { refreshDealTotals } from "../dealTotals";
import type { Ctx } from "../ctx";

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

/** What the form sends after an estimate: the frozen gas numbers; the server sets `overridden` from the amount. */
const GasIn = expenseGasBase.omit({ overridden: true });

export const expensesAdd = defineCommand({
  name: "expenses.add", roles: ["admin", "member"],
  description: "Add an expense: amount in cents, what it was for, category, optional showId or rehearsalId and receipt (Drive link), payBack (default true: the band owes it back). " +
    "Members add their own; admins may pass userId (\"For\") to log one for a bandmate — gas then uses that person's saved home and MPG (see expenses.estimateGas). " +
    "A gas expense (category travel) carries the frozen estimate in `gas`. saveMpg / saveAsHome write the CALLER's own settings only; setAsRehearsalLocation (admins) also sets the rehearsal's location from the typed To.",
  input: z.strictObject({
    amount: z.number().int().positive(), what: z.string().trim().min(1), category: ledgerCategory, date: dateStr.optional(),
    showId: z.string().min(1).optional(), rehearsalId: z.string().min(1).optional(), gas: GasIn.optional(),
    receipt: driveRef.optional(), userId: z.string().min(1).optional(), payBack: z.boolean().optional(),
    /** Save gas.mpg to the caller's own driving settings. */
    saveMpg: z.boolean().optional(),
    /** Save this typed From (with coordinates) as the caller's own home address. */
    saveAsHome: geoPoint.optional(),
    /** Admins only: set this typed To as the rehearsal's location (needs rehearsalId). */
    setAsRehearsalLocation: geoPoint.optional(),
  }),
  run: async (ctx, i) => {
   const r = await run(ctx, async (w) => {
    if (i.userId && i.userId !== ctx.uid && ctx.role === "member") throw new AppError("forbidden", "You can only add your own expenses", 403);
    if (i.setAsRehearsalLocation && ctx.role === "member") throw new AppError("forbidden", "Only admins can set the rehearsal's location", 403);
    const userId = i.userId ?? ctx.uid;
    const u = await w.get("users", userId);
    if (!u || u.deletedAt) throw new AppError("not_found", "User not found", 404);
    if (i.showId && !(await w.get("shows", i.showId))) throw new AppError("not_found", "Show not found", 404);
    if (i.rehearsalId && !(await w.get("rehearsals", i.rehearsalId))) throw new AppError("not_found", "Rehearsal not found", 404);
    const { userId: _u, gas, saveMpg, saveAsHome, setAsRehearsalLocation, ...rest } = i;
    const r = await w.create("expenses", {
      ...rest, userId, date: i.date ?? todayServer(),
      ...(gas ? { gas: { ...gas, overridden: i.amount !== gas.estimateCents } } : {}),
    });
    if (i.showId) await refreshDealTotals(w, i.showId, { expenses: [(await w.get("expenses", r.id))!] });
    return r;
   });
    // Side writes after the transaction (run() can retry; updateDriving is a direct write).
    if (i.saveMpg && i.gas) await updateDriving(ctx.uid, { mpg: i.gas.mpg });
    if (i.saveAsHome) await updateDriving(ctx.uid, { home: i.saveAsHome });
    if (i.setAsRehearsalLocation && i.rehearsalId) await db.update(ctx, "rehearsals", i.rehearsalId, { location: i.setAsRehearsalLocation });
    return r;
  },
});

/**
 * No write: works out a gas estimate for the form (and Roadie). From = the typed `from`, else the target person's
 * saved home. To = the typed `to`, else the rehearsal's location. MPG = the typed `mpg`, else the target's settings.
 * The target is `forId` (admins only), else the caller. Missing info comes back in `missing` (one entry per gap,
 * never a throw); the reply NEVER contains an address — an admin estimating for a bandmate sees miles only.
 */
export const expensesEstimateGas = defineCommand({
  name: "expenses.estimateGas", roles: ["admin", "member", "mcp"],
  description: "Estimate gas money for a trip, no write: miles (via driving directions), the person's MPG, and the local EIA weekly gas price. " +
    "From defaults to the person's saved home address, To to the rehearsal's location (rehearsalId); pass from/to (with coordinates) to override. " +
    "forId (admins only) estimates for a bandmate using their saved home and MPG — the reply shows miles, never their address. " +
    "Returns estimateCents plus the frozen numbers for expenses.add, or `missing` (mpg|home|destination|price) naming what to ask for; it never throws for missing info.",
  input: z.strictObject({
    forId: z.string().min(1).optional(),
    from: z.strictObject({ address: z.string().min(1), lat: z.number(), lng: z.number() }).optional(),
    to: z.strictObject({ name: z.string().optional(), address: z.string().min(1), lat: z.number(), lng: z.number() }).optional(),
    rehearsalId: z.string().min(1).optional(),
    mpg: z.number().positive().optional(),
    roundTrip: z.boolean().default(true),
  }),
  async run(ctx, i): Promise<{
    missing: ("mpg" | "home" | "destination" | "price")[];
    fromKind: "home" | "typed"; roundTrip: boolean;
    oneWayMiles?: number; miles?: number; mpg?: number; grade?: z.infer<typeof fuelGrade>;
    priceMilli?: number; priceArea?: string; priceWeek?: string; seriesId?: string; areaKind?: FuelAreaKind;
    /** "Denver-area average · EIA weekly, Oct 19" */
    source?: string;
    estimateCents?: number;
  }> {
    const target = i.forId ?? ctx.uid;
    if (target !== ctx.uid && ctx.role === "member") throw new AppError("forbidden", "You can only estimate your own gas", 403);
    const reh = i.rehearsalId ? await db.get("rehearsals", i.rehearsalId) : null;
    if (i.rehearsalId && (!reh || reh.deletedAt)) throw new AppError("not_found", "Rehearsal not found", 404);
    const settings = await getDriving(target);
    const fromKind = i.from ? "typed" as const : "home" as const;
    const from = i.from ?? settings?.home ?? undefined;
    const loc = reh?.location as { lat?: number; lng?: number } | undefined;
    const to = i.to ?? (typeof loc?.lat === "number" && typeof loc?.lng === "number" ? { lat: loc.lat, lng: loc.lng } : undefined);
    const mpg = i.mpg ?? settings?.mpg ?? undefined;
    const grade = settings?.fuelGrade ?? "regular";
    const gaps = new Set<"mpg" | "home" | "destination" | "price">();
    if (!mpg) gaps.add("mpg");
    if (!from) gaps.add("home");
    if (!to) gaps.add("destination");

    let oneWayMiles: number | undefined, miles: number | undefined;
    if (from && to) {
      // Rounded to 0.01 mi so the frozen numbers (and the form) read like "18.4 mi × 2 = 36.8 mi".
      try { oneWayMiles = Math.round((await routeMiles(from, to)) * 100) / 100; miles = tripMiles(oneWayMiles, i.roundTrip); } catch { /* degrade to no miles */ }
    }
    let price: Awaited<ReturnType<typeof priceFor>> = null;
    if (from) {
      try {
        const place = await orsClient().reverse(from.lat, from.lng);
        price = await priceFor(areaFor(place?.county, place?.state), grade);
      } catch { /* degrade to the price gap */ }
    }
    if (from && !price) gaps.add("price");
    const missing = (["mpg", "home", "destination", "price"] as const).filter((g) => gaps.has(g));
    return {
      missing, fromKind, roundTrip: i.roundTrip,
      ...(oneWayMiles !== undefined ? { oneWayMiles, miles } : {}),
      ...(mpg ? { mpg } : {}), grade,
      ...(price ? { priceMilli: price.priceMilli, priceArea: price.area, priceWeek: price.week, seriesId: price.seriesId, areaKind: price.areaKind, source: price.source } : {}),
      ...(!missing.length && miles !== undefined && mpg && price ? { estimateCents: gasCents(miles, mpg, price.priceMilli) } : {}),
    };
  },
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
    // A new amount on a gas expense keeps the estimate but marks it overridden, so the frozen numbers stay honest.
    const gas = patch.amount !== undefined && patch.amount !== x.amount && x.gas && !x.gas.overridden ? { gas: { ...x.gas, overridden: true } } : {};
    const r = await w.update("expenses", id, { ...patch, ...gas } as Record<string, unknown>);
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
type ExpenseTarget = { kind: "shows" | "rehearsals"; id: string };
const targetKey = (t: ExpenseTarget) => (t.kind === "shows" ? "showId" : "rehearsalId");

/** Shared by shows.setExpenses and rehearsals.setExpenses: same roles, same member-vs-admin split, same validation. */
function setExpensesFor(ctx: Ctx, target: ExpenseTarget, lines: z.infer<typeof ExpenseLine>[]) {
  const label = target.kind === "shows" ? "show" : "rehearsal";
  const key = targetKey(target);
  return run(ctx, async (w) => {
    const rec = await w.get(target.kind, target.id);
    if (!rec || rec.deletedAt) throw new AppError("not_found", `${label[0].toUpperCase()}${label.slice(1)} not found`, 404);
    const mine = (await w.query("expenses", (q) => q.where(key, "==", target.id)))
      .filter((x) => !x.deletedAt && (ctx.role !== "member" || x.userId === ctx.uid));
    const byId = new Map(mine.map((x) => [x.id, x]));
    const out = { added: [] as string[], updated: [] as string[], removed: [] as string[] };
    for (const l of lines) {
      if (l.userId && l.userId !== ctx.uid && ctx.role === "member") throw new AppError("forbidden", "You can only add your own expenses", 403);
      if (!l.id) {
        const userId = l.userId ?? ctx.uid;
        const u = await w.get("users", userId);
        if (!u || u.deletedAt) throw new AppError("not_found", "User not found", 404);
        const { id: _i, receipt, ...rest } = l;
        out.added.push((await w.create("expenses", { ...rest, userId, ...(receipt ? { receipt } : {}), category: "other", date: todayServer(), [key]: target.id })).id);
        continue;
      }
      const x = byId.get(l.id);
      if (!x) throw new AppError("not_found", `Expense not found on this ${label}`, 404);
      const patch: Record<string, unknown> = {};
      for (const k of ["what", "amount", "payBack", "userId"] as const) if (l[k] !== undefined && l[k] !== (k === "payBack" ? x.payBack ?? true : x[k])) patch[k] = l[k];
      if (l.receipt !== undefined && JSON.stringify(l.receipt) !== JSON.stringify(x.receipt ?? null)) patch.receipt = l.receipt;
      if (!Object.keys(patch).length) continue;
      assertCanChange(w, x);
      await w.update("expenses", x.id, patch);
      out.updated.push(x.id);
    }
    const kept = new Set(lines.map((l) => l.id).filter(Boolean));
    for (const x of mine) {
      if (kept.has(x.id)) continue;
      assertCanChange(w, x);
      await w.softDelete("expenses", x.id);
      out.removed.push(x.id);
    }
    if (target.kind === "shows") await refreshDealTotals(w, target.id);
    return { id: target.id, ...out };
  });
}

export const showsSetExpenses = defineCommand({
  name: "shows.setExpenses", roles: ["admin", "member"],
  description: "Save a show's expense lines as the caller sees them (members: their own; admins: all): lines without an id are added, changed ones updated, " +
    "and the caller's expenses on the show that are missing are removed. Paid-back expenses can't change (send them as they are). userId is for admins only.",
  input: z.strictObject({ id: z.string().min(1), lines: z.array(ExpenseLine) }),
  run: (ctx, i) => setExpensesFor(ctx, { kind: "shows", id: i.id }, i.lines),
});

export const rehearsalsSetExpenses = defineCommand({
  name: "rehearsals.setExpenses", roles: ["admin", "member"],
  description: "Save a rehearsal's expense lines as the caller sees them (members: their own; admins: all): lines without an id are added, changed ones updated, " +
    "and the caller's expenses on the rehearsal that are missing are removed. Paid-back expenses can't change (send them as they are). userId is for admins only.",
  input: z.strictObject({ id: z.string().min(1), lines: z.array(ExpenseLine) }),
  run: (ctx, i) => setExpensesFor(ctx, { kind: "rehearsals", id: i.id }, i.lines),
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

export const moneyCommands = [expensesAdd, expensesUpdate, expensesRemove, expensesSetPaidBack, expensesEstimateGas, showsSetExpenses, rehearsalsSetExpenses, receiptsSearch];
