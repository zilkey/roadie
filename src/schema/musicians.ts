import { z } from "zod";
import { entity, serverMask, email, id, ts } from "./common";

export const Musician = entity({
  name: z.string().min(1),
  instruments: z.array(z.string()),
  userId: id.optional(),
  email: email.optional(),
  phone: z.string().optional(),
  payHandle: z.string().optional(),
  active: z.boolean(),
  /**
   * Set when the person left the band or was archived (musicians.removeFromBand / musicians.archive); cleared by
   * musicians.restore. Archived musicians are kept (never soft-deleted) so past shows and pay still show their name.
   * Absent or null = not archived. A Firestore Timestamp when read.
   */
  archivedAt: ts.nullable().optional(),
});
export const MusicianInput = Musician.omit(serverMask);
export type Musician = z.infer<typeof Musician>;
