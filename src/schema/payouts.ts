import { z } from "zod";
import { entity, serverMask, id, dateStr, cents, paymentMethod } from "./common";

/** Why the band paid someone: a player's pay for a show, another band's cut, paying an expense back, anything else. */
export const payoutKind = z.enum(["pay", "split", "reimbursement", "other"]);
export type PayoutKind = z.infer<typeof payoutKind>;

/**
 * Who a payout goes to. Exactly one shape: a band player (musicians/{id}), a signed-in user (users/{uid}), a contact
 * (contacts/{id}, with its name copied so members never need the admin-only contact), or just a name.
 * `name` is always present on the stored doc (the server copies it) so lists render without a lookup.
 */
export const payoutTo = z.union([
  z.strictObject({ musicianId: id, name: z.string().min(1) }),
  z.strictObject({ userId: id, name: z.string().min(1) }),
  z.strictObject({ contactId: id, name: z.string().min(1) }),
  z.strictObject({ name: z.string().min(1) }),
]);
export type PayoutTo = z.infer<typeof payoutTo>;

/**
 * payouts/{id}: money from the band to a person. Admins read and write; a member reads only payouts to them
 * (to.userId == their uid, or to.musicianId == their musicianId claim). No paidAt = we owe.
 */
export const Payout = entity({
  artistId: id,
  to: payoutTo,
  kind: payoutKind,
  amount: cents.positive(),
  /** What for: "the Lost Lake show", "their 30% of the door". */
  what: z.string().optional(),
  projectId: id,
  showId: id.optional(),
  dueDate: dateStr.optional(),
  /** When it was paid (YYYY-MM-DD). Missing = we still owe it. */
  paidAt: dateStr.optional(),
  method: paymentMethod.optional(),
  /** Which admin paid it, from their own account (users/{uid}). Missing on payouts logged before payers were tracked. */
  paidBy: id.optional(),
  /** kind "reimbursement": the expenses this paid back (each gets reimbursedBy = this payout's id). */
  expenseIds: z.array(id).optional(),
});
export const PayoutInput = Payout.omit(serverMask);
export type Payout = z.infer<typeof Payout>;
