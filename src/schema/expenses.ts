import { z } from "zod";
import { entity, serverMask, id, dateStr, cents, expenseCategory, ledgerCategory, driveRef } from "./common";
import { fuelGrade } from "./driving";
import { payoutTo } from "./payouts";

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
  /** Who paid, from their own account (the band has none). On an open bill (`owed`) it is whoever entered it. */
  userId: id,
  date: dateStr,
  amount: cents.positive(),
  /** New writes use expenseCategory; the legacy ledger values (guarantee, door, merch, tips, venmo) survive on old docs until `npm run migrate:money` rewrites them. */
  category: z.union([expenseCategory, ledgerCategory]),
  what: z.string().min(1),
  /** Details that don't belong in the title (invoice numbers, what a campaign was, how a split works); shown small under it. */
  notes: z.string().optional(),
  /** Who was paid (or is owed): a vendor from contacts, a band member, a player, or just a name. Missing on expenses logged before vendors were tracked. */
  to: payoutTo.optional(),
  /** "We owe": a bill nobody has paid yet. expenses.markPaid clears it with the payer and the date. Missing = paid. */
  owed: z.boolean().optional(),
  /** The project this belongs to. Optional only until `npm run migrate:money` has stamped every expense; readers treat missing as the default (Band) project. */
  projectId: id.optional(),
  showId: id.optional(),
  rehearsalId: id.optional(),
  /** The release track this was for (releases/{release}/tracks/{id}; the release is the project's), when it was one track's: "mix v4 revisions". */
  releaseTrackId: id.optional(),
  /** The tour this is on (tours/{id}): a tag next to the project, never instead of it. Copied from the show when there is one. */
  tourId: id.optional(),
  /** One entry of that tour (tours/{tourId}/entries/{id}: a drive, stay or show) for the per-day breakdown. Missing = the whole tour. */
  tourEntryId: id.optional(),
  /** Present only when the amount came from a gas estimate (category "gas"; older ones are "travel" until scripts/migrate-gas-category.ts moves them). */
  gas: expenseGas.optional(),
  receipt: driveRef.optional(),
  /** The band should pay this back (unticked: the band's own money, nothing owed). Missing = true. */
  payBack: z.boolean().optional(),
  /** Set when an admin marks it paid back (YYYY-MM-DD) and by whom (uid). A paid-back expense can't be changed. */
  paidBackAt: dateStr.optional(),
  paidBackBy: id.optional(),
  /** The reimbursement payout (payouts/{id}, kind "reimbursement") that paid this back, when expenses.payPerson did it. */
  reimbursedBy: id.optional(),
});
export const ExpenseInput = Expense.omit(serverMask);
export type Expense = z.infer<typeof Expense>;
