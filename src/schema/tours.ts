import { z } from "zod";
import { entity, serverMask, id, dateStr, timeStr } from "./common";
import { geoPoint } from "./driving";

export const tourStatus = z.enum(["idea", "planning", "booked", "done"]);
export type TourStatus = z.infer<typeof tourStatus>;

/** tours/{id}: a run of days. A tag, not a project: shows, pitches and money point at it with tourId. Band reads, admins write. */
export const Tour = entity({
  artistId: id,
  name: z.string().min(1),
  status: tourStatus,
  /** Optional; only produce warnings. Without them the tour spans whatever is on it. */
  startDate: dateStr.optional(),
  endDate: dateStr.optional(),
  /** Where the first drive starts and the last one ends (a town, not anyone's home). */
  leavingFrom: geoPoint.optional(),
  /** The act, as on shows (shows.billedAs). */
  billedAs: id.optional(),
  /** Musicians going, like rehearsals.personnel. */
  personnel: z.array(id).default([]),
  /** "Money goes to": an existing open project that money added from the tour starts on. Not the tour's own. */
  projectId: id,
  notes: z.string().optional(),
  /** The linked Google Sheet (the band version of the Sheet tab) in the band folder: made and refreshed only by tours.sheet. updatedBy is a name. */
  sheet: z.strictObject({ driveFileId: z.string(), url: z.string(), updatedAt: z.string(), updatedBy: z.string() }).optional(),
});
export const TourInput = Tour.omit(serverMask);
export type Tour = z.infer<typeof Tour>;

export const tourEntryKind = z.enum(["show", "option", "drive", "stay", "note"]); // "flight" later, with its board
export type TourEntryKind = z.infer<typeof tourEntryKind>;
export const entryVisibility = z.enum(["band", "admins"]);
export type EntryVisibility = z.infer<typeof entryVisibility>;

/** tours/{tourId}/entries/{id}: one thing on one day (or, for an option, in the bucket). */
export const TourEntry = entity({
  tourId: id,
  kind: tourEntryKind,
  /** No date = the "No date yet" bucket (options only). */
  date: dateStr.optional(),
  /** Fractional sort key within the day; a + between two entries writes their midpoint. */
  position: z.number(),
  /** Members only read "band". Options are always "admins" (members never see pitches). */
  visibility: entryVisibility,
  /** IANA zone for every time on the entry ("America/Denver"). */
  tz: z.string(),
  showId: id.optional(),              // kind "show"
  pitchId: id.optional(),             // kind "option": one entry per offered date
  from: geoPoint.optional(),          // kind "drive"
  to: geoPoint.optional(),
  leaveBy: timeStr.optional(),
  roundTrip: z.boolean().optional(),
  miles: z.number().nonnegative().optional(),   // server-filled from ORS (routeCache)
  minutes: z.number().nonnegative().optional(),
  name: z.string().optional(),        // kind "stay": "Airbnb", "The van"
  address: geoPoint.optional(),
  nights: z.number().int().positive().optional(),
  checkIn: timeStr.optional(),
  text: z.string().optional(),        // kind "note"
});
export const TourEntryInput = TourEntry.omit(serverMask);
export type TourEntry = z.infer<typeof TourEntry>;
