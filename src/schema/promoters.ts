import { z } from "zod";
import { entity, serverMask, id, sourcesShape } from "./common";

export const Promoter = entity({
  name: z.string().min(1),
  kind: z.enum(["promoter", "venueGroup", "nonprofit", "buyer"]),
  website: z.string().optional(),
  contactIds: z.array(id),
  venueIds: z.array(id),
  howToPitch: z.string().optional(),
  notes: z.string().optional(),
  matchKey: z.string().min(1),
  ...sourcesShape,
});
export const PromoterInput = Promoter.omit({ ...serverMask, matchKey: true });
export type Promoter = z.infer<typeof Promoter>;
