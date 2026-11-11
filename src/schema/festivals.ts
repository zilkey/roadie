import { z } from "zod";
import { entity, serverMask, id, sourcesShape } from "./common";

export const Festival = entity({
  name: z.string().min(1),
  type: z.enum(["festival", "series"]),
  /** Where it happens: one town (a series in several towns names its main one). festivals.create requires it. */
  address: z.strictObject({ city: z.string().min(1), state: z.string().min(1) }).optional(),
  website: z.string().optional(),
  genres: z.string().optional(),
  promoterId: id.optional(),
  typicalMonth: z.number().int().min(1).max(12).optional(),
  matchKey: z.string().min(1),
  ...sourcesShape,
});
/** What db.ts validates for `festivals`: the shared record. */
export const FestivalRecord = Festival.omit({ ...serverMask, matchKey: true });
/** What the festival commands accept: the shared fields plus this band's contacts and notes, which go to its festivalNotes (src/schema/bandNotes.ts). */
export const FestivalInput = FestivalRecord.extend({ contactIds: z.array(id).optional(), notes: z.string().optional() });
export type Festival = z.infer<typeof Festival>;
