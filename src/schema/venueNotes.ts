import { z } from "zod";
import { entity, serverMask, id } from "./common";
import { venuePrivateShape } from "./venues";

/**
 * One band's private notes about a venue: `venueNotes/{artistId}__{venueId}`. Only that artist's admins read it (firestore.rules),
 * which is why it is a document of its own: rules work per document, not per field. Created the first time the band writes a
 * private field, links a contact or promoter, or flags the venue. Archiving a venue for a band soft-deletes this doc.
 */
export const VenueNote = entity({ artistId: id, venueId: id, ...venuePrivateShape });
export const VenueNoteInput = VenueNote.omit(serverMask);
export type VenueNote = z.infer<typeof VenueNote>;
export const venueNoteId = (artistId: string, venueId: string) => `${artistId}__${venueId}`;
