import { z } from "zod";
import { entity, serverMask, id, gearItem } from "./common";

export const Configuration = z.strictObject({
  id,
  name: z.string().min(1),
  billingName: z.string().min(1),
  musicianIds: z.array(id),
  gear: z.array(gearItem),
});
export const Artist = entity({
  name: z.string().min(1),
  configurations: z.array(Configuration),
  soundGear: z.strictObject({ bandProvided: z.array(gearItem), venueProvided: z.array(gearItem) }),
  links: z.strictObject({
    spotify: z.string().optional(), instagram: z.string().optional(),
    website: z.string().optional(), bandsintown: z.string().optional(),
  }),
  driveFolderId: z.string(),
});
export const ArtistInput = Artist.omit(serverMask);
export type Artist = z.infer<typeof Artist>;
export type Configuration = z.infer<typeof Configuration>;
