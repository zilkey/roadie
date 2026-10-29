import { z } from "zod";
import { entity, serverMask, id, dateStr, cents, incomeCategory, paymentMethod } from "./common";

/**
 * income/{id}: money coming to the band (admins only; members never read it). A show is optional context, not the
 * owner. No receivedAt = owed to us (a guarantee the venue hasn't paid, Bandcamp sales not yet transferred).
 */
export const Income = entity({
  artistId: id,
  date: dateStr,
  amount: cents.positive(),
  category: incomeCategory,
  method: paymentMethod.optional(),
  /** Who it came from, free text: the venue, "Bandcamp", a grant. */
  from: z.string().min(1),
  projectId: id,
  showId: id.optional(),
  /** The release track this came from (a sync licence of one song), when it was one track's. */
  releaseTrackId: id.optional(),
  /** When the money arrived (YYYY-MM-DD). Missing = still owed to us. */
  receivedAt: dateStr.optional(),
  notes: z.string().optional(),
  /** Set by `npm run migrate:money` on income copied off a deal's legacy income[] lines: `${showId}:${line.id}`, so a rerun finds its own docs. */
  sourceKey: z.string().optional(),
});
export const IncomeInput = Income.omit(serverMask);
export type Income = z.infer<typeof Income>;
