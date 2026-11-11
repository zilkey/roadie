import { z } from "zod";
import { entity, serverMask, id, dateStr, timeStr } from "./common";

/**
 * Venue calendars (issue #60). Three pieces, the same split as venues / venueNotes:
 * - `calendar` on the shared venue record: where the room's own calendar is and how to read it (this file's VenueCalendar).
 * - `venueEvents/{id}`: the room's upcoming (and past) shows as its calendar lists them. Public facts, shared with every band;
 *   only the server writes them, on a refresh. They are a copy of someone else's web page, re-read on Refresh, so they are written
 *   directly (like the geocode cache), not through db.ts: History has nothing to undo in a scrape.
 * - `venueEventNotes/{artistId}__{eventId}`: what one band thinks of a show (not a fit / interested / pitched). Admins only.
 * A calendar's health (last run, last success, count, error) is `venueEventSources/{venueId}`, also server-written.
 */

const url = z.string().min(1);

/** A CSS selector, or a selector plus the attribute to read (default: the element's text). */
export const selectorField = z.union([z.string(), z.strictObject({ sel: z.string(), attr: z.string().min(1) })]);
export type SelectorField = z.infer<typeof selectorField>;

/** What a selector page's fields are: each one is read inside `item`. */
export const selectorFields = z.strictObject({
  title: selectorField.optional(),
  date: selectorField.optional(),
  time: selectorField.optional(),
  doors: selectorField.optional(),
  url: selectorField.optional(),
  image: selectorField.optional(),
  /** Each match is one act (a lineup list). */
  acts: selectorField.optional(),
  /** The room's name when one page lists several rooms (Z2, Downtown Longmont): filter.venueName matches it. */
  venue: selectorField.optional(),
  status: selectorField.optional(),
});

/** Which events a calendar keeps. venueName: only rows whose venue matches (a page shared by several rooms). include/exclude: regexes on the title. */
export const calendarFilter = z.strictObject({
  venueName: z.string().optional(),
  include: z.string().optional(),
  exclude: z.string().optional(),
});

/** How a page dates its events when it isn't ISO: a pattern like "ddd, MMM D" or "M/D/YYYY h:mm a" (see src/server/events/dates.ts). */
const dateFormat = z.string().optional();

export const PRESETS = ["z2", "rockhouse", "downtown-longmont", "tickettailor"] as const;
export const CALENDAR_TYPES = ["squarespace", "tribe", "ics", "jsonld", "aeg", "plot", "venue-network", "wix", "eventbrite", "selectors", "manual"] as const;
export type CalendarType = (typeof CALENDAR_TYPES)[number];

export const VenueCalendar = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("squarespace"), url, filter: calendarFilter.optional() }),
  z.strictObject({ type: z.literal("tribe"), baseUrl: url, category: z.string().optional(), filter: calendarFilter.optional() }),
  z.strictObject({ type: z.literal("ics"), url, filter: calendarFilter.optional() }),
  z.strictObject({ type: z.literal("jsonld"), url, filter: calendarFilter.optional() }),
  z.strictObject({ type: z.literal("aeg"), siteId: z.string().min(1), filter: calendarFilter.optional() }),
  z.strictObject({ type: z.literal("plot"), url, filter: calendarFilter.optional() }),
  z.strictObject({ type: z.literal("venue-network"), slug: z.string().min(1), filter: calendarFilter.optional() }),
  z.strictObject({ type: z.literal("wix"), url, filter: calendarFilter.optional() }),
  z.strictObject({ type: z.literal("eventbrite"), organizerId: z.string().min(1), filter: calendarFilter.optional() }),
  z.strictObject({
    type: z.literal("selectors"), url,
    /** A shared template (src/server/events/presets.ts): its item/fields/dateFormat are used unless the venue sets its own. */
    preset: z.enum(PRESETS).optional(),
    item: z.string().optional(), fields: selectorFields.optional(), dateFormat, filter: calendarFilter.optional(),
  }),
  /** No calendar Roadie can read: Instagram-only, a calendar that only renders in a browser. `note` says what the venue has instead. */
  z.strictObject({ type: z.literal("manual"), note: z.string().min(1) }),
]);
export type VenueCalendar = z.infer<typeof VenueCalendar>;

export const actRole = z.enum(["headliner", "support", "unknown"]);
/** `actId`: the shared act (acts/{id}, #77) this name is, linked at refresh by matchKey; none for names that aren't an act ("Open Mic Night"). */
export const Act = z.strictObject({ name: z.string().min(1), role: actRole, actId: id.optional() });
export type Act = z.infer<typeof Act>;
/** How much of the bill this source shows: on a "full" source, no support listed counts more toward an opener slot (openerChance). */
export const billDetail = z.enum(["full", "headliner", "title"]);
export const eventStatus = z.enum(["onsale", "soldout", "cancelled", "gone"]);

/** `venueEvents/{id}`: id = `{venueId}__{hash of sourceId}`. */
export const VenueEvent = z.strictObject({
  id,
  venueId: id,
  /** The source's own id for the event (or its URL, or date + title): the upsert key. */
  sourceId: z.string().min(1),
  source: z.enum(CALENDAR_TYPES),
  date: dateStr,
  doors: timeStr.optional(),
  start: timeStr.optional(),
  title: z.string().min(1),
  acts: z.array(Act),
  /** The acts' actIds, for "where they've played" (array-contains). */
  actIds: z.array(id).optional(),
  bill: billDetail,
  /** The bill names a support act still to be announced ("support TBA"): the slot may be open. */
  supportTba: z.boolean().optional(),
  /** Nights in a row the same headliner plays the room (2+: a run), found at refresh. */
  nights: z.number().int().optional(),
  /** On tour (#79): how many Colorado rooms the headliner plays within a few weeks of this show (2+), set after each refresh. */
  tourStops: z.number().int().optional(),
  imageUrl: z.string().optional(),
  ticketUrl: z.string().optional(),
  status: eventStatus,
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
});
export type VenueEvent = z.infer<typeof VenueEvent>;

/** `venueEventSources/{venueId}`: how the venue's calendar did on its last refresh. */
export const VenueEventSource = z.strictObject({
  venueId: id,
  type: z.enum(CALENDAR_TYPES),
  lastRunAt: z.string(),
  lastSuccessAt: z.string().optional(),
  lastCount: z.number().int().optional(),
  /** Events whose date wouldn't parse on the last run. */
  lastUnparsed: z.number().int().optional(),
  lastError: z.string().optional(),
  /** The room's record (src/lib/venueEvents.ts roomStats): its settled bills, and the share of them with a support act. */
  billsSeen: z.number().int().optional(),
  supportShare: z.number().min(0).max(1).optional(),
});
export type VenueEventSource = z.infer<typeof VenueEventSource>;

export const EVENT_TAKES = ["notFit", "interested", "pitched"] as const;
export const TAKE_LABEL: Record<(typeof EVENT_TAKES)[number], string> = { notFit: "Not a fit", interested: "Interested", pitched: "Pitched" };

/** One band's take on a venue's show: `venueEventNotes/{artistId}__{eventId}`. */
export const VenueEventNote = entity({
  artistId: id, venueId: id, eventId: id,
  take: z.enum(EVENT_TAKES).optional(),
  note: z.string().optional(),
  pitchId: id.optional(),
});
export const VenueEventNoteInput = VenueEventNote.omit(serverMask);
export type VenueEventNote = z.infer<typeof VenueEventNote>;
export const venueEventNoteId = (artistId: string, eventId: string) => `${artistId}__${eventId}`;
