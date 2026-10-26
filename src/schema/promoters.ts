import { z } from "zod";
import { entity, serverMask, id, sourcesShape } from "./common";

export const Promoter = entity({
  name: z.string().min(1),
  kind: z.enum(["promoter", "venueGroup", "nonprofit", "buyer"]),
  website: z.string().optional(),
  contactIds: z.array(id),
  /**
   * LEGACY, until `npm run migrate:band-notes` has run in production: the band's venue links and notes. They live in the band's
   * promoterNotes now (src/schema/bandNotes.ts); the commands still accept them and write them there. Tolerated here so an old
   * record can be read, updated and restored; delete them right after the production migration.
   */
  venueIds: z.array(id).optional(),
  howToPitch: z.string().optional(),
  notes: z.string().optional(),
  matchKey: z.string().min(1),
  ...sourcesShape,
});
export const PromoterInput = Promoter.omit({ ...serverMask, matchKey: true });
export type Promoter = z.infer<typeof Promoter>;
