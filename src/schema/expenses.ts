import { z } from "zod";
import { entity, serverMask, id, dateStr, cents, ledgerCategory, driveRef } from "./common";

export const Expense = entity({
  userId: id,
  date: dateStr,
  amount: cents.positive(),
  category: ledgerCategory,
  what: z.string().min(1),
  showId: id.optional(),
  receipt: driveRef.optional(),
  /** The band should pay this back (unticked: the band's own money, nothing owed). Missing = true. */
  payBack: z.boolean().optional(),
  /** Set when an admin marks it paid back (YYYY-MM-DD) and by whom (uid). A paid-back expense can't be changed. */
  paidBackAt: dateStr.optional(),
  paidBackBy: id.optional(),
});
export const ExpenseInput = Expense.omit(serverMask);
export type Expense = z.infer<typeof Expense>;
