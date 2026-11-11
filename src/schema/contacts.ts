import { z } from "zod";
import { entity, serverMask, id, email, sourcesShape } from "./common";

/**
 * contacts/{id}: a person one band works with. Each band has its own contacts (artistId): only that artist's admins read them, and the
 * same email (or name) merges only within the band. What they are linked to lives on the other side (venueNotes, festivalNotes and
 * promoterNotes contactIds, show deals, shows, payouts, expenses).
 */
export const Contact = entity({
  artistId: id,
  name: z.string().min(1),
  title: z.string().optional(),
  emails: z.array(email),
  phones: z.array(z.string().regex(/^\+[1-9]\d{6,14}$/, "E.164, e.g. +13035551212")),
  instagram: z.string().regex(/^[^@\s]+$/, "Handle without @").optional(),
  /** Where to find them on the web: LinkedIn, their agency's page for them, their own site. */
  links: z.array(z.string().url()).optional(),
  matchKey: z.string().min(1),
  ...sourcesShape,
});
/** What db.ts validates for `contacts`: the shared record. */
export const ContactRecord = Contact.omit({ ...serverMask, matchKey: true });
/** What the contact commands accept: the shared fields plus this band's notes, which go to its contactNotes (src/schema/bandNotes.ts). */
export const ContactInput = ContactRecord.extend({ notes: z.string().optional() });
export type Contact = z.infer<typeof Contact>;
