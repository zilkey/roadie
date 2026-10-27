import { z } from "zod";
import { entity, serverMask } from "./common";

/**
 * venueTypes/{key}: the one list of venue types every band picks from (venues are shared, so their types are too). A venue's `type`
 * is the doc id (the key), so renaming a type changes its label and no venue. Any band user who can add a venue can add a type.
 */
export const VenueType = entity({ label: z.string().trim().min(1), matchKey: z.string().min(1) });
export const VenueTypeInput = VenueType.omit({ ...serverMask, matchKey: true });
export type VenueType = z.infer<typeof VenueType>;

/** The types every venue had before the list could grow; written by `venueTypes.*` (and the seed) when the list is still empty. */
export const BUILTIN_VENUE_TYPES: [key: string, label: string][] = [
  ["bar", "Bar"], ["club", "Club"], ["listening", "Listening room"], ["brewery", "Brewery"], ["theater", "Theater"], ["outdoor", "Outdoor"], ["house", "House"],
];
/** A venue typed "other" before the list could grow (until the venue-types migration has run in production). */
export const LEGACY_OTHER = "other";
