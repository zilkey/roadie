import { z } from "zod";
import { entity, serverMask, id, dateStr, cents, ledgerCategory, driveRef } from "./common";
import { fuelGrade } from "./driving";

/**
 * The frozen gas estimate on an expense: miles, MPG, price, source and week are saved so a later price update or
 * settings change never moves an amount already logged. When From is the person's home (fromKind "home") the expense
 * stores the miles and NEVER the address; a typed From is stored as typed (the person chose to show it).
 */
export const expenseGasBase = z.strictObject({
  fromKind: z.enum(["home", "typed"]),
  /** Only when fromKind is "typed". */
  fromText: z.string().optional(),
  to: z.strictObject({ name: z.string().optional(), address: z.string().optional(), lat: z.number().optional(), lng: z.number().optional() }),
  oneWayMiles: z.number().positive(),
  roundTrip: z.boolean(),
  /** oneWayMiles × (roundTrip ? 2 : 1), as estimated. */
  miles: z.number().positive(),
  mpg: z.number().positive(),
  grade: fuelGrade,
  /** $/gal × 1000 */
  priceMilli: z.number().int().positive(),
  /** Display name of the price area ("Denver", "Colorado", "PADD 4", "U.S."). */
  priceArea: z.string(),
  /** The EIA week the price was for (YYYY-MM-DD). */
  priceWeek: dateStr,
  seriesId: z.string(),
  estimateCents: cents.positive(),
  /** True when the saved amount differs from estimateCents (set by the server, kept on later amount edits). */
  overridden: z.boolean(),
});
export const expenseGas = expenseGasBase.refine((g) => g.fromKind === "typed" || g.fromText === undefined, 'fromKind "home" never stores an address');
export type ExpenseGas = z.infer<typeof expenseGas>;

export const Expense = entity({
  userId: id,
  date: dateStr,
  amount: cents.positive(),
  category: ledgerCategory,
  what: z.string().min(1),
  showId: id.optional(),
  rehearsalId: id.optional(),
  /** Present only when the amount came from a gas estimate (category "travel"). */
  gas: expenseGas.optional(),
  receipt: driveRef.optional(),
  /** The band should pay this back (unticked: the band's own money, nothing owed). Missing = true. */
  payBack: z.boolean().optional(),
  /** Set when an admin marks it paid back (YYYY-MM-DD) and by whom (uid). A paid-back expense can't be changed. */
  paidBackAt: dateStr.optional(),
  paidBackBy: id.optional(),
});
export const ExpenseInput = Expense.omit(serverMask);
export type Expense = z.infer<typeof Expense>;
