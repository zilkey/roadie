import { z } from "zod";
import { entity, serverMask, id, dateStr, timeStr, sound, cents, ts } from "./common";

export const showKind = z.enum(["venue", "house", "festival", "radio", "other"]);
export type ShowKind = z.infer<typeof showKind>;

export const showStatus = z.enum(["hold", "confirmed", "played", "canceled", "dropped"]);
export type ShowStatus = z.infer<typeof showStatus>;

/** One item on a show checklist. ownerId is a musician (missing = unassigned). doneAt (ISO instant) and doneBy (uid) are set when it is ticked. */
export const checklistItem = z.strictObject({ id, label: z.string().min(1), done: z.boolean(), ownerId: id.optional(), doneAt: z.string().optional(), doneBy: z.string().optional() });
/** templateId: the checklist template it was made from or saved as (null = none). List order is array order. */
export const checklist = z.strictObject({ id, name: z.string().min(1), templateId: id.nullable(), items: z.array(checklistItem) });
export type ShowChecklist = z.infer<typeof checklist>;

export const Show = entity({
  date: dateStr,
  status: showStatus,
  /** Why it was canceled or dropped (the latest change's reason). Members can read it. */
  reason: z.string().optional(),
  /** Every status change, oldest first: to what, the optional reason, who (uid) and when (ISO instant). */
  statusHistory: z.array(z.strictObject({ status: showStatus, reason: z.string().optional(), by: z.string(), at: z.string() })).optional(),
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
    loadIn: timeStr.optional(), soundcheck: timeStr.optional(), doors: timeStr.optional(), showStart: timeStr.optional(), set: timeStr.optional(),
    /** Set length in seconds (typed as "2h", "90m", "2:30"...: src/lib/duration.ts). */
    setLengthSec: z.number().int().positive().optional(),
    /** LEGACY minutes, until `npm run migrate:show-page` has run (it becomes setLengthSec). Never written. Read with setLengthOf(). */
    setLength: z.number().int().optional(),
  }),
  /** Who to call on the day: a copy the whole band can read (contacts are admin-only); contactId when picked from a contact. */
  dayOfContact: z.strictObject({ name: z.string().min(1), phone: z.string().optional(), contactId: id.optional() }).optional(),
  artistId: id,
  billedAs: id.optional(),
  personnel: z.array(id),
  sound,
  needs: z.strictObject({ poster: z.boolean(), backline: z.boolean(), merch: z.boolean() }),
  /** Several named lists, in order. Missing on shows not yet migrated: read with checklistsOf(). */
  checklists: z.array(checklist).optional(),
  /** LEGACY single checklist and gear list, until `npm run migrate:show-page` turns them into checklists. Never written. */
  checklist: z.array(z.strictObject({
    id, label: z.string(), done: z.boolean(), ownerId: id.optional(), due: dateStr.optional(),
  })).optional(),
  gear: z.array(z.strictObject({ id, label: z.string(), musicianId: id.optional(), packed: z.boolean() })).optional(),
  docs: z.array(z.strictObject({ title: z.string(), driveFileId: z.string(), url: z.string() })),
  calendarEventId: z.string().optional(),
  /** Musicians the calendar event invites, when shows.create was told (sendInvites). Unset: everyone in personnel who has an email. */
  calendarInviteeIds: z.array(id).optional(),
  /** Publish to Bandsintown: listed there once the show is confirmed (src/server/showSync.ts). Missing = not published. */
  publishToBandsintown: z.boolean().optional(),
  /** LEGACY "public show", until `npm run migrate:show-page` makes it publishToBandsintown. Never written. Read with isPublished(). */
  public: z.boolean().optional(),
  ticketUrl: z.string().optional(),
  listings: z.strictObject({
    bandsintown: z.strictObject({
      eventId: z.string().optional(), state: z.enum(["pending", "listed", "error"]),
      syncedAt: z.string().optional(), error: z.string().optional(),
    }).optional(),
  }),
  /** LEGACY, until `npm run migrate:show-page` moves it into a band comment. Never written. */
  bandNotes: z.string().optional(),
});
export const ShowInput = Show.omit(serverMask);
export type Show = z.infer<typeof Show>;

export const incomeCategory = z.enum(["guarantee", "door", "tips", "merch", "other"]);
export const payMethod = z.enum(["cash", "venmo", "check", "square", "card", "bank", "other"]);
/** One line of a show's income (admin-only, on the show's deal). received = the money is in hand. */
export const incomeLine = z.strictObject({ id, category: incomeCategory, amount: cents.nonnegative(), method: payMethod.optional(), received: z.boolean() });
export type IncomeLine = z.infer<typeof incomeLine>;

/** showDeals/{showId}: same id as the show. */
export const ShowDeal = entity({
  pitchId: id.optional(),
  promoterId: id.optional(),
  editionId: id.optional(),
  contactIds: z.array(id),
  deal: z.enum(["guarantee", "doorSplit", "flat", "tips", "free"]),
  /** LEGACY guarantee amount, until `npm run migrate:show-page` makes it an income line. Never written. */
  guarantee: cents.optional(),
  doorSplitPct: z.number().int().min(0).max(100).optional(),
  ticketPrice: cents.optional(),
  paidAttendance: z.number().int().optional(),
  /** How many were in the room (an estimate, the Accounting Form's Audience Count). `paidAttendance` is the ticketed count. */
  crowd: z.number().int().nonnegative().optional(),
  /**
   * How'd it go? Both stars are optional: the Accounting Form import brings notes with no stars at all, so a rating
   * may hold any combination (shows.afterShow refuses only a save with nothing in it). Existing star ratings stay
   * valid. `crowd` used to live here; `npm run migrate:crowd` lifts it out, and nothing writes it here any more.
   */
  rating: z.strictObject({
    show: z.number().int().min(1).max(5).optional(), venue: z.number().int().min(1).max(5).optional(),
    /** LEGACY, until `npm run migrate:crowd` moves it to the top-level `crowd`. Never written. */
    crowd: z.number().int().optional(),
    notes: z.string().optional(),
  }).optional(),
  /** The show's income, line by line (Finances tab). Missing = none yet. */
  income: z.array(incomeLine).optional(),
  incomeNotes: z.string().optional(),
  /** LEGACY from the ledger era (money entered with shows.settle; payouts owed). Kept as data, no longer written or read. */
  settled: z.boolean().optional(),
  owedPayouts: z.array(z.strictObject({ musicianId: id, amount: cents.positive() })).optional(),
  /** Server-kept (written only by refreshDealTotals): the show's income and expenses for the Played table. */
  totals: z.strictObject({ income: cents, expenses: cents, updatedAt: ts }).optional(),
});
export const ShowDealInput = ShowDeal.omit(serverMask);
export type ShowDeal = z.infer<typeof ShowDeal>;
