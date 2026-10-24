import { z } from "zod";
import { entity, serverMask, id, region, sound, sourcesShape } from "./common";

/**
 * A venue is split in two documents (docs/venue-access-proposal.md). This one, `venues/{id}`, is the shared directory record:
 * facts about the room that every signed-in band user may read and fix. What one band knows privately (load-in notes, notes,
 * contacts, promoters) lives in that band's `venueNotes/{artistId}__{venueId}` (see venueNotes.ts).
 */
const sharedShape = {
  name: z.string().min(1),
  type: z.enum(["listening", "bar", "brewery", "club", "theater", "outdoor", "house", "other"]),
  address: z.strictObject({
    street: z.string().optional(), city: z.string().min(1), state: z.string().min(1), zip: z.string().optional(),
  }),
  region,
  capacity: z.number().int().optional(),
  ages: z.enum(["all", "18", "21"]).optional(),
  sound: sound.optional(),
  website: z.string().optional(),
  instagram: z.string().optional(),
  matchKey: z.string().min(1),
  /** Set by venues.mergeInto: the room this duplicate was merged into (the doc is soft-deleted; its page redirects there). */
  mergedInto: id.optional(),
  ...sourcesShape,
};

/** The band-private fields. They are NOT on `venues` any more: `venues.create` / `venues.update` still accept them and write them to the band's venueNotes. */
export const venuePrivateShape = {
  loadInNotes: z.string().optional(),
  notes: z.string().optional(),
  contactIds: z.array(id),
  promoterIds: z.array(id),
};
export const VENUE_PRIVATE_FIELDS = Object.keys(venuePrivateShape) as (keyof typeof venuePrivateShape)[];

/**
 * LEGACY, until `npm run migrate:venue-notes` has run in production: venue docs written before the split still carry the four
 * private fields. They stay readable and writable here (optional, never written by the commands) so a not-yet-migrated venue can
 * still be read, updated and restored from a backup. Delete this block (and `venueLegacy` below) right after the production migration.
 */
export const venueLegacyShape = {
  loadInNotes: venuePrivateShape.loadInNotes,
  notes: venuePrivateShape.notes,
  contactIds: venuePrivateShape.contactIds.optional(),
  promoterIds: venuePrivateShape.promoterIds.optional(),
};

export const Venue = entity({ ...sharedShape, ...venueLegacyShape });
/** What db.ts validates for `venues` (shared fields, plus the tolerated legacy ones). */
export const VenueRecord = Venue.omit({ ...serverMask, matchKey: true });
/** What the venues commands accept: the shared fields and the private ones together, as before the split. The command splits them across the two docs. */
export const VenueInput = VenueRecord.omit({ mergedInto: true, ...Object.fromEntries(VENUE_PRIVATE_FIELDS.map((k) => [k, true])) })
  .extend(venuePrivateShape);
export type Venue = z.infer<typeof Venue>;
