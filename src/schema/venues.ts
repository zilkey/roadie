import { z } from "zod";
import { entity, serverMask, id, region, sound, sourcesShape } from "./common";

export const Venue = entity({
  name: z.string().min(1),
  type: z.enum(["listening", "bar", "brewery", "club", "theater", "outdoor", "house", "other"]),
  address: z.strictObject({
    street: z.string().optional(), city: z.string().min(1), state: z.string().min(1), zip: z.string().optional(),
  }),
  region,
  capacity: z.number().int().optional(),
  ages: z.enum(["all", "18", "21"]).optional(),
  sound: sound.optional(),
  loadInNotes: z.string().optional(),
  website: z.string().optional(),
  instagram: z.string().optional(),
  contactIds: z.array(id),
  promoterIds: z.array(id),
  notes: z.string().optional(),
  matchKey: z.string().min(1),
  ...sourcesShape,
});
export const VenueInput = Venue.omit({ ...serverMask, matchKey: true });
export type Venue = z.infer<typeof Venue>;
