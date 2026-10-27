import { z } from "zod";
import { entity, serverMask, id, region, sourcesShape } from "./common";

export const Festival = entity({
  name: z.string().min(1),
  type: z.enum(["festival", "series"]),
  /** Where it happens: one town (a series in several towns names its main one). festivals.create requires it; only festivals from before the festival-where migration lack it. */
  address: z.strictObject({ city: z.string().min(1), state: z.string().min(1) }).optional(),
  /** LEGACY until the festival-where migration has run in production: the old Colorado area. Read by nothing, cleared by festivals.update. */
  region: region.optional(),
  website: z.string().optional(),
  genres: z.string().optional(),
  contactIds: z.array(id),
  promoterId: id.optional(),
  typicalMonth: z.number().int().min(1).max(12).optional(),
  /** LEGACY until `npm run migrate:band-notes`: the band's notes live in its notes doc (src/schema/bandNotes.ts); the commands write them there. */
  notes: z.string().optional(),
  matchKey: z.string().min(1),
  ...sourcesShape,
});
export const FestivalInput = Festival.omit({ ...serverMask, matchKey: true });
export type Festival = z.infer<typeof Festival>;
