import { z } from "zod";
import { entity, serverMask, id, dateStr, timeStr } from "./common";

/**
 * One place with coordinates, so directions and gas estimates work. address/lat/lng are optional only because
 * the migration (scripts/migrate-rehearsal-location.ts) moves old free-text `place` into `location.name` with
 * nothing else; anything saved from the app's autocomplete has all four.
 */
export const rehearsalLocation = z.strictObject({
  name: z.string().optional(),
  address: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});
export type RehearsalLocation = z.infer<typeof rehearsalLocation>;

export const Rehearsal = entity({
  date: dateStr,
  location: rehearsalLocation.optional(),
  venueId: id.optional(),
  startTime: timeStr.optional(),
  endTime: timeStr.optional(),
  /** Set by rehearsals.importSetlist: where the songs card says the list came from. Later edits don't touch the setlist. */
  fromSetlistId: id.optional(),
  personnel: z.array(id),
  songs: z.array(z.strictObject({ songId: id, title: z.string(), note: z.string().optional() })),
  notes: z.string().optional(),
  /** The event on the band calendar, set only when an admin sends it (rehearsals.calendar). */
  calendarEventId: z.string().optional(),
  /** A hash of the event as last sent, so the preview can say whether anything changed since. */
  calendarHash: z.string().optional(),
});
export const RehearsalInput = Rehearsal.omit(serverMask);
export type Rehearsal = z.infer<typeof Rehearsal>;
