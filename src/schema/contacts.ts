import { z } from "zod";
import { entity, serverMask, email, sourcesShape } from "./common";

export const Contact = entity({
  name: z.string().min(1),
  title: z.string().optional(),
  emails: z.array(email),
  phones: z.array(z.string().regex(/^\+[1-9]\d{6,14}$/, "E.164, e.g. +13035551212")),
  instagram: z.string().regex(/^[^@\s]+$/, "Handle without @").optional(),
  /** LEGACY until `npm run migrate:band-notes`: the band's notes live in its notes doc (src/schema/bandNotes.ts); the commands write them there. */
  notes: z.string().optional(),
  matchKey: z.string().min(1),
  ...sourcesShape,
});
export const ContactInput = Contact.omit({ ...serverMask, matchKey: true });
export type Contact = z.infer<typeof Contact>;
