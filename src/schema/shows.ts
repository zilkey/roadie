import { z } from "zod";
import { entity, serverMask, id, dateStr, timeStr, sound, cents } from "./common";

export const Show = entity({
  date: dateStr,
  status: z.enum(["hold", "confirmed", "played", "canceled"]),
  venue: z.strictObject({ id, name: z.string(), address: z.string().optional(), city: z.string().optional() }),
  editionName: z.string().optional(),
  times: z.strictObject({
    loadIn: timeStr.optional(), soundcheck: timeStr.optional(), doors: timeStr.optional(), set: timeStr.optional(),
    setLength: z.number().int().optional(),
  }),
  artistId: id,
  billedAs: id.optional(),
  personnel: z.array(id),
  sound,
  needs: z.strictObject({ poster: z.boolean(), backline: z.boolean(), merch: z.boolean() }),
  checklist: z.array(z.strictObject({
    id, label: z.string(), done: z.boolean(), ownerId: id.optional(), due: dateStr.optional(),
  })),
  gear: z.array(z.strictObject({ id, label: z.string(), musicianId: id.optional(), packed: z.boolean() })),
  setlistId: id.optional(),
  docs: z.array(z.strictObject({ title: z.string(), driveFileId: z.string(), url: z.string() })),
  calendarEventId: z.string().optional(),
  public: z.boolean(),
  ticketUrl: z.string().optional(),
  listings: z.strictObject({
    bandsintown: z.strictObject({
      eventId: z.string().optional(), state: z.enum(["pending", "listed", "error"]),
      syncedAt: z.string().optional(), error: z.string().optional(),
    }).optional(),
  }),
  bandNotes: z.string().optional(),
});
export const ShowInput = Show.omit(serverMask);
export type Show = z.infer<typeof Show>;

/** showDeals/{showId}: same id as the show. */
export const ShowDeal = entity({
  pitchId: id.optional(),
  promoterId: id.optional(),
  editionId: id.optional(),
  contactIds: z.array(id),
  deal: z.enum(["guarantee", "doorSplit", "flat", "tips", "free"]),
  guarantee: cents.optional(),
  doorSplitPct: z.number().int().min(0).max(100).optional(),
  ticketPrice: cents.optional(),
  paidAttendance: z.number().int().optional(),
  rating: z.strictObject({
    show: z.number().int().min(1).max(5), venue: z.number().int().min(1).max(5),
    crowd: z.number().int().optional(), notes: z.string().optional(),
  }).optional(),
  settled: z.boolean(),
  /** Payouts agreed at settle time but not yet paid; paid ones become ledger payout entries. */
  owedPayouts: z.array(z.strictObject({ musicianId: id, amount: cents.positive() })).optional(),
});
export const ShowDealInput = ShowDeal.omit(serverMask);
export type ShowDeal = z.infer<typeof ShowDeal>;
