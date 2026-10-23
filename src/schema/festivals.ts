import { z } from "zod";
import { entity, serverMask, id, region, sourcesShape } from "./common";

export const Festival = entity({
  name: z.string().min(1),
  type: z.enum(["festival", "series"]),
  region,
  website: z.string().optional(),
  genres: z.string().optional(),
  contactIds: z.array(id),
  promoterId: id.optional(),
  typicalMonth: z.number().int().min(1).max(12).optional(),
  notes: z.string().optional(),
  matchKey: z.string().min(1),
  ...sourcesShape,
});
export const FestivalInput = Festival.omit({ ...serverMask, matchKey: true });
export type Festival = z.infer<typeof Festival>;
