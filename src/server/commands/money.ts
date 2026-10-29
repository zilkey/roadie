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
import { expenseCategory, incomeCategory, paymentMethod, payoutKind, driveRef, expenseGasBase, geoPoint, fuelGrade, type FuelAreaKind } from "@/schema";
import { refreshDealTotals } from "../dealTotals";
import { owesBack } from "@/lib/money";
import { artistFor, defaultProjectIdFor, requireOpenProject } from "./projects";
import { requireTrackOnProject } from "./albums";
import type { Ctx } from "../ctx";

const todayServer = () => dateInBandZone();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id1 = z.string().min(1);

// Money is three collections on top of projects (src/schema/projects.ts, income.ts, payouts.ts; the story is #39):
// income (admin-only, owed to us until receivedAt), expenses (members their own, admins anyone's; pay-back ones are
// owed until paidBackAt) and payouts (admin-only, we owe until paidAt). Every record has exactly one projectId.
// An expense can be changed or removed by its owner (or an admin) until it is paid back.
//
// ---------- the command surface (the contract W1 implements; names and input shapes don't move) ----------
// projects.create  admin  { kind: projectKind, name, start?, end?, isDefault? }      -> { id }. isDefault moves the flag: exactly one default per artist.
// projects.update  admin  { id, patch: { name?, kind?, start? (null clears), end? (null clears), isDefault? (true only) } }
// projects.close   admin  { id }   closed projects stay readable; nothing new lands on them (add/update commands refuse a closed projectId).
// projects.reopen  admin  { id }
//                         A project is never removed: one with money on it is closed. (No projects.remove.)
// income.add       admin  { amount, category: incomeCategory, from, date?, projectId?, showId?, method?, receivedAt?, notes? }
//                         projectId defaults to the show's project, else the default project. No receivedAt = owed to us.
// income.update    admin  { id, patch: { amount?, category?, from?, date?, projectId?, showId? (null clears), method? (null clears), receivedAt? (null clears), notes? (null clears) } }
// income.remove    admin  { id }
// income.setReceived admin { id, receivedAt?: date (default today), method? }   received:false is income.update { receivedAt: null }.
// payouts.add      admin  { to: { musicianId } | { userId } | { contactId } | { name }, kind: payoutKind, amount, what?, projectId?, showId?, dueDate?, paidAt?, method?, expenseIds? }
//                         `to` must resolve (musician, user or contact found, or a plain name); the server copies the name onto to.name. No paidAt = we owe.
// payouts.update   admin  { id, patch: { to?, kind?, amount?, what? (null clears), projectId?, showId? (null clears), dueDate? (null clears), paidAt? (null clears), method? (null clears) } }
// payouts.remove   admin  { id }
// payouts.markPaid admin  { id, paidAt?: date (default today), method }
// expenses.add     admin|member  as today plus projectId? (default: the show's project, else the rehearsal's, else the default project);
//                         category is expenseCategory; admins may pass userId to log one in a bandmate's name ("we owe Eric $42 for gas" = payBack true).
// expenses.update  admin|member  as today plus projectId?, category: expenseCategory.
// expenses.payPerson admin { userId, ids?, method?: paymentMethod, paidAt?: date }
//                         marks the expenses paid back (as today) AND writes one payouts doc { kind: "reimbursement", to: { userId }, expenseIds, paidAt, method,
//                         projectId: the first expense's project } and sets reimbursedBy on each expense. Returns { paid, total, payoutId }.
// showDeals.setIncome (shows.ts) is removed: Roadie and the UI use income.add / income.setReceived instead.
// Every write refreshes showDeals.totals for the show(s) involved (src/server/dealTotals.ts).

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

/**
 * The project a new record lands on: the one asked for (must be open), else the show's (must be open), else the default for
 * the show's artist and billedAs. `strict` (income, payouts: projectId is required) throws when there is nowhere to put it;
 * otherwise (expenses: optional until the migration) it returns undefined and the record goes unstamped.
 */
async function projectFor(w: Writer, o: { projectId?: string; show?: Doc | null; strict?: boolean }): Promise<string | undefined> {
  if (o.projectId) return (await requireOpenProject(w, o.projectId)).id;
  if (o.show?.projectId) return (await requireOpenProject(w, o.show.projectId as string)).id;
  let id: string | undefined;
  try { id = await defaultProjectIdFor(w, (await artistFor(w, o.show?.artistId as string | undefined)).id, o.show?.billedAs as string | undefined); }
  catch (e) { if (o.strict) throw e; }
  if (!id && o.strict) throw new AppError("invalid_state", "There is no default project yet: create one with projects.create (isDefault) or pass projectId", 409);
  return id;
}
async function liveShow(w: Writer, id: string) {
  const s = await w.get("shows", id);
  if (!s || s.deletedAt) throw new AppError("not_found", "Show not found", 404);
  return s;
}

/**
 * Refresh the show(s) a just-edited record is on or came from. Writer.query can't see a doc that only now moved onto a show
 * (the snapshot filters on the stored showId), so the edited doc is passed as `extra` to the show it is on now.
 */
async function refreshMoved(w: Writer, kind: "expenses" | "income" | "payouts", id: string, oldShowId: unknown) {
  const after = (await w.get(kind, id))!;
  const ids = [...new Set([oldShowId, after.showId].filter((s): s is string => typeof s === "string"))];
  await Promise.all(ids.map((s) => refreshDealTotals(w, s, { [kind]: after.showId === s ? [after] : [] })));
}

// ---------- expenses ----------

/** What the form sends after an estimate: the frozen gas numbers; the server sets `overridden` from the amount. */
const GasIn = expenseGasBase.omit({ overridden: true });

export const expensesAdd = defineCommand({
  name: "expenses.add", roles: ["admin", "member"],
  description: "Add an expense: amount in cents, what it was for, category, optional showId or rehearsalId and receipt (Drive link), payBack (default true: the band owes it back). " +
    "userId is who paid (a user id from context.now band[].userId), defaulting to the speaker. Members add their own; admins may pass userId (\"For\") to log one for a bandmate — gas then uses that person's saved home and MPG (see expenses.estimateGas). " +
    "category: gear|travel|lodging|food|recording|mixing|mastering|pressing|artwork|photo|video|space|marketing|fees|other. projectId (from context.now projects) defaults to the show's project, else the default project. " +
    "A gas expense (category travel) carries the frozen estimate in `gas`. saveMpg / saveAsHome write the CALLER's own settings only; setAsRehearsalLocation (admins) also sets the rehearsal's location from the typed To. " +
    "Money for a record goes on the album's project (records.get albums: projectId); albumTrackId (one of its tracks) pins it to one track (\"mix v4 revisions\").",
  input: z.strictObject({
    amount: z.number().int().positive(), what: z.string().trim().min(1), category: expenseCategory, date: dateStr.optional(),
    showId: z.string().min(1).optional(), projectId: id1.optional(), rehearsalId: z.string().min(1).optional(), albumTrackId: id1.optional(), gas: GasIn.optional(),
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
    const show = i.showId ? await liveShow(w, i.showId) : null;
    if (i.rehearsalId && !(await w.get("rehearsals", i.rehearsalId))) throw new AppError("not_found", "Rehearsal not found", 404);
    const projectId = await projectFor(w, { projectId: i.projectId, show });
    if (i.albumTrackId) await requireTrackOnProject(w, projectId, i.albumTrackId);
    const { userId: _u, projectId: _p, gas, saveMpg, saveAsHome, setAsRehearsalLocation, ...rest } = i;
    const r = await w.create("expenses", {
      ...rest, userId, date: i.date ?? todayServer(), ...(projectId ? { projectId } : {}),
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
  description: "Fix an expense until it's paid back: what, amount, payBack, category (gear|travel|lodging|food|recording|mixing|mastering|pressing|artwork|photo|video|space|marketing|fees|other), receipt (null clears), showId (null clears), projectId (an open project). Members only their own.",
  input: z.strictObject({ id: z.string().min(1), patch: z.strictObject({
    what: z.string().trim().min(1).optional(), amount: z.number().int().positive().optional(), payBack: z.boolean().optional(),
    receipt: driveRef.nullable().optional(), showId: z.string().min(1).nullable().optional(), category: expenseCategory.optional(), projectId: id1.optional(),
    albumTrackId: id1.nullable().optional(),
  }) }),
  run: (ctx, { id, patch }) => run(ctx, async (w) => {
    const x = await requireExpense(w, id);
    assertCanChange(w, x);
    if (patch.showId) await liveShow(w, patch.showId);
    if (patch.projectId) await requireOpenProject(w, patch.projectId);
    if (patch.albumTrackId) await requireTrackOnProject(w, patch.projectId ?? (x.projectId as string | undefined), patch.albumTrackId);
    // A new amount on a gas expense keeps the estimate but marks it overridden, so the frozen numbers stay honest.
    const gas = patch.amount !== undefined && patch.amount !== x.amount && x.gas && !x.gas.overridden ? { gas: { ...x.gas, overridden: true } } : {};
    const r = await w.update("expenses", id, { ...patch, ...gas } as Record<string, unknown>);
    await refreshMoved(w, "expenses", id, x.showId);
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

export const expensesPayPerson = defineCommand({
  name: "expenses.payPerson", roles: ["admin", "mcp"],
  description: "Pay someone back for everything the band owes them in one go: marks their unpaid pay-back expenses paid back and records ONE reimbursement payout to them for the total. " +
    "userId is whose (context.now band[].userId); ids (from context.now openExpenses) limits it to those, else all of theirs; paidAt (YYYY-MM-DD, default today); method: cash|venmo|check|square|card|bank|other (ask how if unsure). " +
    "Use this, not expenses.setPaidBack one at a time, to settle up with a person. Returns { paid: expense ids, total, payoutId }.",
  input: z.strictObject({ userId: id1, ids: z.array(id1).min(1).optional(), method: paymentMethod.optional(), paidAt: dateStr.optional() }),
  run: (ctx, i) => run(ctx, async (w) => {
    const theirs = (await w.query("expenses", (q) => q.where("userId", "==", i.userId))).filter((x) => owesBack(x as never));
    const byId = new Map(theirs.map((x) => [x.id, x]));
    if (i.ids?.some((id) => !byId.has(id))) throw new AppError("not_found", "Not one of their unpaid expenses", 404);
    const pay = i.ids ? i.ids.map((id) => byId.get(id)!) : theirs;
    if (!pay.length) throw new AppError("not_found", "Nothing owed to them", 404);
    const u = await w.get("users", i.userId);
    if (!u || u.deletedAt) throw new AppError("not_found", "User not found", 404);
    const paidAt = i.paidAt ?? todayServer(), total = pay.reduce((n, x) => n + (x.amount as number), 0);
    const first = pay[0];
    const projectId = (first.projectId as string | undefined) ?? await projectFor(w, { strict: true });
    const showIds = new Set(pay.map((x) => x.showId as string | undefined));
    const showId = showIds.size === 1 ? [...showIds][0] : undefined;
    const payout = await w.create("payouts", {
      artistId: (await artistFor(w)).id, kind: "reimbursement", to: { userId: i.userId, name: u.name as string }, expenseIds: pay.map((x) => x.id),
      amount: total, paidAt, projectId, ...(i.method ? { method: i.method } : {}), ...(showId ? { showId } : {}),
    });
    for (const x of pay) await w.update("expenses", x.id, { paidBackAt: paidAt, paidBackBy: ctx.uid, reimbursedBy: payout.id });
    if (showId) await refreshDealTotals(w, showId, { payouts: [(await w.get("payouts", payout.id))!] });
    return { paid: pay.map((x) => x.id), total, payoutId: payout.id };
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
        const projectId = await projectFor(w, { show: target.kind === "shows" ? rec : null });
        const { id: _i, receipt, ...rest } = l;
        out.added.push((await w.create("expenses", { ...rest, userId, ...(receipt ? { receipt } : {}), category: "other", date: todayServer(), ...(projectId ? { projectId } : {}), [key]: target.id })).id);
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
  async run(ctx, { q }) {
    const hits = await driveClient({ artistId: ctx.artistId }).search({ q });
    return { files: hits.slice(0, 20).map((f) => ({ driveFileId: f.id, name: f.name, mimeType: f.mimeType, url: f.webViewLink })) };
  },
});

// ---------- income (admin-only; owed to us until receivedAt) ----------

async function requireIncome(w: Writer, id: string) {
  const x = await w.get("income", id);
  if (!x || x.deletedAt) throw new AppError("not_found", "Income not found", 404);
  return x;
}

export const incomeAdd = defineCommand({
  name: "income.add", roles: ["admin", "mcp"],
  description: "Record money coming to the band: amount in cents, category (guarantee|door|tips|merch|streaming|digitalSales|physical|preorders|crowdfunding|sync|grant|gearSale|other), from (who: the venue, \"Bandcamp\", a grant). " +
    "showId (from shows.list) is optional context, not the owner; date (YYYY-MM-DD) defaults to the show's date, else today. projectId (context.now projects) defaults to the show's project, else the default project. " +
    "method: cash|venmo|check|square|card|bank|other. receivedAt (YYYY-MM-DD) is when it arrived: leave it OUT while the money is still owed to us (the venue hasn't paid yet); income.setReceived fills it in later. " +
    "Album money (sales, pre-orders, crowdfunding, streaming) goes on the album's project (records.get albums: projectId); albumTrackId pins it to one track. Returns { id }.",
  input: z.strictObject({
    amount: z.number().int().positive(), category: incomeCategory, from: z.string().trim().min(1), date: dateStr.optional(), projectId: id1.optional(), showId: id1.optional(),
    albumTrackId: id1.optional(), method: paymentMethod.optional(), receivedAt: dateStr.optional(), notes: z.string().trim().min(1).optional(),
  }),
  run: (ctx, i) => run(ctx, async (w) => {
    const show = i.showId ? await liveShow(w, i.showId) : null;
    const projectId = (await projectFor(w, { projectId: i.projectId, show, strict: true }))!;
    if (i.albumTrackId) await requireTrackOnProject(w, projectId, i.albumTrackId);
    const artistId = (await artistFor(w, show?.artistId as string | undefined)).id;
    const r = await w.create("income", { ...i, artistId, projectId, date: i.date ?? (show?.date as string | undefined) ?? todayServer() });
    if (i.showId) await refreshDealTotals(w, i.showId, { income: [(await w.get("income", r.id))!] });
    return r;
  }),
});

export const incomeUpdate = defineCommand({
  name: "income.update", roles: ["admin", "mcp"],
  description: "Fix an income record (id from records.list income or context.now): amount, category, from, date, projectId (an open project), showId (null clears), method / receivedAt / notes (null clears). receivedAt:null = not received after all.",
  input: z.strictObject({ id: id1, patch: z.strictObject({
    amount: z.number().int().positive().optional(), category: incomeCategory.optional(), from: z.string().trim().min(1).optional(), date: dateStr.optional(),
    projectId: id1.optional(), showId: id1.nullable().optional(), albumTrackId: id1.nullable().optional(), method: paymentMethod.nullable().optional(), receivedAt: dateStr.nullable().optional(), notes: z.string().trim().min(1).nullable().optional(),
  }) }),
  run: (ctx, { id, patch }) => run(ctx, async (w) => {
    const x = await requireIncome(w, id);
    if (patch.showId) await liveShow(w, patch.showId);
    if (patch.projectId) await requireOpenProject(w, patch.projectId);
    if (patch.albumTrackId) await requireTrackOnProject(w, patch.projectId ?? (x.projectId as string), patch.albumTrackId);
    const r = await w.update("income", id, patch as Record<string, unknown>);
    await refreshMoved(w, "income", id, x.showId);
    return r;
  }),
});

export const incomeRemove = defineCommand({
  name: "income.remove", roles: ["admin", "mcp"], description: "Remove an income record entered by mistake (id from records.list income).",
  input: z.strictObject({ id: id1 }),
  run: (ctx, { id }) => run(ctx, async (w) => {
    const x = await requireIncome(w, id);
    const r = await w.softDelete("income", id);
    await refresh(w, x.showId);
    return r;
  }),
});

export const incomeSetReceived = defineCommand({
  name: "income.setReceived", roles: ["admin", "mcp"],
  description: "The money arrived: marks an income record received on receivedAt (YYYY-MM-DD, default today), optionally with how it was paid (method). To un-receive it use income.update with receivedAt:null.",
  input: z.strictObject({ id: id1, receivedAt: dateStr.optional(), method: paymentMethod.optional() }),
  run: (ctx, i) => run(ctx, async (w) => {
    const x = await requireIncome(w, i.id);
    const r = await w.update("income", i.id, { receivedAt: i.receivedAt ?? todayServer(), ...(i.method ? { method: i.method } : {}) });
    await refresh(w, x.showId);
    return r;
  }),
});

// ---------- payouts (admin-only; we owe until paidAt) ----------

const PayoutTo = z.union([
  z.strictObject({ musicianId: id1 }), z.strictObject({ userId: id1 }), z.strictObject({ contactId: id1 }), z.strictObject({ name: z.string().trim().min(1) }),
]);
/** Who a payout goes to, resolved: the doc must exist, and its name is copied onto `to.name` so lists render without a lookup. */
async function resolveTo(w: Writer, to: z.infer<typeof PayoutTo>) {
  const named = async (coll: string, key: string, id: string, label: string) => {
    const d = await w.get(coll, id);
    if (!d || d.deletedAt) throw new AppError("not_found", `${label} not found`, 404);
    return { [key]: id, name: d.name as string };
  };
  if ("musicianId" in to) return named("musicians", "musicianId", to.musicianId, "Musician");
  if ("userId" in to) return named("users", "userId", to.userId, "User");
  if ("contactId" in to) return named("contacts", "contactId", to.contactId, "Contact");
  return { name: to.name };
}
async function requirePayout(w: Writer, id: string) {
  const x = await w.get("payouts", id);
  if (!x || x.deletedAt) throw new AppError("not_found", "Payout not found", 404);
  return x;
}

export const payoutsAdd = defineCommand({
  name: "payouts.add", roles: ["admin", "mcp"],
  description: "Record money the band pays (or owes) someone: to is exactly one of { musicianId } (a band player, from context.now band), { userId }, { contactId } or { name } for anyone else; the server copies their name. " +
    "kind: pay (their pay for playing), split (another band's cut), reimbursement (paying back expenses; expenseIds marks those expenses reimbursed), other. amount in cents, what (\"the Lost Lake show\"), showId, " +
    "projectId (defaults to the show's project, else the default project), dueDate. paidAt (YYYY-MM-DD) is when it was paid: leave it OUT while we still owe it; payouts.markPaid fills it in later. method: cash|venmo|check|square|card|bank|other. Returns { id }.",
  input: z.strictObject({
    to: PayoutTo, kind: payoutKind, amount: z.number().int().positive(), what: z.string().trim().min(1).optional(), projectId: id1.optional(), showId: id1.optional(),
    dueDate: dateStr.optional(), paidAt: dateStr.optional(), method: paymentMethod.optional(), expenseIds: z.array(id1).min(1).optional(),
  }),
  run: (ctx, i) => run(ctx, async (w) => {
    const show = i.showId ? await liveShow(w, i.showId) : null;
    const projectId = (await projectFor(w, { projectId: i.projectId, show, strict: true }))!;
    const artistId = (await artistFor(w, show?.artistId as string | undefined)).id;
    const to = await resolveTo(w, i.to);
    const exps: Doc[] = [];
    for (const id of i.expenseIds ?? []) exps.push(await requireExpense(w, id));
    const r = await w.create("payouts", { ...i, to, artistId, projectId });
    // A paid reimbursement settles its expenses the way payPerson does; an owed one only links them until it is marked paid.
    for (const x of exps) await w.update("expenses", x.id, { reimbursedBy: r.id, ...(i.paidAt ? { paidBackAt: i.paidAt, paidBackBy: ctx.uid } : {}) });
    if (i.showId) await refreshDealTotals(w, i.showId, { payouts: [(await w.get("payouts", r.id))!] });
    return r;
  }),
});

export const payoutsUpdate = defineCommand({
  name: "payouts.update", roles: ["admin", "mcp"],
  description: "Fix a payout (id from records.list payouts or context.now): to (same shapes as payouts.add), kind, amount, projectId (an open project), what / showId / dueDate / paidAt / method (null clears). paidAt:null = not paid after all.",
  input: z.strictObject({ id: id1, patch: z.strictObject({
    to: PayoutTo.optional(), kind: payoutKind.optional(), amount: z.number().int().positive().optional(), what: z.string().trim().min(1).nullable().optional(), projectId: id1.optional(),
    showId: id1.nullable().optional(), dueDate: dateStr.nullable().optional(), paidAt: dateStr.nullable().optional(), method: paymentMethod.nullable().optional(),
  }) }),
  run: (ctx, { id, patch }) => run(ctx, async (w) => {
    const x = await requirePayout(w, id);
    if (patch.showId) await liveShow(w, patch.showId);
    if (patch.projectId) await requireOpenProject(w, patch.projectId);
    const { to, ...rest } = patch;
    const r = await w.update("payouts", id, { ...rest, ...(to ? { to: await resolveTo(w, to) } : {}) } as Record<string, unknown>);
    await refreshMoved(w, "payouts", id, x.showId);
    return r;
  }),
});

export const payoutsRemove = defineCommand({
  name: "payouts.remove", roles: ["admin", "mcp"],
  description: "Remove a payout entered by mistake (id from records.list payouts). Expenses it paid back go back to owed.",
  input: z.strictObject({ id: id1 }),
  run: (ctx, { id }) => run(ctx, async (w) => {
    const x = await requirePayout(w, id);
    for (const eid of (x.expenseIds as string[] | undefined) ?? []) {
      const e = await w.get("expenses", eid);
      if (e && !e.deletedAt && e.reimbursedBy === id) await w.update("expenses", eid, { reimbursedBy: null, paidBackAt: null, paidBackBy: null });
    }
    const r = await w.softDelete("payouts", id);
    await refresh(w, x.showId);
    return r;
  }),
});

export const payoutsMarkPaid = defineCommand({
  name: "payouts.markPaid", roles: ["admin", "mcp"],
  description: "We paid it: marks a payout paid on paidAt (YYYY-MM-DD, default today) and how (method: cash|venmo|check|square|card|bank|other; ask if unsure). To un-pay it use payouts.update with paidAt:null.",
  input: z.strictObject({ id: id1, paidAt: dateStr.optional(), method: paymentMethod }),
  run: (ctx, i) => run(ctx, async (w) => {
    const x = await requirePayout(w, i.id);
    const r = await w.update("payouts", i.id, { paidAt: i.paidAt ?? todayServer(), method: i.method });
    await refresh(w, x.showId);
    return r;
  }),
});

export const moneyCommands = [incomeAdd, incomeUpdate, incomeRemove, incomeSetReceived, payoutsAdd, payoutsUpdate, payoutsRemove, payoutsMarkPaid, expensesAdd, expensesUpdate, expensesRemove, expensesSetPaidBack, expensesPayPerson, expensesEstimateGas, showsSetExpenses, rehearsalsSetExpenses, receiptsSearch];
