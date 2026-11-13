/**
 * Contact links are the band's own: venueNotes, promoterNotes, festivalNotes and actNotes contactIds. Shared by the contact
 * commands (booking.ts) and email ingest (email.ts), which adds the people a place's threads are with.
 */
import { z } from "zod";
import type { Writer } from "./db";
import { AppError } from "./errors";
import { artistIdOf, noteOf, requireContact, writeNote } from "./venues";
import { bandNoteOf, writeBandNote } from "./bandNotes";

export const parentKind = z.enum(["venues", "promoters", "festivals", "acts"]);
export type ParentKind = z.infer<typeof parentKind>;

export async function attachContact(w: Writer, kind: ParentKind, parentId: string, contactId: string) {
  await requireContact(w, contactId);
  const p = await w.get(kind, parentId);
  if (!p || p.deletedAt) throw new AppError("not_found", kind === "acts" ? "Act not found" : "Place not found", 404);
  const artistId = await artistIdOf(w);
  if (kind === "venues") {
    const { fields } = await noteOf(w, p, artistId);
    if (!fields.contactIds.includes(contactId)) await writeNote(w, p, artistId, { contactIds: [...fields.contactIds, contactId] });
    return;
  }
  const ids = (await bandNoteOf(w, kind, p, artistId)).fields.contactIds ?? [];
  if (!ids.includes(contactId)) await writeBandNote(w, kind, p, artistId, { contactIds: [...ids, contactId] });
}

export async function detachContact(w: Writer, kind: ParentKind, parentId: string, contactId: string) {
  const p = await w.get(kind, parentId);
  if (!p || p.deletedAt) return;
  const artistId = await artistIdOf(w);
  if (kind === "venues") {
    const { fields } = await noteOf(w, p, artistId);
    if (fields.contactIds.includes(contactId)) await writeNote(w, p, artistId, { contactIds: fields.contactIds.filter((x) => x !== contactId) });
    return;
  }
  const ids = (await bandNoteOf(w, kind, p, artistId)).fields.contactIds ?? [];
  if (ids.includes(contactId)) await writeBandNote(w, kind, p, artistId, { contactIds: ids.filter((x) => x !== contactId) });
}
