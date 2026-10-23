import { z } from "zod";
import { entity, serverMask, id, dateStr, cents, ledgerCategory, driveRef } from "./common";

export const Ledger = entity({
  date: dateStr,
  kind: z.enum(["income", "expense", "payout", "reimbursement", "correction"]),
  amount: cents.positive(),
  category: ledgerCategory,
  method: z.enum(["cash", "venmo", "check", "card", "bank", "other"]),
  showId: id.optional(),
  rehearsalId: id.optional(),
  payeeUserId: id.optional(),
  payeeMusicianId: id.optional(),
  expenseId: id.optional(),
  reversesId: id.optional(),
  memo: z.string().optional(),
  receipt: driveRef.optional(),
});
export const LedgerInput = Ledger.omit(serverMask).refine((d) => d.kind !== "correction" || !!d.reversesId, {
  message: "A correction needs reversesId",
  path: ["reversesId"],
});
export type Ledger = z.infer<typeof Ledger>;
