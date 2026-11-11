import { z } from "zod";
import { entity, serverMask, id, sourcesShape } from "./common";

export const Promoter = entity({
  name: z.string().min(1),
  kind: z.enum(["promoter", "venueGroup", "nonprofit", "buyer"]),
  website: z.string().optional(),
  matchKey: z.string().min(1),
  ...sourcesShape,
});
/** What db.ts validates for `promoters`: the shared record. */
export const PromoterRecord = Promoter.omit({ ...serverMask, matchKey: true });
/** What the promoter commands accept: the shared fields plus this band's contacts, venue links and notes, which go to its promoterNotes (src/schema/bandNotes.ts). */
export const PromoterInput = PromoterRecord.extend({ contactIds: z.array(id).optional(), venueIds: z.array(id).optional(), howToPitch: z.string().optional(), notes: z.string().optional() });
export type Promoter = z.infer<typeof Promoter>;
