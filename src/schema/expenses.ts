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
});
export const ExpenseInput = Expense.omit(serverMask);
export type Expense = z.infer<typeof Expense>;
