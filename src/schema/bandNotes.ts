import { z } from "zod";
import { entity, serverMask, id } from "./common";

/**
 * One band's private notes about a shared booking record, the same split venues have (venueNotes.ts): festivals, festival years
 * (editions), promoters and contacts are one record for every band, and what a band thinks of them lives in
 * `{coll}/{artistId}__{entityId}`. Only that artist's admins read it (firestore.rules). Created the first time the band writes a note.
 * The commands for the shared record (festivals.update etc.) still accept these fields and write them here. `fields` are text, `lists` id arrays.
 */
export const BAND_NOTES = {
  festivals: { coll: "festivalNotes", key: "festivalId", fields: ["notes"], lists: [] },
  editions: { coll: "editionNotes", key: "editionId", fields: ["notes", "payNotes"], lists: [] },
  /** `venueIds`: the venues this promoter books, as this band knows it (the other side of venueNotes.promoterIds). */
  promoters: { coll: "promoterNotes", key: "promoterId", fields: ["notes", "howToPitch"], lists: ["venueIds"] },
  contacts: { coll: "contactNotes", key: "contactId", fields: ["notes"], lists: [] },
} as const;
export type NotedKind = keyof typeof BAND_NOTES;
export const NOTED_KINDS = Object.keys(BAND_NOTES) as NotedKind[];
export const isNotedKind = (k: string): k is NotedKind => k in BAND_NOTES;
export const bandNoteId = (artistId: string, entityId: string) => `${artistId}__${entityId}`;

const text = z.string().optional();
export const FestivalNote = entity({ artistId: id, festivalId: id, notes: text });
export const EditionNote = entity({ artistId: id, editionId: id, notes: text, payNotes: text });
export const PromoterNote = entity({ artistId: id, promoterId: id, notes: text, howToPitch: text, venueIds: z.array(id).optional() });
export const ContactNote = entity({ artistId: id, contactId: id, notes: text });
export const FestivalNoteInput = FestivalNote.omit(serverMask);
export const EditionNoteInput = EditionNote.omit(serverMask);
export const PromoterNoteInput = PromoterNote.omit(serverMask);
export const ContactNoteInput = ContactNote.omit(serverMask);
export type FestivalNote = z.infer<typeof FestivalNote>;
export type EditionNote = z.infer<typeof EditionNote>;
export type PromoterNote = z.infer<typeof PromoterNote>;
export type ContactNote = z.infer<typeof ContactNote>;
