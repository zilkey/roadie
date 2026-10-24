import { z } from "zod";
import { entity, serverMask, id, dateStr, timeStr, sound, cents } from "./common";

export const showKind = z.enum(["venue", "house", "festival", "radio", "other"]);
export type ShowKind = z.infer<typeof showKind>;

export const Show = entity({
  date: dateStr,
  status: z.enum(["hold", "confirmed", "played", "canceled"]),
  /** What kind of show. Missing = "venue" (documents written before this existed). */
  kind: showKind.optional(),
  /** Copy of the venue. Optional: a house concert has hosts and a place instead. A show has a venue or a place. */
  venue: z.strictObject({ id, name: z.string(), address: z.string().optional(), city: z.string().optional() }).optional(),
  /** Where a show with no venue happens (a home). The address is for the band only, never listed publicly. */
  place: z.strictObject({ city: z.string().min(1), address: z.string().optional() }).optional(),
  /** House concert hosts (contacts, admin-only) and a copy of their names that the whole band can read. */
  hostContactIds: z.array(id).optional(),
  hostName: z.string().optional(),
  /** The festival year this show is part of; editionName is its display copy. */
  editionId: id.optional(),
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
  /** Musicians the calendar event invites, when shows.create was told (sendInvites). Unset: everyone in personnel who has an email. */
  calendarInviteeIds: z.array(id).optional(),
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
